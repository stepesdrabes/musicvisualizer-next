import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { availableParallelism } from 'node:os';
import { decodeAudio } from '@mv/analysis';
import type { SectionKind } from '@mv/core';
import { extractFeatures } from '../packages/analysis/src/features.ts';
import { chromagram } from '../packages/analysis/src/chroma.ts';
import { detectBeats } from '../packages/analysis/src/beats.ts';
import { beatSynchronous } from '../packages/analysis/src/beatsync.ts';
import { detectMeter } from '../packages/analysis/src/downbeats.ts';
import { measureLoudness } from '../packages/analysis/src/loudness.ts';
import { detectDrums } from '../packages/analysis/src/drums.ts';
import { quantiseOnsets } from '../packages/analysis/src/quantise.ts';
import { arrange, bandLevels, levelEnvelopes } from '../packages/analysis/src/arrange.ts';
import { barSynchronous, groupSegments, segmentBars, similarityMatrix } from '../packages/analysis/src/structure.ts';
import { SECTION_FEATURES, sectionFeatures } from '../packages/analysis/src/sectionFeatures.ts';
import { loadStructureCorpus, fitOffset } from './structure-corpus.ts';
import { KINDS, kindOf, MAX_DURATION_DRIFT, MIN_SHARPNESS } from './kinds.ts';
import { fitPca, poolSpan, project, readNpy, type Npy } from './embed.ts';

/**
 * Is the information for a section label already in the features Room computes?
 *
 * The null hypothesis, and it has to be tested before any model is downloaded. `arrange()` reads
 * the same numbers this fits on, through hand-tuned thresholds; if a classifier over them lands
 * near `arrange()`, the features are the ceiling and a better encoder is the only way up. If it
 * lands far above, the thresholds were the ceiling and nothing needs downloading at all.
 *
 * Grouped k-fold by TRACK, never by segment. Sections of one track share a mastering, a kit and a
 * tempo, so a segment-level split leaks the answer across the fold and every number comes back
 * flattering.
 *
 *   node bench/kindfit.ts --extract [--shards 5]   # once, ~3 min
 *   node bench/kindfit.ts [--folds 5]
 */

const argv = process.argv.slice(2);
const flag = (n: string): string | undefined => {
	const i = argv.indexOf(`--${n}`);
	return i >= 0 ? argv[i + 1] : undefined;
};

const FEAT_DIR = join(import.meta.dirname, 'corpus', '.kind');

/** One estimated section, with what the annotation says it is. */
interface Row {
	x: number[];
	/** Index into KINDS, or -1 when the annotation does not cover the span. */
	y: number;
	/** What `arrange()` called it, so the fit can be compared on exactly the same spans. */
	baseline: number;
	/** Frames the span covers, so a long section counts for what it is worth in the room. */
	weight: number;
	/**
	 * The span on the AUDIO's clock, seconds, for pooling a frame-level embedding over it.
	 *
	 * Not the annotation's clock. The two differ by the fitted offset on every Harmonix track and
	 * confusing them shifts a section's embedding into its neighbour's.
	 */
	t0: number;
	t1: number;
}

/** The shipped order. Imported rather than restated so the weights cannot drift from it. */
export const FEATURES = SECTION_FEATURES;

