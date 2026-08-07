import { arrange } from '../packages/analysis/src/arrange.ts';
import { groupSegments, segmentBars, similarityMatrix } from '../packages/analysis/src/structure.ts';
import { cacheIndex, cachedBars, readCache } from './struct-cache.ts';
import { mean, quantile } from '../packages/analysis/src/dsp/stats.ts';

/**
 * What each section label actually means in energy terms, over the cached corpus.
 *
 * The complaint this answers: "breakdown" is assigned by a within-track quantile, so it is
 * guaranteed to exist however flat the track is, and its energy range overlaps groove's.
 */
const rows = new Map<string, number[]>();
const perTrack = new Map<string, number[]>();
/** Per kind: bars, then the drum descriptors a label ought to be able to be read off. */
const drums = new Map<string, { bars: number; kick: number[]; snare: number[]; kit: number[] }>();
let allBars = 0;
let tracks = 0;
let withBreakdown = 0;
let breakdownAboveMedian = 0;

for (const entry of cacheIndex()) {
	const c = readCache(entry.key);
	const bars = cachedBars(c);
	if (bars.count < 8) continue;
	const sim = similarityMatrix(bars);
	const bounds = segmentBars(sim, bars);
	const groups = groupSegments(sim, bars.count, bounds);
	const plan = arrange(c.bandsDb, bars, bounds, groups, c.shortTerm, c.shortTermFps, c.kicks, c.snares);
	if (plan.segments.length === 0) continue;
	tracks++;

	const energies = plan.segments.map((s) => 100 * mean(plan.energy, s.startBar, s.endBar));
	const mid = quantile(energies, 0.5);
	let anyBreakdown = false;
	for (const [i, s] of plan.segments.entries()) {
		if (!rows.has(s.kind)) rows.set(s.kind, []);
		rows.get(s.kind)!.push(energies[i]);

		if (!drums.has(s.kind)) drums.set(s.kind, { bars: 0, kick: [], snare: [], kit: [] });
		const d = drums.get(s.kind)!;
		const n = s.endBar - s.startBar;
		let kicks = 0;
		let snares = 0;
		let played = 0;
		for (let b = s.startBar; b < Math.min(s.endBar, c.kicks.length); b++) {
			kicks += c.kicks[b];
			snares += c.snares[b];
			if (c.kicks[b] > 0 || c.snares[b] > 0) played++;
		}
		d.bars += n;
		allBars += n;
		// Per beat rather than per bar, so 4/4 and 3/4 are the same number.
		d.kick.push(kicks / Math.max(1, n) / c.beatsPerBar);
		d.snare.push(snares / Math.max(1, n) / c.beatsPerBar);
		d.kit.push(played / Math.max(1, n));
		if (s.kind !== 'breakdown') continue;
		anyBreakdown = true;
		if (energies[i] > mid) breakdownAboveMedian++;
	}
	if (anyBreakdown) withBreakdown++;
	perTrack.set(c.key, energies);
}

const fmt = (xs: number[]) =>
	`${String(xs.length).padStart(6)}  ${quantile(xs, 0).toFixed(0).padStart(4)} ${quantile(xs, 0.1).toFixed(0).padStart(4)} ${quantile(xs, 0.5).toFixed(0).padStart(4)} ${quantile(xs, 0.9).toFixed(0).padStart(4)} ${quantile(xs, 1).toFixed(0).padStart(4)}`;

console.log(`${tracks} tracks\n`);
console.log(`${'kind'.padEnd(12)}${'n'.padStart(6)}   min  p10  med  p90  max`);
for (const [kind, xs] of [...rows].sort((a, b) => b[1].length - a[1].length)) {
	console.log(`${kind.padEnd(12)}${fmt(xs)}`);
}

const bd = rows.get('breakdown') ?? [];
const gr = rows.get('groove') ?? [];
if (bd.length && gr.length) {
	const lo = Math.max(quantile(bd, 0.05), quantile(gr, 0.05));
	const hi = Math.min(quantile(bd, 0.95), quantile(gr, 0.95));
	console.log(`\nbreakdown p5-p95 ${quantile(bd, 0.05).toFixed(0)}-${quantile(bd, 0.95).toFixed(0)}`);
	console.log(`groove    p5-p95 ${quantile(gr, 0.05).toFixed(0)}-${quantile(gr, 0.95).toFixed(0)}`);
	console.log(`overlap          ${Math.max(0, hi - lo).toFixed(0)} points`);
}
console.log(
	`\ntracks with a breakdown        ${withBreakdown}/${tracks} (${((100 * withBreakdown) / tracks).toFixed(0)}%)`
);
console.log(`breakdowns above track median  ${breakdownAboveMedian}`);

// The headline: how much of the corpus each instruction is responsible for, and whether the
// drums say anything a label could be read off. A kind that is four fifths of every track is
// one instruction for most of the runtime whatever its energy range looks like.
console.log(`\n${'kind'.padEnd(12)}${'bars %'.padStart(8)}${'kick/beat'.padStart(11)}${'snare/beat'.padStart(12)}${'kit bars'.padStart(10)}`);
for (const [kind, d] of [...drums].sort((a, b) => b[1].bars - a[1].bars)) {
	console.log(
		kind.padEnd(12) +
			((100 * d.bars) / Math.max(1, allBars)).toFixed(1).padStart(8) +
			quantile(d.kick, 0.5).toFixed(2).padStart(11) +
			quantile(d.snare, 0.5).toFixed(2).padStart(12) +
			quantile(d.kit, 0.5).toFixed(2).padStart(10)
	);
}
console.log(`\ngroove share of bars\t${((100 * (drums.get('groove')?.bars ?? 0)) / Math.max(1, allBars)).toFixed(1)}`);
