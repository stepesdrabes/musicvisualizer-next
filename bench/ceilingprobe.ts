import { arrange } from '../packages/analysis/src/arrange.ts';
import { groupSegments, segmentBars, similarityMatrix } from '../packages/analysis/src/structure.ts';
import { cacheIndex, cachedBars, readCache } from './struct-cache.ts';
import { scoreSegments, type Segment, type SegmentScores } from './segment-metrics.ts';

/**
 * How much of the structure loss is the boundaries and how much is the labels.
 *
 * Deciding where to spend a model needs the split, not the total. Substituting the annotation
 * for one stage at a time gives the ceiling each stage would reach if the other were perfect,
 * and the difference between the two ceilings is the only honest way to rank them.
 *
 * Oracle boundaries are the annotation's own times snapped to the nearest bar, because the
 * downstream contract is bar-indexed and a boundary the grid cannot express is not reachable
 * however good a detector gets. That snap is therefore part of the ceiling, not an artefact.
 *
 *   node bench/ceilingprobe.ts [--limit 50]
 */

const argv = process.argv.slice(2);
const flag = (n: string) => {
	const i = argv.indexOf(`--${n}`);
	return i >= 0 ? argv[i + 1] : undefined;
};
const limit = Number(flag('limit') ?? Infinity);

interface Variant {
	name: string;
	scores: SegmentScores[];
	grooveShare: number[];
}

const variants: Variant[] = [
	{ name: 'as shipped', scores: [], grooveShare: [] },
	{ name: 'oracle boundaries', scores: [], grooveShare: [] },
	{ name: 'oracle labels', scores: [], grooveShare: [] },
	{ name: 'oracle both', scores: [], grooveShare: [] }
];

/** Nearest bar index to a time, clamped into the grid. */
function barAt(time: Float64Array, count: number, t: number): number {
	let lo = 0;
	let hi = count;
	while (hi - lo > 1) {
		const mid = (lo + hi) >> 1;
		if (time[mid] <= t) lo = mid;
		else hi = mid;
	}
	return Math.abs(time[lo] - t) <= Math.abs(time[Math.min(hi, count)] - t) ? lo : Math.min(hi, count);
}

/** The annotation's label covering a time, or null past its end. */
function labelAt(ann: readonly Segment[], t: number): string | null {
	for (const s of ann) if (t >= s.start && t < s.end) return s.label;
	return null;
}

for (const entry of cacheIndex().slice(0, limit)) {
	const c = readCache(entry.key);
	const bars = cachedBars(c);
	if (bars.count < 8) continue;
	const ann = c.segments[0];
	if (!ann || ann.length < 2) continue;

	const sim = similarityMatrix(bars);
	const detected = segmentBars(sim, bars);

	// The annotation's boundaries as bar indices, deduplicated: two annotated changes inside one
	// bar cannot both be expressed, and pretending they can would flatter the ceiling.
	const oracleBounds = [...new Set(ann.map((s) => barAt(bars.time, bars.count, s.start)).concat(bars.count))]
		.filter((b) => b >= 0 && b <= bars.count)
		.sort((a, b) => a - b);
	if (oracleBounds[0] !== 0) oracleBounds.unshift(0);

	const build = (bounds: number[]): Segment[] => {
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
		return plan.segments.map((s) => ({
			start: bars.time[s.startBar],
			end: bars.time[Math.min(s.endBar, bars.count)],
			label: s.kind
		}));
	};

	// A perfect labeller on whichever boundaries it was handed: each span takes the annotation's
	// label at its own midpoint, which is the best any classifier of that span could do.
	const relabel = (segs: Segment[]): Segment[] =>
		segs.map((s) => ({
			...s,
			label: labelAt(ann, (s.start + s.end) / 2) ?? s.label
		}));

	const shipped = build(detected);
	const oracleB = build(oracleBounds);
	const cases: Segment[][] = [shipped, oracleB, relabel(shipped), relabel(oracleB)];

	for (const [i, est] of cases.entries()) {
		if (est.length === 0) continue;
		const scored = c.segments.map((a) => scoreSegments(a, est));
		const mean = (pick: (s: SegmentScores) => number) =>
			scored.reduce((acc, s) => acc + pick(s), 0) / scored.length;
		variants[i].scores.push({
			f05: mean((s) => s.f05),
			f3: mean((s) => s.f3),
			pairwiseF: mean((s) => s.pairwiseF),
			nceOver: mean((s) => s.nceOver),
			nceUnder: mean((s) => s.nceUnder),
			nceF: mean((s) => s.nceF),
			refSegments: mean((s) => s.refSegments),
			estSegments: scored[0].estSegments,
			longestEstShare: scored[0].longestEstShare
		});
		let groove = 0;
		for (const s of est) if (s.label === 'groove') groove += s.end - s.start;
		const span = est[est.length - 1].end - est[0].start;
		variants[i].grooveShare.push(span > 0 ? groove / span : 0);
	}
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

console.log(`\n${variants[0].scores.length} tracks\n`);
console.log(
	`${'variant'.padEnd(20)}${'F0.5'.padStart(8)}${'F3'.padStart(8)}${'pairwise'.padStart(10)}` +
		`${'over-seg'.padStart(10)}${'sections'.padStart(10)}${'groove %'.padStart(10)}`
);
for (const v of variants) {
	console.log(
		v.name.padEnd(20) +
			(100 * avg(v.scores.map((s) => s.f05))).toFixed(1).padStart(8) +
			(100 * avg(v.scores.map((s) => s.f3))).toFixed(1).padStart(8) +
			(100 * avg(v.scores.map((s) => s.pairwiseF))).toFixed(1).padStart(10) +
			(100 * avg(v.scores.map((s) => s.nceOver))).toFixed(1).padStart(10) +
			avg(v.scores.map((s) => s.estSegments)).toFixed(2).padStart(10) +
			(100 * avg(v.grooveShare)).toFixed(1).padStart(10)
	);
}

const base = avg(variants[0].scores.map((s) => s.pairwiseF));
const boundaryGain = avg(variants[1].scores.map((s) => s.pairwiseF)) - base;
const labelGain = avg(variants[2].scores.map((s) => s.pairwiseF)) - base;
console.log(
	`\npairwise headroom: boundaries +${(100 * boundaryGain).toFixed(1)}, ` +
		`labels +${(100 * labelGain).toFixed(1)}, ` +
		`both +${(100 * (avg(variants[3].scores.map((s) => s.pairwiseF)) - base)).toFixed(1)}`
);
