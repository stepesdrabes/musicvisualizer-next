import { spawn } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { analyzeTrack, decodeAudio } from '@mv/analysis';
import { extractFeatures } from '../packages/analysis/src/features.ts';
import { loadStructureCorpus, fitOffset } from './structure-corpus.ts';
import { KINDS, kindOf, MAX_DURATION_DRIFT, MIN_SHARPNESS } from './kinds.ts';
import type { SectionKind } from '@mv/core';
import type { Segment } from './segment-metrics.ts';

/**
 * Whether the seven lighting kinds are the RIGHT seven, scored against annotated function.
 *
 * Everything else in bench scores structure against SALAMI, whose labels are letters: a, b, a'.
 * A letter says which passages are the same material and nothing at all about what any of them
 * is doing, so pairwise F can only ever measure the grouper. The complaint this probe exists for
 * is different - that most of the track comes out `groove` - and no letter-based metric can tell
 * a bar correctly called groove from a bar called groove because nothing better was tried.
 *
 * Harmonix annotates function (verse, chorus, prechorus, break) over 912 pop, dance and hip-hop
 * tracks, which is both the missing vocabulary and the actual repertoire. Mapped onto the seven
 * kinds it gives a per-frame accuracy and a confusion matrix: not a proxy for the room, but the
 * closest thing to the room a public annotation can supply.
 *
 *   node bench/kindprobe.ts [--shards 6] [--limit 60]
 */

const argv = process.argv.slice(2);
const flag = (n: string): string | undefined => {
	const i = argv.indexOf(`--${n}`);
	return i >= 0 ? argv[i + 1] : undefined;
};
const limit = Number(flag('limit') ?? Infinity);

/** Frame size for the per-frame scores, seconds. Same as the mir_eval-faithful metrics use. */
const FRAME = 0.1;

interface Row {
	key: string;
	/** Frames where the estimated kind equals the mapped annotated kind. */
	correct: number;
	frames: number;
	/** KINDS.length^2, row = reference, column = estimate. */
	confusion: number[];
	skipped?: string;
}

function labelAt(segments: readonly Segment[], t: number): string | null {
	for (const s of segments) if (t >= s.start && t < s.end) return s.label;
	return null;
}

