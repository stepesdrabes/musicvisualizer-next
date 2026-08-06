import { NUM_BANDS, nearestPhraseBar, onPhraseGrid, phraseOffset, type SectionKind } from '@mv/core';
import type { EventTag } from '@mv/core';
import { clamp01, dbAt, normalise01 } from './features.ts';
import type { Features } from './features.ts';

export interface BarFeatures {
	count: number;
	/** Time of each bar's downbeat. */
	time: Float32Array;
	/** dB means per bar, NUM_BANDS each. */
	bandDb: Float32Array;
	rms: Float32Array;
	centroid: Float32Array;
	flatness: Float32Array;
	novelty: Float32Array;
	kicks: Int32Array;
	snares: Int32Array;
	hats: Int32Array;
	/** Lowest rms of any 100 ms window in the bar; finds the pre-drop silence. */
	minRms: Float32Array;
}

export function barTime(
	firstBeat: number,
	beatPeriod: number,
	beatsPerBar: number,
	downbeatPhase: number,
	bar: number
): number {
	return firstBeat + (downbeatPhase + bar * beatsPerBar) * beatPeriod;
}

function countIn(times: readonly number[], from: number, to: number): number {
	let n = 0;
	for (const t of times) {
		if (t >= from && t < to) n++;
		else if (t >= to) break;
	}
	return n;
}

export function extractBarFeatures(
	features: Features,
	noveltyN: Float32Array,
	onsets: { kick: number[]; snare: number[]; hat: number[] },
	firstBeat: number,
	beatPeriod: number,
	beatsPerBar: number,
	downbeatPhase: number,
	duration: number
): BarFeatures {
	const barLength = beatPeriod * beatsPerBar;
	const start = barTime(firstBeat, beatPeriod, beatsPerBar, downbeatPhase, 0);
	const count = Math.max(1, Math.floor((duration - start) / barLength));
	const fr = features.featureRate;

	const time = new Float32Array(count);
	const bandDb = new Float32Array(count * NUM_BANDS);
	const rms = new Float32Array(count);
	const centroid = new Float32Array(count);
	const flatness = new Float32Array(count);
	const novelty = new Float32Array(count);
	const kicks = new Int32Array(count);
	const snares = new Int32Array(count);
	const hats = new Int32Array(count);
	const minRms = new Float32Array(count);

	const chunk = Math.max(1, Math.round(0.1 * fr));

	for (let b = 0; b < count; b++) {
		const t0 = start + b * barLength;
		const t1 = t0 + barLength;
		time[b] = t0;

		const f0 = Math.max(0, Math.round(t0 * fr));
		const f1 = Math.min(features.frameCount, Math.round(t1 * fr));
		const n = Math.max(1, f1 - f0);

		for (let k = 0; k < NUM_BANDS; k++) {
			let acc = 0;
			for (let f = f0; f < f1; f++) acc += dbAt(features.bandDb, f, k);
			bandDb[b * NUM_BANDS + k] = acc / n;
		}

		let accRms = 0;
		let accC = 0;
		let accF = 0;
		let accN = 0;
		let lowest = Infinity;
		let windowAcc = 0;
		let windowN = 0;
		for (let f = f0; f < f1; f++) {
			accRms += features.rms[f];
			accC += features.centroid[f];
			accF += features.flatness[f];
			accN += noveltyN[f];
			windowAcc += features.rms[f];
			windowN++;
			if (windowN === chunk) {
				lowest = Math.min(lowest, windowAcc / windowN);
				windowAcc = 0;
				windowN = 0;
			}
		}
		rms[b] = accRms / n;
		centroid[b] = accC / n;
		flatness[b] = accF / n;
		novelty[b] = accN / n;
		minRms[b] = Number.isFinite(lowest) ? lowest : rms[b];

		kicks[b] = countIn(onsets.kick, t0, t1);
		snares[b] = countIn(onsets.snare, t0, t1);
		hats[b] = countIn(onsets.hat, t0, t1);
	}

	return {
		count,
		time,
		bandDb,
		rms,
		centroid,
		flatness,
		novelty,
		kicks,
		snares,
		hats,
		minRms
	};
}

