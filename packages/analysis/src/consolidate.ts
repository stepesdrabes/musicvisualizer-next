import { PHRASE_BARS } from '@mv/core';
import type { Segment } from './arrange.ts';

/**
 * How near the seam the material comparison looks, in bars. The DP's own banded window:
 * a seam through homogeneous material scores high across exactly these pairs.
 */
const SEAM_BAND = 7;
/**
 * The same-material standard, shared with `groupSegments`: two passages are the same
 * stuff when they resemble each other nearly as much as each resembles itself, with an
 * absolute floor so an internally loose track cannot merge on nine tenths of nothing.
 */
const SAME_MATERIAL = 0.92;
const SAME_MATERIAL_FLOOR = 0.62;

/**
 * Merge adjacent same-kind sections whose seam is a segmentation artefact rather than
 * structure.
 *
 * The DP cannot emit a segment longer than `MAX_SEGMENT_BARS`, so a homogeneous passage
 * is force-split however strong its cohesion, and the merge inside `snapToPhrases` only
 * reunites halves that matched into one repeat group under a four-phrase cap. What is
 * left over reaches the room as structure: every surviving seam is a section transition,
 * and every drop-class section start is a punctuated arrival - measured over one judged
 * round, 28% of all section boundaries separated two sections of the same kind, and the
 * badly-rated tracks carried three times the share of the well-rated ones.
 *
 * A seam is an artefact only when BOTH halves of that claim measure true:
 *
 * - nothing arrives ON OR BESIDE it - the strongest arrival within a bar either way is
 *   under `floor`. The window is load-bearing: the judged boundary errors sit one bar
 *   early of their true arrival, so testing the seam bar alone would delete exactly the
 *   seams the boundary work needs to MOVE, converting a fixable "starts too early" into
 *   an unfixable "missed entirely";
 * - the material reads as the same stuff across it, by the standard `groupSegments`
 *   uses for repeats, applied locally: the banded similarity ACROSS the seam comes
 *   within `SAME_MATERIAL` of the two sides' own internal cohesion. This is what keeps
 *   the song corpora honest - annotators mark real section changes at soft seams, and
 *   an arrival-only merge paid two points of Harmonix boundary F for them.
 *
 * And four seams never merge however weak they measure:
 *
 * - a seam in `keep` - the caller passes the pipeline's pinned arrivals and the bars
 *   the hook snap just placed, and this pass must not undo either;
 * - a seam touching the loudest segment (by mean energy): the peak cue, its reserved
 *   master and the intensity ceiling all hang off that segment's startBar and rank,
 *   and a merge relocates or dilutes the biggest moment of the night;
 * - a seam that is not a whole number of phrases from the merged start: interior cues
 *   subdivide on the section's own phrase grid, so absorbing an odd-length run puts
 *   every cue in the absorbed half off ITS material's grid - the exact "split unevenly"
 *   complaint this pass exists to fix;
 * - a void edge.
 *
 * There is deliberately no length cap. The engine subdivides every section at
 * `MAX_CUE_BARS` on the section's own phrase grid, so a long section still moves the
 * room; what a phantom seam adds is a false arrival at a DP-chosen bar.
 *
 * Runs on the FINAL table, after the vocabulary and the hook snap, so the caller must
 * re-place events afterwards - and must hand the trust gate the PRE-merge section count,
 * or a fragmented wreck merges its way past the lounge routing that exists to catch it.
 * Mutates in place; returns the seam bars it removed.
 */
export function consolidateSections(
	segments: Segment[],
	arrivals: Float32Array,
	sim: Float32Array,
	barCount: number,
	floor: number,
	energy: Float32Array,
	keep: ReadonlySet<number> = new Set()
): number[] {
	const merged: number[] = [];
	if (floor <= 0 || segments.length < 2) return merged;

	// The loudest segment of the INPUT table: untouchable, because the peak is chosen by
	// mean energy and opened at startBar, and both must survive this pass unchanged.
	let peak = 0;
	let peakMean = -Infinity;
	for (let i = 0; i < segments.length; i++) {
		const s = segments[i];
		let acc = 0;
		for (let b = s.startBar; b < Math.min(s.endBar, energy.length); b++) acc += energy[b];
		const mean = acc / Math.max(1, Math.min(s.endBar, energy.length) - s.startBar);
		if (mean > peakMean) {
			peakMean = mean;
			peak = i;
		}
	}
	const peakSeg = segments[peak];

	// Group identity of a merged run is the PLURALITY of its constituent bars, not the
	// winner of the last pairwise step: A(8)+B(12)+C(16) is C's span, whatever order the
	// walk met them in.
	const tally = new Map<number, number>();

	for (let i = 1; i < segments.length; ) {
		const prev = segments[i - 1];
		const here = segments[i];
		const seam = here.startBar;
		const arrivalNear = Math.max(
			arrivals[seam - 1] ?? 0,
			arrivals[seam] ?? 0,
			arrivals[seam + 1] ?? 0
		);
		const mergeable =
			prev.kind === here.kind &&
			prev.kind !== 'void' &&
			prev !== peakSeg &&
			here !== peakSeg &&
			!keep.has(seam) &&
			(seam - prev.startBar) % PHRASE_BARS === 0 &&
			arrivalNear < floor &&
			sameMaterialAcross(sim, barCount, prev.startBar, seam, here.endBar);
		if (!mergeable) {
			tally.clear();
			i++;
			continue;
		}
		if (tally.size === 0 && prev.group >= 0) {
			tally.set(prev.group, prev.endBar - prev.startBar);
		}
		if (here.group >= 0) {
			tally.set(here.group, (tally.get(here.group) ?? 0) + here.endBar - here.startBar);
		}
		let bestGroup = prev.group;
		let bestBars = -1;
		for (const [group, bars] of tally) {
			if (bars > bestBars) {
				bestBars = bars;
				bestGroup = group;
			}
		}
		prev.group = bestGroup;
		prev.endBar = here.endBar;
		segments.splice(i, 1);
		merged.push(seam);
	}
	return merged;
}

/** Banded mean similarity over pairs inside [from, to), the DP's own cohesion reading. */
function bandedCohesion(sim: Float32Array, n: number, from: number, to: number): number {
	let acc = 0;
	let pairs = 0;
	for (let i = from; i < to; i++) {
		const hi = Math.min(to, i + SEAM_BAND + 1);
		for (let j = i + 1; j < hi; j++) {
			acc += sim[i * n + j];
			pairs++;
		}
	}
	// No internal pairs means a one-bar side, whose only reading is the diagonal's 1.
	return pairs > 0 ? acc / pairs : 1;
}

/**
 * Whether the bars either side of `seam` read as the same material: the banded
 * similarity across the seam, against the two sides' own internal cohesion nearby.
 */
function sameMaterialAcross(
	sim: Float32Array,
	n: number,
	prevStart: number,
	seam: number,
	nextEnd: number
): boolean {
	const from = Math.max(prevStart, seam - SEAM_BAND);
	const to = Math.min(nextEnd, seam + SEAM_BAND, n);
	if (seam <= from || to <= seam) return false;
	let acc = 0;
	let pairs = 0;
	for (let i = from; i < seam; i++) {
		const hi = Math.min(to, i + SEAM_BAND + 1);
		for (let j = seam; j < hi; j++) {
			acc += sim[i * n + j];
			pairs++;
		}
	}
	if (pairs === 0) return false;
	const cross = acc / pairs;
	const self = (bandedCohesion(sim, n, from, seam) + bandedCohesion(sim, n, seam, to)) / 2;
	return cross >= Math.max(SAME_MATERIAL_FLOOR, self * SAME_MATERIAL);
}
