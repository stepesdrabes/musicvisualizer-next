import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { availableParallelism } from 'node:os';
import { analyzeTrack, decodeAudio } from '@mv/analysis';
import { extractFeatures } from '../packages/analysis/src/features.ts';
import { loadStructureCorpus, fitOffset, type StructureDataset } from './structure-corpus.ts';
import { MAX_DURATION_DRIFT } from './kinds.ts';
import { scoreSegments, type Segment, type SegmentScores } from './segment-metrics.ts';

/**
 * Score the analyser's sections against annotated structure.
 *
 *   node bench/run-structure.ts [--dataset harmonix|salami] [--label before]
 *
 * Reported per dataset, never pooled: SALAMI is aligned by construction and Harmonix is
 * aligned by a fitted offset, so the two carry different amounts of doubt.
 */

const argv = process.argv.slice(2);
const flag = (n: string): string | undefined => {
	const i = argv.indexOf(`--${n}`);
	return i >= 0 ? argv[i + 1] : undefined;
};
const dataset = (flag('dataset') ?? 'all') as StructureDataset | 'all';
const label = flag('label') ?? 'structure';

/** Below this the offset peak is not distinct and the upload is probably a different edit. */
const MIN_SHARPNESS = 1.15;

interface Row extends SegmentScores {
	key: string;
	dataset: string;
	offset: number;
	sharpness: number;
	skipped?: string;
}