/**
 * Foote 2000 checkerboard novelty over z-normalised bar feature vectors. Section
 * boundaries show up as corners where two homogeneous blocks meet.
 */
export function footeNovelty(bars: BarFeatures, kernel = 4): Float32Array {
	const n = bars.count;
	const dims = NUM_BANDS + 2;
	const vec = new Float32Array(n * dims);

	for (let b = 0; b < n; b++) {
		for (let k = 0; k < NUM_BANDS; k++) vec[b * dims + k] = bars.bandDb[b * NUM_BANDS + k];
		vec[b * dims + NUM_BANDS] = bars.centroid[b] * 40;
		vec[b * dims + NUM_BANDS + 1] = bars.flatness[b] * 40;
	}

	for (let d = 0; d < dims; d++) {
		let sum = 0;
		for (let b = 0; b < n; b++) sum += vec[b * dims + d];
		const mean = sum / n;
		let sq = 0;
		for (let b = 0; b < n; b++) sq += (vec[b * dims + d] - mean) ** 2;
		const std = Math.sqrt(sq / n) || 1;
		for (let b = 0; b < n; b++) vec[b * dims + d] = (vec[b * dims + d] - mean) / std;
	}

	const sim = (i: number, j: number): number => {
		let dot = 0;
		let ni = 0;
		let nj = 0;
		for (let d = 0; d < dims; d++) {
			const a = vec[i * dims + d];
			const b = vec[j * dims + d];
			dot += a * b;
			ni += a * a;
			nj += b * b;
		}
		return dot / (Math.sqrt(ni * nj) + 1e-9);
	};

	const out = new Float32Array(n);
	const L = kernel;
	for (let b = L; b < n - L; b++) {
		let same = 0;
		let cross = 0;
		let wSame = 0;
		let wCross = 0;
		for (let i = 1; i <= L; i++) {
			for (let j = 1; j <= L; j++) {
				const taper = Math.exp(-((i * i + j * j) / (2 * (L / 2) ** 2)));
				same += sim(b - i, b - j) * taper + sim(b + i - 1, b + j - 1) * taper;
				wSame += 2 * taper;
				cross += sim(b - i, b + j - 1) * taper;
				wCross += taper;
			}
		}
		out[b] = Math.max(0, same / wSame - cross / wCross);
	}

	return normalise01(out);
}

/** Shortest run that counts as a sustained level rather than a passing bar. */
const MIN_LOUD_BARS = 4;
const MIN_QUIET_BARS = 2;

interface Run {
	start: number;
	end: number;
}

/**
 * Runs where the signal sits above `enter` (or below it, when `below`), with hysteresis so a
 * single bar dipping over the threshold does not split one section into three.
 */
function findRuns(
	a: Float32Array,
	n: number,
	enter: number,
	leave: number,
	minBars: number,
	below = false
): Run[] {
	const inside = (v: number, t: number) => (below ? v <= t : v >= t);
	const runs: Run[] = [];
	let start = -1;

	for (let b = 0; b <= n; b++) {
		const open = start >= 0;
		const active = b < n && inside(a[b], open ? leave : enter);
		if (active && !open) start = b;
		if (!active && open) {
			if (b - start >= minBars) runs.push({ start, end: b });
			start = -1;
		}
	}
	return runs;
}

function mergeGaps(runs: Run[], maxGap: number): Run[] {
	const out: Run[] = [];
	for (const run of runs) {
		const last = out[out.length - 1];
		if (last && run.start - last.end < maxGap) last.end = run.end;
		else out.push({ ...run });
	}
	return out;
}

export interface Segment {
	startBar: number;
	endBar: number;
	kind: SectionKind;
}