if (argv.includes('--extract')) {
	const shardAt = argv.indexOf('--shard');
	if (shardAt >= 0) {
		const shard = Number(argv[shardAt + 1]);
		const shards = Number(argv[shardAt + 2]);
		mkdirSync(FEAT_DIR, { recursive: true });
		const corpus = loadStructureCorpus('harmonix').filter((_, i) => i % shards === shard);

		for (const ref of corpus) {
			try {
				if (ref.masterDuration === undefined) continue;
				const audio = await decodeAudio(ref.audio);
				if (Math.abs(audio.duration / ref.masterDuration - 1) > MAX_DURATION_DRIFT) continue;

				const loud = measureLoudness(audio.mono, audio.sampleRate);
				const mono = Float32Array.from(audio.mono);
				const gain = Math.pow(10, (-14 - loud.integrated) / 20);
				if (Number.isFinite(gain) && Math.abs(gain - 1) > 0.01) {
					const g = Math.min(gain, 40);
					for (let i = 0; i < mono.length; i++) mono[i] *= g;
				}

				const f = extractFeatures(mono, audio.sampleRate);
				const fit = fitOffset(f.odf, f.curves.fps, ref.beats);
				if (fit.sharpness < MIN_SHARPNESS) continue;

				const ch = chromagram(mono, audio.sampleRate);
				const grid = detectBeats(f.odf, f.curves.fps, audio.duration, {});
				const bf = beatSynchronous(f.spec, ch, f.curves, f.odf, grid.beats, audio.duration);
				const meter = detectMeter(bf);
				const bars = barSynchronous(bf, meter.beatsPerBar, meter.phase);
				if (bars.count < 8) continue;

				const sim = similarityMatrix(bars);
				const bounds = segmentBars(sim, bars);
				const groups = groupSegments(sim, bars.count, bounds);

				const det = detectDrums(f.spec, { beatPeriod: grid.beatPeriod, odf: f.odf });
				const q = (t: number[]) =>
					quantiseOnsets(t, {
						beats: grid.beats,
						beatsPerBar: meter.beatsPerBar,
						downbeatPhase: meter.phase,
						duration: audio.duration
					}).times;
				const perBar = (times: readonly number[]) => {
					const out = new Int32Array(bars.count);
					for (const t of times) {
						for (let b = 0; b < bars.count; b++) {
							if (t >= bars.time[b] && t < bars.time[b + 1]) {
								out[b]++;
								break;
							}
						}
					}
					return out;
				};
				const kicks = perBar(q(det.kick));
				const snares = perBar(q(det.snare));
				const bandsDb = bandLevels(f.spec, bars.time, bars.count);

				const plan = arrange(
					bandsDb,
					bars,
					bounds,
					groups,
					loud.shortTerm,
					loud.shortTermFps,
					kicks,
					snares
				);
				if (plan.segments.length === 0) continue;

				const { energy, bands } = levelEnvelopes(
					bandsDb,
					loud.shortTerm,
					loud.shortTermFps,
					bars.time,
					bars.count
				);

				const vectors = sectionFeatures({
					energy,
					bands,
					kicks,
					snares,
					segments: plan.segments,
					barCount: bars.count
				});

				const ann = ref.segments[0];
				const rows: Row[] = [];
				for (const [i, s] of plan.segments.entries()) {
					const x = vectors[i];

					// The annotation's majority kind over the span, in frames, on the audio's own
					// clock. Majority rather than midpoint because a span that straddles a boundary
					// should be judged by what most of it is, which is also what the room shows.
					const start = bars.time[s.startBar] - fit.offset;
					const end = bars.time[Math.min(s.endBar, bars.count)] - fit.offset;
					const votes = new Array(KINDS.length).fill(0);
					let counted = 0;
					for (let t = start; t < end; t += 0.1) {
						for (const a of ann) {
							if (t < a.start || t >= a.end) continue;
							const k = kindOf(a.label);
							if (k === null) break;
							votes[KINDS.indexOf(k)]++;
							counted++;
							break;
						}
					}
					let y = -1;
					if (counted > 0) {
						y = 0;
						for (let k = 1; k < votes.length; k++) if (votes[k] > votes[y]) y = k;
					}

					rows.push({
						x,
						y,
						baseline: KINDS.indexOf(s.kind as SectionKind),
						weight: Math.max(1, counted),
						t0: bars.time[s.startBar],
						t1: bars.time[Math.min(s.endBar, bars.count)]
					});
				}

				const usable = rows.filter((r) => r.y >= 0);
				if (usable.length < 3) continue;
				writeFileSync(
					join(FEAT_DIR, `${ref.key.replace(/[^a-z0-9]+/gi, '_')}.json`),
					JSON.stringify({ key: ref.key, rows: usable })
				);
				process.stdout.write(`${ref.key} ${usable.length}\n`);
			} catch (e) {
				process.stderr.write(`skip ${ref.key}: ${String(e).slice(0, 120)}\n`);
			}
		}
	} else {
		const shards = Number(flag('shards') ?? Math.max(1, Math.min(5, availableParallelism() - 2)));
		console.error(`extracting section features, ${shards} shards`);
		await Promise.all(
			Array.from({ length: shards }, (_, s) =>
				new Promise<void>((resolve) => {
					const child = spawn(
						process.execPath,
						[import.meta.filename, '--extract', '--shard', String(s), String(shards)],
						{ stdio: ['ignore', 'inherit', 'inherit'] }
					);
					child.on('close', () => resolve());
				})
			)
		);
		console.error(`done, ${readdirSync(FEAT_DIR).length} tracks`);
	}
} else {
	if (!existsSync(FEAT_DIR)) throw new Error('run with --extract first');
	const tracks = readdirSync(FEAT_DIR)
		.filter((f) => f.endsWith('.json'))
		.map((f) => JSON.parse(readFileSync(join(FEAT_DIR, f), 'utf8')) as { key: string; rows: Row[] });

	const folds = Number(flag('folds') ?? 5);
	const classes = KINDS.length;

	// --- optional learned features -------------------------------------------------------------
	// Pooled per section from a frame-level model embedding, reduced by a PCA that is refitted
	// inside every fold. Fitting the PCA once over everything would leak the test tracks into the
	// basis, which is a small leak that reliably buys a few free points.
	const embedDir = flag('embed');
	const layer = Number(flag('layer') ?? 2);
	const components = Number(flag('components') ?? 48);
	// Sub-spans per section. See poolSpan: more than one keeps the trajectory a build is made of.
	const slices = Number(flag('slices') ?? 1);
	const mode = flag('mode') ?? (embedDir ? 'both' : 'hand');

	const pooled = new Map<string, Float32Array[]>();
	let embedDim = 0;
	if (embedDir) {
		for (const t of tracks) {
			const id = t.key.replace(/^harmonix\//, '');
			let npy: Npy;
			let meta: { fps: number; layers: number[] };
			try {
				npy = readNpy(join(embedDir, `${id}.npy`));
				meta = JSON.parse(readFileSync(join(embedDir, `${id}.json`), 'utf8'));
			} catch {
				continue;
			}
			embedDim = npy.shape[2] * slices;
			const vecs = t.rows.map((r) => {
				const out = new Float32Array(embedDim);
				poolSpan(npy, meta.fps, layer, r.t0, r.t1, out, slices);
				return out;
			});
			pooled.set(t.key, vecs);
		}
		const missing = tracks.filter((t) => !pooled.has(t.key)).length;
		console.error(
			`embeddings: ${pooled.size} tracks, ${missing} missing, dim ${embedDim}, ` +
				`layer index ${layer}, PCA to ${components}`
		);
	}

	const usable = embedDir ? tracks.filter((t) => pooled.has(t.key)) : tracks;
	const handDim = FEATURES.length;
	const dim =
		mode === 'hand' ? handDim : mode === 'embed' ? components : handDim + components;

	/**
	 * A one-hidden-layer classifier, full-batch, deterministic.
	 *
	 * `hidden = 0` degenerates to softmax regression, which is the honest linear reference: the
	 * gap between the two says whether `arrange()`'s thresholds were the wrong SHAPE or merely
	 * the wrong numbers.
	 *
	 * Class weights are not a nicety here. `build` is 5.9% of annotated frames and `breakdown`
	 * 0.5%, so an unweighted fit maximises accuracy by never emitting either, which scores 62%
	 * while removing two of the seven instructions the room has. Weighting by inverse frequency
	 * makes the loss care about them, and macro-F1 is what reports whether it worked.
	 */
	function fit(train: Row[], hidden: number, balance: boolean, epochs = 600, lr = 0.35, l2 = 1e-4, nClasses = classes) {
		// Deterministic init: a fixed LCG, so two runs of the same fold give the same model and a
		// difference between two feature sets is the feature set rather than the seed.
		let seed = 0x2f6e2b1;
		const rand = () => {
			seed = (seed * 1103515245 + 12345) & 0x7fffffff;
			return seed / 0x7fffffff - 0.5;
		};

		const h = Math.max(0, hidden);
		const W1 = new Float64Array(h * dim);
		const b1 = new Float64Array(h);
		const W2 = new Float64Array(nClasses * (h || dim));
		const b2 = new Float64Array(nClasses);
		const inDim = h || dim;
		for (let i = 0; i < W1.length; i++) W1[i] = rand() * Math.sqrt(2 / dim);
		for (let i = 0; i < W2.length; i++) W2[i] = rand() * Math.sqrt(2 / inDim);

		const perClass = new Float64Array(nClasses);
		for (const r of train) perClass[r.y] += r.weight;
		const totalW = train.reduce((a, r) => a + r.weight, 0) || 1;
		const classW = new Float64Array(nClasses);
		for (let c = 0; c < nClasses; c++) {
			classW[c] = balance && perClass[c] > 0 ? totalW / (nClasses * perClass[c]) : 1;
		}

		const hid = new Float64Array(inDim);
		const p = new Float64Array(nClasses);
		const gW1 = new Float64Array(W1.length);
		const gb1 = new Float64Array(h);
		const gW2 = new Float64Array(W2.length);
		const gb2 = new Float64Array(nClasses);
		const dHid = new Float64Array(inDim);

		const forward = (x: number[]): void => {
			if (h === 0) {
				for (let d = 0; d < dim; d++) hid[d] = x[d];
			} else {
				for (let j = 0; j < h; j++) {
					let z = b1[j];
					for (let d = 0; d < dim; d++) z += W1[j * dim + d] * x[d];
					hid[j] = Math.tanh(z);
				}
			}
			let max = -Infinity;
			for (let c = 0; c < nClasses; c++) {
				let z = b2[c];
				for (let d = 0; d < inDim; d++) z += W2[c * inDim + d] * hid[d];
				p[c] = z;
				if (z > max) max = z;
			}
			let sum = 0;
			for (let c = 0; c < nClasses; c++) {
				p[c] = Math.exp(p[c] - max);
				sum += p[c];
			}
			for (let c = 0; c < nClasses; c++) p[c] /= sum;
		};

		for (let e = 0; e < epochs; e++) {
			gW1.fill(0);
			gb1.fill(0);
			gW2.fill(0);
			gb2.fill(0);
			let norm = 0;
			for (const r of train) norm += r.weight * classW[r.y];

			for (const r of train) {
				forward(r.x);
				const w = (r.weight * classW[r.y]) / (norm || 1);
				dHid.fill(0);
				for (let c = 0; c < nClasses; c++) {
					const g = w * (p[c] - (c === r.y ? 1 : 0));
					gb2[c] += g;
					for (let d = 0; d < inDim; d++) {
						gW2[c * inDim + d] += g * hid[d];
						dHid[d] += g * W2[c * inDim + d];
					}
				}
				if (h > 0) {
					for (let j = 0; j < h; j++) {
						const g = dHid[j] * (1 - hid[j] * hid[j]);
						gb1[j] += g;
						for (let d = 0; d < dim; d++) gW1[j * dim + d] += g * r.x[d];
					}
				}
			}

			for (let c = 0; c < nClasses; c++) {
				b2[c] -= lr * gb2[c];
				for (let d = 0; d < inDim; d++) {
					W2[c * inDim + d] -= lr * (gW2[c * inDim + d] + l2 * W2[c * inDim + d]);
				}
			}
			for (let j = 0; j < h; j++) {
				b1[j] -= lr * gb1[j];
				for (let d = 0; d < dim; d++) W1[j * dim + d] -= lr * (gW1[j * dim + d] + l2 * W1[j * dim + d]);
			}
		}

		const predict = (x: number[]): number => {
			forward(x);
			let best = 0;
			for (let c = 1; c < nClasses; c++) if (p[c] > p[best]) best = c;
			return best;
		};
		// Only meaningful for the linear model, which is the one that ships.
		predict.W2 = W2;
		predict.b2 = b2;
		predict.linear = h === 0;
		return predict;
	}

	/** The shipped decision: two classes, linear, unweighted. */
	function fitBinary(train: Row[]) {
		return fit(train, 0, false, 600, 0.35, 1e-4, 2);
	}

	interface Result {
		name: string;
		correct: number;
		confusion: number[];
	}

	const MODELS: { name: string; hidden: number; balance: boolean }[] = [
		{ name: 'softmax', hidden: 0, balance: false },
		{ name: 'softmax balanced', hidden: 0, balance: true },
		{ name: 'mlp-24 balanced', hidden: 24, balance: true }
	];

	const results: Result[] = MODELS.map((m) => ({
		name: m.name,
		correct: 0,
		confusion: new Array(classes * classes).fill(0)
	}));
	const shipped: Result = { name: 'arrange() thresholds', correct: 0, confusion: new Array(classes * classes).fill(0) };

	let total = 0;
	let majorityCorrect = 0;
	const prior = new Array(classes).fill(0);
	for (const t of usable) for (const r of t.rows) prior[r.y] += r.weight;
	const majority = prior.indexOf(Math.max(...prior));

	for (let k = 0; k < folds; k++) {
		const test = usable.filter((_, i) => i % folds === k);
		const trainTracks = usable.filter((_, i) => i % folds !== k);

		// The basis comes from the training tracks alone, then both sides are projected through it.
		const projection =
			mode === 'hand'
				? null
				: fitPca(
						trainTracks.flatMap((t) => pooled.get(t.key) ?? []),
						embedDim,
						components
					);

		const buffer: number[] = new Array(components).fill(0);
		const vectorise = (t: { key: string }, r: Row, i: number): number[] => {
			if (mode === 'hand' || !projection) return r.x;
			project(projection, pooled.get(t.key)![i], buffer);
			return mode === 'embed' ? [...buffer] : [...r.x, ...buffer];
		};

		const train = trainTracks.flatMap((t) => t.rows.map((r, i) => ({ ...r, x: vectorise(t, r, i) })));
		const predictors = MODELS.map((m) => fit(train, m.hidden, m.balance));

		for (const t of test) {
			for (const [i, r] of t.rows.entries()) {
				const x = vectorise(t, r, i);
				total += r.weight;
				if (majority === r.y) majorityCorrect += r.weight;
				if (r.baseline === r.y) shipped.correct += r.weight;
				if (r.baseline >= 0) shipped.confusion[r.y * classes + r.baseline] += r.weight;
				for (const [j, predict] of predictors.entries()) {
					const yhat = predict(x);
					if (yhat === r.y) results[j].correct += r.weight;
					results[j].confusion[r.y * classes + yhat] += r.weight;
				}
			}
		}
	}

	/** Macro-F1 over the classes the annotation actually contains. */
	function macroF1(confusion: number[]): { macro: number; per: (number | null)[] } {
		const per: (number | null)[] = [];
		let sum = 0;
		let n = 0;
		for (let c = 0; c < classes; c++) {
			let tp = 0;
			let fp = 0;
			let fn = 0;
			for (let i = 0; i < classes; i++) {
				if (i === c) tp = confusion[c * classes + c];
				else {
					fn += confusion[c * classes + i];
					fp += confusion[i * classes + c];
				}
			}
			if (tp + fn === 0) {
				per.push(null);
				continue;
			}
			const f = tp > 0 ? (2 * tp) / (2 * tp + fp + fn) : 0;
			per.push(f);
			sum += f;
			n++;
		}
		return { macro: n > 0 ? sum / n : 0, per };
	}

	// --- export -------------------------------------------------------------------------------
	// Trained on every track, which is what ships; the cross-validated figure below is what it is
	// honestly worth. Reported separately and never conflated: a model scored on its own training
	// tracks would read about ten points better than it performs on a track it has not seen.
	const exportTo = flag('export');
	if (exportTo) {
		if (mode !== 'hand') throw new Error('only the hand-feature model ships');

		// Fitted on exactly the decision `arrange()` makes, which is groove against drop and
		// nothing else. A seven-way fit restricted to two logits at serve time is a different
		// model: measured end to end that way, `drop` came out 58.4% of frames against an
		// annotated 42.1%, because the drop logit was only ever calibrated against five rivals
		// it no longer has. Train the question you are going to ask.
		const GROOVE = KINDS.indexOf('groove');
		const DROP = KINDS.indexOf('drop');
		const binary = (rows: Row[]): Row[] =>
			rows.filter((r) => r.y === GROOVE || r.y === DROP).map((r) => ({ ...r, y: r.y === DROP ? 1 : 0 }));

		// Cross-validated on the same split discipline as everything else, so the number in the
		// generated file is what it is worth on a track the fit never saw.
		let binCorrect = 0;
		let binTotal = 0;
		let binMajority = 0;
		for (let k = 0; k < folds; k++) {
			const test = binary(usable.filter((_, i) => i % folds === k).flatMap((t) => t.rows));
			const train = binary(usable.filter((_, i) => i % folds !== k).flatMap((t) => t.rows));
			const predict = fitBinary(train);
			let ones = 0;
			for (const r of train) ones += r.y === 1 ? r.weight : 0;
			const majorityClass = ones * 2 > train.reduce((a, r) => a + r.weight, 0) ? 1 : 0;
			for (const r of test) {
				binTotal += r.weight;
				if (predict(r.x) === r.y) binCorrect += r.weight;
				if (majorityClass === r.y) binMajority += r.weight;
			}
		}

		const model = fitBinary(binary(usable.flatMap((t) => t.rows)));
		const cv = ((100 * binCorrect) / Math.max(1, binTotal)).toFixed(1);
		const majorityPct = ((100 * binMajority) / Math.max(1, binTotal)).toFixed(1);
		const w = [0, 1].map((c) =>
			[...model.W2.subarray(c * dim, (c + 1) * dim)].map((v) => Number(v.toFixed(6)))
		);

		const body = `import { SECTION_FEATURE_COUNT } from './sectionFeatures.ts';

/**
 * Groove against drop, as softmax weights over \`SECTION_FEATURES\`.
 *
 * GENERATED by \`node bench/kindfit.ts --export <path>\`. Do not hand-edit: the coefficients are
 * indexed by feature ORDER, so an edit that looks local is a different model.
 *
 * Fitted on ${usable.length} Harmonix tracks annotated with musical function. Cross-validated five ways
 * and grouped BY TRACK, so it is scored only on tracks the fit never saw: it calls this decision
 * right on ${cv}% of annotated frames, against ${majorityPct}% for always answering the commoner of
 * the two. The hand-written thresholds it replaces reached F1 47.2 on groove and 53.6 on drop
 * where a fit on the same features reaches 62.0 and 67.2.
 *
 * This is the only label a model decides here. Build, breakdown, void, intro and outro keep their
 * rules, and the rules win on them: the build walk-back scores 15.3 F1 against a model's 0.0,
 * because a build is defined by where it is GOING and no summary of what a section contains can
 * see that.
 */

/** Weights for [groove, drop]. */
const WEIGHTS: number[][] = ${JSON.stringify(w)};

const BIAS: number[] = ${JSON.stringify([...model.b2].slice(0, 2).map((v) => Number(v.toFixed(6))))};

if (WEIGHTS[0].length !== SECTION_FEATURE_COUNT) {
	throw new Error(
		'section model has ' + WEIGHTS[0].length + ' weights for ' + SECTION_FEATURE_COUNT + ' features; refit it'
	);
}

/** True when this section reads as a drop rather than a groove. */
export function readsAsDrop(x: readonly number[]): boolean {
	let z = BIAS[1] - BIAS[0];
	for (let d = 0; d < SECTION_FEATURE_COUNT; d++) z += (WEIGHTS[1][d] - WEIGHTS[0][d]) * x[d];
	return z > 0;
}
`;
		writeFileSync(exportTo, body);
		console.log(`\nwrote ${exportTo}: groove/drop, ${dim} features, ${cv}% CV against ${majorityPct}% majority`);
	}

	const pct = (n: number) => ((100 * n) / Math.max(1, total)).toFixed(1).padStart(7);
	console.log(
		`\n${usable.length} tracks, ${total} annotated frames, ${folds}-fold grouped by track, ` +
			`features: ${mode}\n`
	);
	console.log(
		`${'model'.padEnd(24)}${'accuracy'.padStart(10)}${'macro F1'.padStart(10)}   ` +
			KINDS.map((k) => k.slice(0, 8).padStart(9)).join('')
	);

	const report = (r: Result) => {
		const { macro, per } = macroF1(r.confusion);
		console.log(
			r.name.padEnd(24) +
				pct(r.correct).padStart(10) +
				(100 * macro).toFixed(1).padStart(10) +
				'   ' +
				per.map((f) => (f === null ? '-'.padStart(9) : (100 * f).toFixed(1).padStart(9))).join('')
		);
	};

	console.log(
		`${`always-${KINDS[majority]}`.padEnd(24)}${pct(majorityCorrect).padStart(10)}${''.padStart(10)}`
	);
	report(shipped);
	for (const r of results) report(r);

	const best = results[results.length - 1];
	console.log(`\nconfusion for ${best.name}, row = annotated, column = predicted, % of the row`);
	console.log(`${''.padEnd(11)}${KINDS.map((c) => c.slice(0, 8).padStart(10)).join('')}`);
	for (let r = 0; r < classes; r++) {
		let rowTotal = 0;
		for (let c = 0; c < classes; c++) rowTotal += best.confusion[r * classes + c];
		if (rowTotal === 0) continue;
		console.log(
			KINDS[r].padEnd(11) +
				KINDS.map((_, c) => ((100 * best.confusion[r * classes + c]) / rowTotal).toFixed(1).padStart(10)).join('')
		);
	}
}