const shardAt = argv.indexOf('--shard');
if (shardAt >= 0) {
	const shard = Number(argv[shardAt + 1]);
	const shards = Number(argv[shardAt + 2]);
	const corpus = loadStructureCorpus('harmonix')
		.slice(0, limit)
		.filter((_, i) => i % shards === shard);

	for (const ref of corpus) {
		try {
			const audio = await decodeAudio(ref.audio);
			if (ref.masterDuration) {
				const drift = Math.abs(audio.duration / ref.masterDuration - 1);
				if (drift > MAX_DURATION_DRIFT) {
					process.stdout.write(
						`${JSON.stringify({ key: ref.key, skipped: `length ${(100 * drift).toFixed(0)}% off the annotated edit` })}\n`
					);
					continue;
				}
			}
			const f = extractFeatures(audio.mono, audio.sampleRate);
			const fit = fitOffset(f.odf, f.curves.fps, ref.beats);
			if (fit.sharpness < MIN_SHARPNESS) {
				process.stdout.write(
					`${JSON.stringify({ key: ref.key, skipped: `offset ${fit.sharpness.toFixed(2)}` })}\n`
				);
				continue;
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

			// Annotation times live on the original master; the audio may start `fit.offset` later.
			const est: Segment[] = analysis.sections.map((s) => ({
				start: Math.max(0, s.startTime - fit.offset),
				end: Math.max(0, s.endTime - fit.offset),
				label: s.kind
			}));

			const ann = ref.segments[0];
			const end = Math.min(ann[ann.length - 1].end, est.length ? est[est.length - 1].end : 0);
			const frames = Math.max(0, Math.floor(end / FRAME));
			const confusion = new Array(KINDS.length * KINDS.length).fill(0);
			let correct = 0;
			let counted = 0;

			for (let i = 0; i < frames; i++) {
				const t = (i + 0.5) * FRAME;
				const refLabel = labelAt(ann, t);
				const estLabel = labelAt(est, t);
				if (refLabel === null || estLabel === null) continue;
				const refKind = kindOf(refLabel);
				if (refKind === null) continue;
				const r = KINDS.indexOf(refKind);
				const e = KINDS.indexOf(estLabel as SectionKind);
				if (r < 0 || e < 0) continue;
				confusion[r * KINDS.length + e]++;
				counted++;
				if (r === e) correct++;
			}

			if (counted === 0) {
				process.stdout.write(`${JSON.stringify({ key: ref.key, skipped: 'no frames' })}\n`);
				continue;
			}
			const row: Row = { key: ref.key, correct, frames: counted, confusion };
			process.stdout.write(`${JSON.stringify(row)}\n`);
		} catch (e) {
			process.stdout.write(`${JSON.stringify({ key: ref.key, skipped: String(e).slice(0, 140) })}\n`);
		}
	}
} else {
	const shards = Number(flag('shards') ?? Math.max(1, Math.min(6, availableParallelism() - 2)));
	const total = Math.min(limit, loadStructureCorpus('harmonix').length);
	console.error(`${total} harmonix tracks, ${shards} shards`);

	const rows: Row[] = [];
	const skipped: string[] = [];
	const started = performance.now();

	const run = (s: number) =>
		new Promise<void>((resolve, reject) => {
			const child = spawn(
				process.execPath,
				[import.meta.filename, '--shard', String(s), String(shards), '--limit', String(limit)],
				{ stdio: ['ignore', 'pipe', 'inherit'] }
			);
			let buf = '';
			child.stdout.on('data', (c: Buffer) => {
				buf += c.toString();
				let nl: number;
				while ((nl = buf.indexOf('\n')) >= 0) {
					const line = buf.slice(0, nl);
					buf = buf.slice(nl + 1);
					if (!line.trim()) continue;
					const row = JSON.parse(line) as Row;
					if (row.skipped) skipped.push(`${row.key}: ${row.skipped}`);
					else rows.push(row);
					const done = rows.length + skipped.length;
					if (done % 25 === 0) {
						const rate = done / ((performance.now() - started) / 1000);
						console.error(`  ${done}/${total}  eta ${((total - done) / rate).toFixed(0)}s`);
					}
				}
			});
			child.on('error', reject);
			child.on('close', () => resolve());
		});

	await Promise.all(Array.from({ length: shards }, (_, s) => run(s)));

	const n = KINDS.length;
	const confusion = new Array(n * n).fill(0);
	let correct = 0;
	let frames = 0;
	for (const row of rows) {
		correct += row.correct;
		frames += row.frames;
		for (let i = 0; i < n * n; i++) confusion[i] += row.confusion[i];
	}

	console.log(`\n${rows.length} tracks scored, ${skipped.length} skipped, ${frames} frames\n`);
	console.log(`frame accuracy   ${((100 * correct) / Math.max(1, frames)).toFixed(1)}%`);

	// Per-track mean as well as the pooled figure: a long track would otherwise decide the score.
	const perTrack = rows.map((r) => r.correct / Math.max(1, r.frames));
	console.log(
		`per-track mean   ${((100 * perTrack.reduce((a, b) => a + b, 0)) / Math.max(1, perTrack.length)).toFixed(1)}%`
	);

	console.log(`\nconfusion, row = annotated, column = estimated, % of the row`);
	console.log(`${''.padEnd(11)}${KINDS.map((k) => k.slice(0, 8).padStart(10)).join('')}${'ref %'.padStart(9)}`);
	for (let r = 0; r < n; r++) {
		let rowTotal = 0;
		for (let e = 0; e < n; e++) rowTotal += confusion[r * n + e];
		if (rowTotal === 0) continue;
		const cells = KINDS.map((_, e) => ((100 * confusion[r * n + e]) / rowTotal).toFixed(1).padStart(10)).join('');
		console.log(KINDS[r].padEnd(11) + cells + ((100 * rowTotal) / frames).toFixed(1).padStart(9));
	}

	console.log(`\n${'kind'.padEnd(11)}${'annotated %'.padStart(13)}${'estimated %'.padStart(13)}`);
	const refShare: number[] = [];
	for (let k = 0; k < n; k++) {
		let asRef = 0;
		let asEst = 0;
		for (let i = 0; i < n; i++) {
			asRef += confusion[k * n + i];
			asEst += confusion[i * n + k];
		}
		refShare.push(asRef / Math.max(1, frames));
		console.log(
			KINDS[k].padEnd(11) +
				((100 * asRef) / Math.max(1, frames)).toFixed(1).padStart(13) +
				((100 * asEst) / Math.max(1, frames)).toFixed(1).padStart(13)
		);
	}

	// Without these the accuracy above cannot be read. A seven-way score of 43% sounds like
	// signal until the constant answer scores 42, and the marginal distribution can match the
	// annotation exactly while every individual frame is wrong, which is what a share table
	// alone would hide.
	const majority = Math.max(...refShare);
	const chance = refShare.reduce((a, p) => a + p * p, 0);
	console.log(
		`\nbaselines        always-${KINDS[refShare.indexOf(majority)]} ${(100 * majority).toFixed(1)}%` +
			`   guessing at the annotated rate ${(100 * chance).toFixed(1)}%`
	);

	if (skipped.length) {
		const why = new Map<string, number>();
		for (const s of skipped) {
			const reason = s.includes('length') ? 'wrong edit' : s.includes('offset') ? 'offset unfittable' : 'error';
			why.set(reason, (why.get(reason) ?? 0) + 1);
		}
		console.error(`\nskipped ${skipped.length}: ${[...why].map(([k, v]) => `${k} ${v}`).join(', ')}`);
		console.error(`  ${skipped.slice(0, 6).join('\n  ')}`);
	}
}