export interface StructureResult {
	segments: Segment[];
	/** The anchor actually used, which may differ from the one passed in. */
	phraseAnchorBar: number;
	/** Bar index of each detected drop, in time order. */
	dropBars: number[];
	events: EventTag[][];
	/** 0..1 per bar, normalised across the track. */
	energy: Float32Array;
	bands: Float32Array;
}

/**
 * Label the arrangement. Drops are found first because everything else is defined
 * relative to them: a build is what leads into one, a void is the silence at its edge.
 */
export function detectStructure(bars: BarFeatures, phraseAnchorBar = 0): StructureResult {
	const n = bars.count;
	const kind = new Array<SectionKind | null>(n).fill(null);
	const events: EventTag[][] = Array.from({ length: n }, () => []);

	const sub = normalise01(sliceBand(bars, 0));
	const low = normalise01(sliceBand(bars, 1));
	const mid = normalise01(sliceBand(bars, 2));
	const air = normalise01(sliceBand(bars, 3));
	const loud = normalise01(bars.rms);
	const density = normalise01(bars.kicks);

	// Weighted toward the bottom end rather than broadband loudness: a noise riser is loud
	// but is not the peak of the track, and weighting rms highly lets it outrank the drop.
	const energy = new Float32Array(n);
	for (let b = 0; b < n; b++) {
		energy[b] = clamp01(
			sub[b] * 0.34 + low[b] * 0.22 + loud[b] * 0.2 + mid[b] * 0.14 + density[b] * 0.1
		);
	}

	const bandsOut = new Float32Array(n * NUM_BANDS);
	for (let b = 0; b < n; b++) {
		bandsOut[b * NUM_BANDS] = sub[b];
		bandsOut[b * NUM_BANDS + 1] = low[b];
		bandsOut[b * NUM_BANDS + 2] = mid[b];
		bandsOut[b * NUM_BANDS + 3] = air[b];
	}

	// --- plateaus ----------------------------------------------------------------------
	// Sections are sustained levels, not onset events. What separates a chorus from a verse
	// is that it SITS higher for several bars, and how much higher is a property of the
	// track's own distribution rather than of any absolute threshold.
	const peak = Math.max(...energy);
	const hiEnter = Math.max(percentile(energy, 0.62), peak * 0.78);
	const hiLeave = hiEnter * 0.88;
	const quietLevel = Math.min(percentile(energy, 0.3), peak * 0.4);

	// Merge loud runs separated by a short dip: a bar or two of fill inside a chorus is not a
	// section boundary, and splitting there invents a build that was never played.
	const loudRuns = mergeGaps(findRuns(energy, n, hiEnter, hiLeave, MIN_LOUD_BARS), MIN_LOUD_BARS);
	const quietRuns = findRuns(energy, n, quietLevel, quietLevel * 1.25, MIN_QUIET_BARS, true);

	// A loud passage is a drop when something announced it: a rise over the bars before, or a
	// quiet passage to come out of. A loud passage entered flat from the top of the track is
	// the groove it has been playing all along.
	const dropBars: number[] = [];
	const grooveRuns: Run[] = [];
	for (const run of loudRuns) {
		const from = Math.max(0, run.start - 6);
		// The track starting is not a drop. A loud run entered straight from the opening
		// silence is the groove arriving; a drop needs something already playing to drop from.
		const playingBefore = from < run.start && mean(energy, from, run.start) > quietLevel;
		const floorBefore = from < run.start ? Math.min(...energy.slice(from, run.start)) : 1;
		const rose = playingBefore && energy[run.start] - floorBefore > 0.22;
		const afterQuiet = quietRuns.some(
			(q) => q.start > 0 && q.end > from && q.end <= run.start + 1
		);
		if (rose || afterQuiet) dropBars.push(run.start);
		else grooveRuns.push(run);
	}

	// A track has a peak whether or not anything announced it.
	if (dropBars.length === 0 && loudRuns.length > 0) {
		let best = loudRuns[0];
		for (const run of loudRuns) {
			if (mean(energy, run.start, run.end) > mean(energy, best.start, best.end)) best = run;
		}
		dropBars.push(best.start);
		const idx = grooveRuns.indexOf(best);
		if (idx >= 0) grooveRuns.splice(idx, 1);
	}
	dropBars.sort((a, b) => a - b);

	const loudEnd = new Map<number, number>();
	for (const run of loudRuns) loudEnd.set(run.start, run.end);
	for (const run of grooveRuns) for (let b = run.start; b < run.end; b++) kind[b] = 'groove';

	// Take the phrase anchor from the first drop rather than from boundary novelty. In this
	// genre the drop IS a phrase boundary, so anchoring to it makes the biggest structural
	// event on-grid by construction, instead of leaving every boundary one bar out and the
	// void to be mangled by the snapping that follows.
	const anchor = phraseOffset(dropBars.length > 0 ? dropBars[0] : phraseAnchorBar, 0);

	// --- drop extents ------------------------------------------------------------------
	for (const d of dropBars) {
		const end = Math.min(loudEnd.get(d) ?? d + MIN_LOUD_BARS, n);
		for (let b = d; b < end; b++) kind[b] = 'drop';
		events[d].push('drop_downbeat');
		if (air[d] > 0.6) events[d].push('crash');
	}

	// --- breakdowns --------------------------------------------------------------------
	// Before builds, deliberately: a breakdown bounds the build walk-back below. Two bars is
	// enough to count, because in a dense edit the collapse before a drop is often exactly
	// that short and it is the biggest structural event in the track.
	for (const run of quietRuns) {
		for (let b = run.start; b < run.end; b++) if (kind[b] === null) kind[b] = 'breakdown';
	}

	// --- builds and voids --------------------------------------------------------------
	// A build is bounded by EVIDENCE, not by "everything back to the previous label": real
	// builds run 4 to 8 bars, and walking back further turns every quiet passage before a
	// drop into a build until the track has no groove left.
	const MAX_BUILD = 8;
	for (const d of dropBars) {
		const airAhead = mean(air, Math.max(0, d - 16), d);
		let start = d;
		while (start > 0 && d - start < MAX_BUILD && kind[start - 1] === null) {
			const b = start - 1;
			// Either the bottom end is withdrawn relative to the drop, or the top end is
			// climbing. A bar that is neither is a groove, and the build has not begun.
			const withdrawn = sub[b] < sub[d] * 0.8;
			const climbing = air[b] > airAhead * 1.05;
			if (!withdrawn && !climbing) break;
			start--;
		}
		if (d - start < 2) continue;

		for (let b = start; b < d; b++) {
			kind[b] = 'build';
			if (air[b] > mean(air, start, d) * 0.9) events[b].push('riser');
			if (bars.snares[b] > bars.snares[Math.max(0, start - 1)] * 2) events[b].push('snare_roll');
		}

		// The void: trailing bars whose quietest 100 ms window collapses.
		const localMedian = median(bars.minRms, Math.max(0, start - 8), d);
		let voidStart = d;
		while (
			voidStart > start + 1 &&
			bars.minRms[voidStart - 1] < localMedian * 0.25 &&
			d - voidStart < 2
		) {
			voidStart--;
		}
		if (voidStart < d) {
			for (let b = voidStart; b < d; b++) {
				kind[b] = 'void';
				events[b].push('silence');
			}
		}
	}

	// --- intro, outro, groove ----------------------------------------------------------
	let firstLoud = 0;
	while (firstLoud < n && energy[firstLoud] < 0.3) firstLoud++;
	for (let b = 0; b < Math.min(firstLoud, n); b++) if (kind[b] !== 'void') kind[b] = 'intro';

	let lastLoud = n - 1;
	while (lastLoud > 0 && energy[lastLoud] < 0.3) lastLoud--;
	for (let b = lastLoud + 1; b < n; b++) kind[b] = 'outro';

	for (let b = 0; b < n; b++) if (kind[b] === null) kind[b] = 'groove';

	// --- kick and bass entries ---------------------------------------------------------
	for (let b = 1; b < n; b++) {
		if (bars.kicks[b] > 0 && bars.kicks[b - 1] === 0) events[b].push('kick_in');
		if (bars.kicks[b] === 0 && bars.kicks[b - 1] > 0) events[b].push('kick_out');
		if (sub[b] > 0.45 && sub[b - 1] < 0.2) events[b].push('bass_in');
		if (sub[b] < 0.2 && sub[b - 1] > 0.45) events[b].push('bass_out');
	}

	// --- absorb fragments, then emit runs ----------------------------------------------
	// A one-bar section that is not a void is a detector artefact, not an arrangement.
	for (let b = 0; b < n; b++) {
		if (kind[b] === 'void') continue;
		let end = b;
		while (end < n && kind[end] === kind[b]) end++;
		if (end - b < 2 && b > 0) {
			for (let k = b; k < end; k++) kind[k] = kind[b - 1];
		}
		b = end - 1;
	}

	const segments: Segment[] = [];
	for (let b = 0; b < n; ) {
		let end = b;
		while (end < n && kind[end] === kind[b]) end++;
		segments.push({ startBar: b, endBar: end, kind: kind[b]! });
		b = end;
	}

	snapToPhrases(segments, n, anchor);
	enforceInvariants(segments, n, anchor);
	// Bar labels have to agree with the snapped spans, or the bar table and the section table
	// disagree about which section a bar belongs to.
	for (const s of segments) for (let b = s.startBar; b < s.endBar; b++) kind[b] = s.kind;
	for (const s of segments) {
		if (s.kind !== 'drop') continue;
		if (!events[s.startBar].includes('drop_downbeat')) events[s.startBar].push('drop_downbeat');
	}

	return {
		segments,
		phraseAnchorBar: anchor,
		dropBars: segments.filter((s) => s.kind === 'drop').map((s) => s.startBar),
		events,
		energy,
		bands: bandsOut
	};
}