const shardAt = argv.indexOf('--shard');
if (shardAt >= 0) {
	const shard = Number(argv[shardAt + 1]);
	const shards = Number(argv[shardAt + 2]);
	const corpus = loadStructureCorpus(dataset === 'all' ? undefined : dataset).filter(
		(_, i) => i % shards === shard
	);

	for (const ref of corpus) {
		try {
			const audio = await decodeAudio(ref.audio);
			let offset = 0;
			let sharpness = Infinity;
			// The upload has to be the edit that was annotated before its offset is worth fitting.
			if (ref.masterDuration !== undefined) {
				const drift = Math.abs(audio.duration / ref.masterDuration - 1);
				if (drift > MAX_DURATION_DRIFT) {
					process.stdout.write(
						`${JSON.stringify({ key: ref.key, dataset: ref.dataset, skipped: `wrong edit (${(100 * drift).toFixed(0)}% length)` })}\n`
					);
					continue;
				}
			}
			if (!ref.aligned) {
				const f = extractFeatures(audio.mono, audio.sampleRate);
				const fit = fitOffset(f.odf, f.curves.fps, ref.beats);
				offset = fit.offset;
				sharpness = fit.sharpness;
				if (sharpness < MIN_SHARPNESS) {
					process.stdout.write(
						`${JSON.stringify({ key: ref.key, dataset: ref.dataset, skipped: `offset peak not distinct (${sharpness.toFixed(2)})` })}\n`
					);
					continue;
				}
			}

			const analysis = analyzeTrack({
				mono: audio.mono,
				left: audio.left,
				right: audio.right,
				sampleRate: audio.sampleRate,
				duration: audio.duration,
				hash: audio.hash,
				trackId: ref.key,
				title: ref.key
			});

			// Annotation times live on the original master; the audio may start `offset` later.
			const est: Segment[] = analysis.sections.map((s) => ({
				start: Math.max(0, s.startTime - offset),
				end: Math.max(0, s.endTime - offset),
				label: s.kind
			}));

			// SALAMI has two annotators and neither is the truth, so a track scores as the mean
			// of what each says, which is what the published figures do.
			const scored = ref.segments.map((ann) => scoreSegments(ann, est));
			const mean = (pick: (s: SegmentScores) => number) =>
				scored.reduce((a, s) => a + pick(s), 0) / scored.length;

			const row: Row = {
				key: ref.key,
				dataset: ref.dataset,
				offset,
				sharpness: Number.isFinite(sharpness) ? sharpness : 99,
				f05: mean((s) => s.f05),
				f3: mean((s) => s.f3),
				pairwiseF: mean((s) => s.pairwiseF),
				nceOver: mean((s) => s.nceOver),
				nceUnder: mean((s) => s.nceUnder),
				nceF: mean((s) => s.nceF),
				refSegments: Math.round(mean((s) => s.refSegments)),
				estSegments: scored[0].estSegments,
				longestEstShare: scored[0].longestEstShare
			};
			process.stdout.write(`${JSON.stringify(row)}\n`);
		} catch (e) {
			process.stdout.write(`${JSON.stringify({ key: ref.key, skipped: String(e).slice(0, 160) })}\n`);
		}
	}
} else {
	const shardsFlag = argv.indexOf('--shards');
	const shards =
		shardsFlag >= 0
			? Number(argv[shardsFlag + 1])
			: Math.max(1, Math.min(availableParallelism() - 1, 7));
	const corpus = loadStructureCorpus(dataset === 'all' ? undefined : dataset);
	if (corpus.length === 0) {
		console.error('no structure corpus: run bench/fetch-structure.ts first');
		process.exit(1);
	}
	console.error(`${corpus.length} tracks, ${shards} shards, structure`);
	const started = performance.now();
	let done = 0;
	let skipped = 0;

	const run = (s: number): Promise<Row[]> =>
		new Promise((resolve, reject) => {
			const child = spawn(
				process.execPath,
				[join(import.meta.dirname, 'run-structure.ts'), '--dataset', dataset, '--shard', String(s), String(shards)],
				{ stdio: ['ignore', 'pipe', 'inherit'] }
			);
			const out: Row[] = [];
			let buf = '';
			child.stdout.on('data', (c: Buffer) => {
				buf += c.toString();
				let nl: number;
				while ((nl = buf.indexOf('\n')) >= 0) {
					const line = buf.slice(0, nl);
					buf = buf.slice(nl + 1);
					if (!line.trim()) continue;
					const row = JSON.parse(line) as Row;
					if (row.skipped) skipped++;
					else out.push(row);
					if (++done % 20 === 0) {
						const rate = done / ((performance.now() - started) / 1000);
						console.error(`  ${done}/${corpus.length}  ${rate.toFixed(1)}/s  eta ${((corpus.length - done) / rate).toFixed(0)}s`);
					}
				}
			});
			child.on('error', reject);
			child.on('close', (c) => (c === 0 ? resolve(out) : reject(new Error(`shard ${s} exited ${c}`))));
		});

	const results = (await Promise.all(Array.from({ length: shards }, (_, s) => run(s)))).flat();
	const dir = join(import.meta.dirname, 'reports');
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, `${label}.json`), JSON.stringify({ results }, null, '\t'));

	const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
	console.log(`\n=== ${label} ===   ${results.length} scored, ${skipped} skipped`);
	for (const ds of ['harmonix', 'salami']) {
		const rows = results.filter((r) => r.dataset === ds);
		if (rows.length === 0) continue;
		console.log(`\n${ds} (${rows.length} tracks)`);
		console.log(`  boundary F0.5      ${(100 * mean(rows.map((r) => r.f05))).toFixed(1)}%`);
		console.log(`  boundary F3        ${(100 * mean(rows.map((r) => r.f3))).toFixed(1)}%`);
		console.log(`  pairwise F         ${(100 * mean(rows.map((r) => r.pairwiseF))).toFixed(1)}%`);
		console.log(`  over-segmentation  ${(100 * mean(rows.map((r) => r.nceOver))).toFixed(1)}%`);
		console.log(`  under-segmentation ${(100 * mean(rows.map((r) => r.nceUnder))).toFixed(1)}%`);
		console.log(`  ref sections       ${mean(rows.map((r) => r.refSegments)).toFixed(1)}`);
		console.log(`  est sections       ${mean(rows.map((r) => r.estSegments)).toFixed(1)}`);
		console.log(`  longest section    ${(100 * mean(rows.map((r) => r.longestEstShare))).toFixed(1)}% of the track`);
	}
}
