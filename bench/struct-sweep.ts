import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { arrange } from '../packages/analysis/src/arrange.ts';
import { groupSegments, segmentBars, similarityMatrix } from '../packages/analysis/src/structure.ts';
import { cacheIndex, cachedBars, readCache } from './struct-cache.ts';
import { scoreSegments, type Segment, type SegmentScores } from './segment-metrics.ts';

/**
 * Score the segmenter and the labeller over the cached corpus, in seconds.
 *
 *   node bench/struct-cache.ts        # once, ~8 min
 *   node bench/struct-sweep.ts --label s-level [--diff s-base]
 *
 * Identical arithmetic to `run-structure.ts` from `barSynchronous` onward, so its numbers are
 * comparable with a full run; anything upstream of the bar table it cannot see.
 */

const argv = process.argv.slice(2);
const flag = (n: string) => {
	const i = argv.indexOf(`--${n}`);
	return i >= 0 ? argv[i + 1] : undefined;
};
const label = flag('label') ?? 'sweep';
const limit = Number(flag('limit') ?? Infinity);

interface Row extends SegmentScores {
	key: string;
	dataset: string;
	/** Share of the track's bars carrying the one label that means "going along", 0..1. */
	grooveShare: number;
}

const rows: Row[] = [];
const index = cacheIndex().slice(0, limit);
for (const entry of index) {
	const c = readCache(entry.key);
	const bars = cachedBars(c);
	const sim = similarityMatrix(bars);
	const bounds = segmentBars(sim, bars);
	const groups = groupSegments(sim, bars.count, bounds);
	const plan = arrange(
		c.bandsDb,
		bars,
		bounds,
		groups,
		c.shortTerm,
		c.shortTermFps,
		c.kicks,
		c.snares
	);

	const est: Segment[] = plan.segments.map((s) => ({
		start: bars.time[s.startBar],
		end: bars.time[Math.min(s.endBar, bars.count)],
		label: s.kind
	}));
	if (est.length === 0) continue;

	const scored = c.segments.map((ann) => scoreSegments(ann, est));
	const mean = (pick: (s: SegmentScores) => number) =>
		scored.reduce((a, s) => a + pick(s), 0) / scored.length;
	let grooveBars = 0;
	for (const s of plan.segments) {
		if (s.kind === 'groove') grooveBars += s.endBar - s.startBar;
	}

	rows.push({
		key: c.key,
		dataset: c.dataset,
		grooveShare: grooveBars / Math.max(1, bars.count),
		f05: mean((s) => s.f05),
		f3: mean((s) => s.f3),
		pairwiseF: mean((s) => s.pairwiseF),
		nceOver: mean((s) => s.nceOver),
		nceUnder: mean((s) => s.nceUnder),
		nceF: mean((s) => s.nceF),
		refSegments: Math.round(mean((s) => s.refSegments)),
		estSegments: scored[0].estSegments,
		longestEstShare: scored[0].longestEstShare
	});
}

const dir = join(import.meta.dirname, 'reports');
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, `${label}.json`), JSON.stringify({ results: rows }));

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const METRICS: [string, (r: Row) => number, number][] = [
	['groove share', (r) => r.grooveShare, 100],
	['boundary F0.5', (r) => r.f05, 100],
	['boundary F3', (r) => r.f3, 100],
	['pairwise F', (r) => r.pairwiseF, 100],
	['over-segmentation', (r) => r.nceOver, 100],
	['under-segmentation', (r) => r.nceUnder, 100],
	['ref sections', (r) => r.refSegments, 1],
	['est sections', (r) => r.estSegments, 1],
	['longest section', (r) => r.longestEstShare, 100]
];

const base = flag('diff');
const before: Row[] | null = base
	? JSON.parse(readFileSync(join(dir, `${base}.json`), 'utf8')).results
	: null;

console.log(`\n=== ${label} ===   ${rows.length} tracks`);
for (const [name, pick, scale] of METRICS) {
	const now = scale * avg(rows.map(pick));
	if (!before) {
		console.log(`  ${name.padEnd(20)}${now.toFixed(scale === 100 ? 1 : 2).padStart(8)}`);
		continue;
	}
	const then = scale * avg(before.map(pick));
	const d = now - then;
	console.log(
		`  ${name.padEnd(20)}${then.toFixed(scale === 100 ? 1 : 2).padStart(8)}${now.toFixed(scale === 100 ? 1 : 2).padStart(9)}   ${d >= 0 ? '+' : ''}${d.toFixed(2)}`
	);
}