/** A drop is the point of the track and a void is the strongest move in it. Never delete either. */
const PROTECTED: ReadonlySet<SectionKind> = new Set<SectionKind>(['drop', 'void']);
const MAX_VOID_BARS = 2;

/**
 * Guarantee what everything downstream assumes: every section change lands on the 4-bar
 * phrase grid, nothing non-void is shorter than two bars, and a void is at most two bars.
 *
 * Snapping alone cannot promise this, because it declines any move that would collapse a
 * neighbour. The remedy here is to MOVE the boundary and let a neighbour shrink, absorbing
 * a section only when it has nowhere left to go. Absorbing the offending section instead
 * would be much simpler and is wrong: it deleted the drop.
 */
function enforceInvariants(segments: Segment[], barCount: number, anchor: number): void {
	const len = (s: Segment) => s.endBar - s.startBar;

	// A void that runs longer than two bars is not a held breath, it is a quiet passage.
	for (const s of segments) {
		if (s.kind === 'void' && len(s) > MAX_VOID_BARS) s.kind = 'breakdown';
	}

	for (let pass = 0; pass < 64; pass++) {
		let changed = false;

		for (let i = 0; i < segments.length; i++) {
			const seg = segments[i];
			const prev = segments[i - 1];
			const next = segments[i + 1];

			// Boundary alignment. Segment 0 starts at bar 0 by definition; that is the track
			// beginning, not a section change, so the grid does not apply to it. A void is
			// phrase-terminal, so its start follows its drop rather than the grid.
			if (i > 0 && seg.kind !== 'void' && !onPhraseGrid(seg.startBar, anchor)) {
				const target = nearestPhraseBar(seg.startBar, anchor);
				if (target > prev.startBar && target < seg.endBar) {
					prev.endBar = target;
					seg.startBar = target;
					changed = true;
					break;
				}
				// No room to move: drop the weaker neighbour rather than this section.
				if (!PROTECTED.has(prev.kind) || PROTECTED.has(seg.kind)) {
					seg.startBar = prev.startBar;
					segments.splice(i - 1, 1);
				} else {
					prev.endBar = seg.endBar;
					segments.splice(i, 1);
				}
				changed = true;
				break;
			}

			if (len(seg) >= 2 || (seg.kind === 'void' && len(seg) >= 1)) continue;

			// Too short. A protected section grows at the expense of what follows; anything else
			// is absorbed by whichever neighbour is better evidenced, which is the longer one.
			if (PROTECTED.has(seg.kind) && next && len(next) > 2) {
				seg.endBar += 2 - len(seg);
				next.startBar = seg.endBar;
				changed = true;
				break;
			}

			if (segments.length === 1) break;
			if (next && (!prev || len(next) >= len(prev))) {
				next.startBar = seg.startBar;
			} else if (prev) {
				prev.endBar = seg.endBar;
			} else {
				break;
			}
			segments.splice(i, 1);
			changed = true;
			break;
		}

		if (!changed) break;
	}

	if (segments.length > 0) {
		segments[0].startBar = 0;
		const last = segments[segments.length - 1];
		// Extending a void to the end of the track would turn the strongest move in the
		// vocabulary into a 20-bar blackout.
		if (last.kind === 'void' && barCount - last.startBar > MAX_VOID_BARS) last.kind = 'outro';
		last.endBar = barCount;
	}
}

/**
 * Pull section boundaries onto the 4-bar phrase grid.
 *
 * A boundary landing off-phrase is almost always the detector being a bar or two out rather
 * than the music genuinely doing something odd, and snapping is free accuracy. Voids are
 * exempt: a void is phrase-terminal, so its start is fixed by the drop that follows it, and
 * only that drop's start gets snapped.
 */
function snapToPhrases(segments: Segment[], barCount: number, anchor: number): void {
	for (let i = 1; i < segments.length; i++) {
		const seg = segments[i];
		if (seg.kind === 'void') continue;

		const prev = segments[i - 1];
		const target = nearestPhraseBar(seg.startBar, anchor);
		if (target === seg.startBar || Math.abs(target - seg.startBar) > 2) continue;
		// Never collapse a neighbour to nothing; a shifted boundary is worth less than a
		// section disappearing.
		if (target <= prev.startBar || target >= seg.endBar) continue;

		if (prev.kind === 'void') {
			// Carry the void with the drop so the silence stays adjacent to the downbeat.
			const length = prev.endBar - prev.startBar;
			const newStart = target - length;
			if (newStart <= segments[i - 2]?.startBar) continue;
			prev.startBar = newStart;
			if (i >= 2) segments[i - 2].endBar = newStart;
		}

		prev.endBar = target;
		seg.startBar = target;
	}

	// Fold away anything the shifting emptied out.
	for (let i = segments.length - 1; i >= 0; i--) {
		if (segments[i].endBar > segments[i].startBar) continue;
		segments.splice(i, 1);
		if (i > 0 && i < segments.length) segments[i - 1].endBar = segments[i].startBar;
	}
	if (segments.length > 0) {
		segments[0].startBar = 0;
		segments[segments.length - 1].endBar = barCount;
	}
}

function sliceBand(bars: BarFeatures, band: number): Float32Array {
	const out = new Float32Array(bars.count);
	for (let b = 0; b < bars.count; b++) out[b] = bars.bandDb[b * NUM_BANDS + band];
	return out;
}

function percentile(a: Float32Array, q: number): number {
	if (a.length === 0) return 0;
	const sorted = Float32Array.from(a).sort();
	return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
}

function mean(a: Float32Array, from: number, to: number): number {
	const lo = Math.max(0, from);
	const hi = Math.min(a.length, to);
	if (hi <= lo) return 0;
	let acc = 0;
	for (let i = lo; i < hi; i++) acc += a[i];
	return acc / (hi - lo);
}

function median(a: Float32Array, from: number, to: number): number {
	const lo = Math.max(0, from);
	const hi = Math.min(a.length, to);
	if (hi <= lo) return 0;
	const slice = Float32Array.from(a.subarray(lo, hi)).sort();
	return slice[slice.length >> 1];
}
