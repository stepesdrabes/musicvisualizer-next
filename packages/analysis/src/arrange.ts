import {
	BAND_EDGES_HZ,
	BARS_PER_PHRASE,
	NUM_BANDS,
	PHRASE_BARS,
	nearestPhraseBar,
	onPhraseGrid,
	type EventTag,
	type SectionKind
} from '@mv/core';
import type { BarFeatures } from './structure.ts';
import type { SegmentGroup } from './structure.ts';
import type { Spectrogram } from './dsp/spectrogram.ts';
import { clamp01, mean, median, normalise, quantile } from './dsp/stats.ts';

export interface Segment {
	startBar: number;
	endBar: number;
	kind: SectionKind;
	/**
	 * Which material this is. Segments sharing an id are the same passage of the song.
	 *
	 * Kept separate from `kind` on purpose. `kind` is a lighting instruction drawn from a
	 * seven-value vocabulary, so a verse and a chorus routinely share one; identity is what
	 * says they are different sections, and merging on `kind` alone is what used to fuse
	 * fifteen segments into a single 116-bar groove.
	 */
	group: number;
}

export interface Arrangement {
	segments: Segment[];
	/** count per bar, 0..1. */
	energy: Float32Array;
	/** count * NUM_BANDS per bar, 0..1. */
	bands: Float32Array;
	events: EventTag[][];
	phraseAnchorBar: number;
}

/**
 * Mean band energies over the contract's four bands, in dB, for a run of time spans.
 *
 * Takes a time array rather than the bar table because the same arithmetic serves both
 * granularities: sections are read per bar and the light moves per beat.
 */
export function bandLevels(spec: Spectrogram, time: Float64Array, count: number): Float32Array {
	const out = new Float32Array(count * NUM_BANDS);
	const edges: [number, number][] = [];
	for (let k = 0; k < NUM_BANDS; k++) {
		let lo = 0;
		let hi = spec.bands;
		while (lo < spec.bands && spec.centreHz[lo] < BAND_EDGES_HZ[k]) lo++;
		while (hi > lo && spec.centreHz[hi - 1] > BAND_EDGES_HZ[k + 1]) hi--;
		edges.push([lo, Math.max(hi, lo + 1)]);
	}

	for (let b = 0; b < count; b++) {
		const f0 = Math.max(0, Math.round(time[b] * spec.fps));
		const f1 = Math.max(f0 + 1, Math.min(spec.frames, Math.round(time[b + 1] * spec.fps)));
		for (let k = 0; k < NUM_BANDS; k++) {
			const [lo, hi] = edges[k];
			let acc = 0;
			for (let f = f0; f < f1; f++) {
				for (let j = lo; j < hi; j++) acc += spec.mag[f * spec.bands + j];
			}
			const linear = acc / ((f1 - f0) * (hi - lo));
			out[b * NUM_BANDS + k] = 20 * Math.log10(Math.max(linear, 1e-7));
		}
	}
	return out;
}

/**
 * How much is going on in each bar, 0..1 across the track.
 *
 * Weighted toward the bottom end rather than toward broadband level: a noise riser is loud
 * but is not the peak of the track, and a level-only reading lets it outrank the drop it is
 * announcing.
 */
function barEnergy(bandsN: Float32Array, count: number, loudN: Float32Array): Float32Array {
	const energy = new Float32Array(count);
	for (let b = 0; b < count; b++) {
		energy[b] = clamp01(
			0.34 * loudN[b] +
				0.28 * bandsN[b * NUM_BANDS] +
				0.2 * bandsN[b * NUM_BANDS + 1] +
				0.18 * bandsN[b * NUM_BANDS + 2]
		);
	}
	return energy;
}

/** Short-term loudness resampled onto a time grid, then normalised across the track. */
function loudnessOn(
	shortTerm: Float32Array,
	fps: number,
	time: Float64Array,
	count: number
): Float32Array {
	const out = new Float32Array(count);
	for (let b = 0; b < count; b++) {
		const f0 = Math.max(0, Math.round(time[b] * fps));
		const f1 = Math.max(f0 + 1, Math.min(shortTerm.length, Math.round(time[b + 1] * fps)));
		let acc = 0;
		let n = 0;
		for (let f = f0; f < f1; f++) {
			if (Number.isFinite(shortTerm[f])) {
				acc += shortTerm[f];
				n++;
			}
		}
		out[b] = n > 0 ? acc / n : -70;
	}
	return normalise(out, 0.02, 0.98);
}

/**
 * A drop is a sustained lift that something announced. Below this step across a boundary the
 * track is simply going along, and calling its loudest passage a drop would be an invention.
 */
const DROP_STEP = 0.22;
/**
 * And how far below the body of the track a passage has to sit to be a breakdown.
 *
 * A quantile cannot answer this. Calling the bottom 30% of segments a breakdown gave 98% of a
 * 374-track corpus one however flat it was, which is the same mistake `DROP_STEP` exists to
 * stop at the other end: a label that every track has says nothing about any of them.
 */
const BREAKDOWN_STEP = 0.2;
/**
 * How far below the track's median bar the held breath before a drop has to fall.
 *
 * The quietest beat in the bar is what finds it, but that alone promotes a bar with one gap in
 * an otherwise full arrangement, so the bar's own level has to have gone with it.
 */
const VOID_RATIO = 0.35;
const MAX_BUILD_BARS = 16;
/** The longest a merge may make a section. Four phrases. */
const MAX_MERGED_BARS = 32;
const MAX_VOID_BARS = 2;
/**
 * How far below the track's own median bar a bar has to sit to count as nothing playing.
 * Thirty dB down, which no arrangement choice reaches and only an actual gap does.
 */
const SILENT_RATIO = 0.03;

/**
 * Band levels and overall energy on a time grid, both 0..1 across the track.
 *
 * Each band is normalised against its own distribution, so "sub is high" means high for this
 * track's sub rather than high compared with its mids.
 */
export function levelEnvelopes(
	bandsDb: Float32Array,
	shortTerm: Float32Array,
	shortTermFps: number,
	time: Float64Array,
	count: number
): { energy: Float32Array; bands: Float32Array } {
	const bands = new Float32Array(count * NUM_BANDS);
	for (let k = 0; k < NUM_BANDS; k++) {
		const slice = new Float32Array(count);
		for (let b = 0; b < count; b++) slice[b] = bandsDb[b * NUM_BANDS + k];
		const n = normalise(slice, 0.02, 0.98);
		for (let b = 0; b < count; b++) bands[b * NUM_BANDS + k] = n[b];
	}
	return { energy: barEnergy(bands, count, loudnessOn(shortTerm, shortTermFps, time, count)), bands };
}

export function arrange(
	bandsDb: Float32Array,
	bars: BarFeatures,
	bounds: readonly number[],
	groups: SegmentGroup,
	shortTerm: Float32Array,
	shortTermFps: number,
	kicksPerBar: Int32Array,
	snaresPerBar: Int32Array
): Arrangement {
	const count = bars.count;

	const { energy, bands: bandsN } = levelEnvelopes(
		bandsDb,
		shortTerm,
		shortTermFps,
		bars.time,
		count
	);
	const events: EventTag[][] = Array.from({ length: count }, () => []);

	const segments: Segment[] = [];
	for (let i = 0; i + 1 < bounds.length; i++) {
		segments.push({
			startBar: bounds[i],
			endBar: bounds[i + 1],
			kind: 'groove',
			group: groups.group[i] ?? i
		});
	}
	if (segments.length === 0) {
		return { segments, energy, bands: bandsN, events, phraseAnchorBar: 0 };
	}

	const segEnergy = segments.map((s) => mean(energy, s.startBar, s.endBar));

	// --- what kind of track is this ------------------------------------------------------
	// Rekordbox picks a label vocabulary per track before labelling anything, and the reason
	// is sound: a ballad has no drop, and a track with a drop has no verse. Deciding first
	// stops the loudest eight bars of a folk song being announced as the drop of the night.
	let biggestStep = 0;
	for (let i = 1; i < segments.length; i++) {
		biggestStep = Math.max(biggestStep, segEnergy[i] - segEnergy[i - 1]);
	}
	const hasDrops = biggestStep >= DROP_STEP;

	const body = median(segEnergy);
	const loudLevel = Math.max(quantile(segEnergy, 0.7), Math.max(...segEnergy) * 0.82);

	for (let i = 0; i < segments.length; i++) {
		const e = segEnergy[i];
		if (e >= loudLevel) {
			// A loud passage is a drop only when something set it up, and only once the track has
			// had room to establish what it is dropping from. Nothing drops in its first two
			// phrases; a loud passage there is the groove arriving, which is a different thing
			// to light.
			const rose = i > 0 && e - segEnergy[i - 1] >= DROP_STEP;
			const settled = segments[i].startBar >= 2 * PHRASE_BARS;
			segments[i].kind = hasDrops && rose && settled ? 'drop' : 'groove';
		} else if (e <= body - BREAKDOWN_STEP) {
			segments[i].kind = 'breakdown';
		} else {
			segments[i].kind = 'groove';
		}
	}

	// A track with dynamics has a peak whether or not the step test caught it.
	if (hasDrops && !segments.some((s) => s.kind === 'drop')) {
		let best = 0;
		for (let i = 1; i < segments.length; i++) if (segEnergy[i] > segEnergy[best]) best = i;
		segments[best].kind = 'drop';
	}

	// --- nothing playing -------------------------------------------------------------------
	// Before anything else reads a neighbour, because an energy quantile has no absolute floor:
	// silence lands in the bottom bucket of every track and comes out labelled breakdown, or
	// outro when it is at the end, and either one gets lit. A void is the only instruction that
	// means "there is nothing here", and it is the only honest label for a gap.
	const silenceFloor = median(bars.rms) * SILENT_RATIO;
	for (const s of segments) {
		let silent = true;
		for (let b = s.startBar; b < s.endBar && silent; b++) silent = bars.rms[b] < silenceFloor;
		// Carved rather than played, so it belongs to no group and can never be a repeat target.
		if (silent) {
			s.kind = 'void';
			s.group = -1;
		}
	}

	// --- builds --------------------------------------------------------------------------
	// Bounded by the previous boundary rather than by walking back until the evidence runs
	// out: the segmentation already found where this passage began, and a build that starts
	// mid-section is a build the detector invented.
	for (let i = 1; i < segments.length; i++) {
		if (segments[i].kind !== 'drop') continue;
		// Past a void, because a gap between the build and the drop is the oldest arrangement
		// there is and the build is the passage before it, not the silence.
		let p = i - 1;
		while (p > 0 && segments[p].kind === 'void') p--;
		const prev = segments[p];
		if (prev.kind === 'drop' || prev.kind === 'void') continue;
		if (prev.endBar - prev.startBar > MAX_BUILD_BARS) continue;

		const drop = segments[i];
		const airBefore = meanBand(bandsN, prev.startBar, prev.endBar, 3);
		const airEarlier = meanBand(bandsN, Math.max(0, prev.startBar - 8), prev.startBar, 3);
		const subBefore = meanBand(bandsN, prev.startBar, prev.endBar, 0);
		const subDrop = meanBand(bandsN, drop.startBar, drop.endBar, 0);

		const climbing = airBefore > airEarlier * 1.08;
		const withdrawn = subBefore < subDrop * 0.8;
		if (climbing || withdrawn) prev.kind = 'build';
	}

	// --- intro and outro -----------------------------------------------------------------
	const midEnergy = median(segEnergy);
	if (segments[0].kind !== 'void' && segEnergy[0] < midEnergy) segments[0].kind = 'intro';
	const last = segments.length - 1;
	if (last > 0 && segments[last].kind !== 'void' && segEnergy[last] < midEnergy) {
		segments[last].kind = 'outro';
	}

	// --- phrase grid ---------------------------------------------------------------------
	const anchor = fitAnchor(segments.map((s) => s.startBar), count);
	snapToPhrases(segments, count, anchor);

	// --- the void ------------------------------------------------------------------------
	// Carved out of the bar before a drop rather than detected on its own, because that is
	// the only place it means anything: a held breath somewhere else is just a quiet bar.
	const floorMedian = median(bars.floor);
	const voidCeiling = median(bars.rms) * VOID_RATIO;
	for (let i = 1; i < segments.length; i++) {
		if (segments[i].kind !== 'drop') continue;
		const prev = segments[i - 1];
		if (prev.kind === 'void' || prev.endBar - prev.startBar < 3) continue;
		let voidBars = 0;
		while (
			voidBars < MAX_VOID_BARS &&
			prev.endBar - voidBars - 1 > prev.startBar &&
			bars.floor[prev.endBar - voidBars - 1] < floorMedian * 0.3 &&
			bars.rms[prev.endBar - voidBars - 1] < voidCeiling
		) {
			voidBars++;
		}
		if (voidBars === 0) continue;
		const start = prev.endBar - voidBars;
		prev.endBar = start;
		// A void is carved out rather than detected, so it belongs to no group and can only
		// ever merge with another void.
		segments.splice(i, 0, { startBar: start, endBar: start + voidBars, kind: 'void', group: -1 });
		i++;
	}

	// --- events --------------------------------------------------------------------------
	const air = (b: number) => bandsN[b * NUM_BANDS + 3];
	const sub = (b: number) => bandsN[b * NUM_BANDS];

	for (const s of segments) {
		if (s.kind === 'drop') {
			events[s.startBar].push('drop_downbeat');
			if (air(s.startBar) > 0.62) events[s.startBar].push('crash');
		}
		if (s.kind === 'void') {
			for (let b = s.startBar; b < s.endBar; b++) events[b].push('silence');
		}
		if (s.kind === 'build') {
			const base = meanBand(bandsN, Math.max(0, s.startBar - 8), s.startBar, 3);
			for (let b = s.startBar; b < s.endBar; b++) {
				if (air(b) > base * 1.05) events[b].push('riser');
				if (b > 0 && snaresPerBar[b] > Math.max(2, snaresPerBar[b - 1] * 2)) {
					events[b].push('snare_roll');
				}
			}
		}
	}

	for (let b = 1; b < count; b++) {
		// A crash is a cymbal, not a section marker. Tagging it only on a drop downbeat meant the
		// tag described the arrangement the labeller had already decided on rather than anything
		// heard, so the one event that says "the track just did something" fired nowhere else.
		if (air(b) > 0.62 && air(b) - air(b - 1) > 0.25 && !events[b].includes('crash')) {
			events[b].push('crash');
		}
		if (kicksPerBar[b] > 0 && kicksPerBar[b - 1] === 0) events[b].push('kick_in');
		if (kicksPerBar[b] === 0 && kicksPerBar[b - 1] > 0) events[b].push('kick_out');
		if (sub(b) > 0.45 && sub(b - 1) < 0.2) events[b].push('bass_in');
		if (sub(b) < 0.2 && sub(b - 1) > 0.45) events[b].push('bass_out');

		// A sweep is brightness climbing for several bars while the bottom stays put, which is
		// what a filter opening sounds like and what a crescendo does not.
		if (b >= 4) {
			let rising = true;
			for (let k = b - 3; k <= b; k++) if (air(k) <= air(k - 1)) rising = false;
			if (rising && air(b) - air(b - 4) > 0.25 && Math.abs(sub(b) - sub(b - 4)) < 0.15) {
				events[b].push('filter_sweep');
			}
		}
	}

	return { segments, energy, bands: bandsN, events, phraseAnchorBar: anchor };
}

function meanBand(bandsN: Float32Array, from: number, to: number, band: number): number {
	const lo = Math.max(0, from);
	const hi = Math.min(bandsN.length / NUM_BANDS, to);
	if (hi <= lo) return 0;
	let acc = 0;
	for (let b = lo; b < hi; b++) acc += bandsN[b * NUM_BANDS + band];
	return acc / (hi - lo);
}

/**
 * The phrase offset that the most section changes already agree with.
 *
 * Searched over a whole phrase but scored on the 4-bar grid first, so the answer is still the
 * best available anchor for the grid the linter holds cues to, and the mod-8 phase is decided
 * by evidence rather than left to whichever half the search happened to reach first. Without
 * the second term only 47% of section starts fired `phraseStart`, against 97% sitting on the
 * 4-bar grid the anchor was fitted to.
 */
function fitAnchor(starts: readonly number[], barCount: number): number {
	const inside = starts.filter((b) => b > 0 && b < barCount);
	let best = 0;
	let bestScore = -1;
	for (let anchor = 0; anchor < BARS_PER_PHRASE; anchor++) {
		let quarter = 0;
		let whole = 0;
		for (const b of inside) {
			if (!onPhraseGrid(b, anchor)) continue;
			quarter++;
			if ((((b - anchor) % BARS_PER_PHRASE) + BARS_PER_PHRASE) % BARS_PER_PHRASE === 0) whole++;
		}
		const score = quarter * (inside.length + 1) + whole;
		if (score > bestScore) {
			bestScore = score;
			best = anchor;
		}
	}
	return best;
}

/**
 * How far a boundary may be dragged to reach the phrase grid.
 *
 * Snapping unconditionally was costing more than it bought. With a four-bar grid the worst
 * move is two bars, which is four seconds at 120 bpm: outside the half-second window the
 * boundary metric calls a hit, and outside the three-second one as well. A boundary that is
 * one bar off the grid is a rounding error worth correcting; one that is two bars off is
 * evidence the grid is wrong there, and moving it destroys a boundary that was right.
 */
const MAX_SNAP_BARS = 1;

/**
 * Pull section changes that are nearly on the phrase grid onto it, and guarantee nothing is
 * shorter than two bars, because the linter rejects an off-phrase cue outright and the
 * sections are what the cues are written against.
 */
function snapToPhrases(segments: Segment[], barCount: number, anchor: number): void {
	for (let i = 1; i < segments.length; i++) {
		// A void's edges are where the sound stopped and started, which is a measurement rather
		// than a rounding: moving one by a bar either lights a silent bar or blacks out a played
		// one, and both are visible in the room.
		if (segments[i].kind === 'void' || segments[i - 1].kind === 'void') continue;
		const from = segments[i].startBar;
		const target = Math.max(1, Math.min(barCount - 1, nearestPhraseBar(from, anchor)));
		if (Math.abs(target - from) > MAX_SNAP_BARS) continue;
		segments[i].startBar = target;
		segments[i - 1].endBar = target;
	}
	segments[0].startBar = 0;
	segments[segments.length - 1].endBar = barCount;

	// Anything the snapping emptied out, or that never had two bars to begin with, is folded
	// into whichever neighbour is better evidenced, which is the longer one.
	for (let i = segments.length - 1; i >= 0; i--) {
		const len = segments[i].endBar - segments[i].startBar;
		// One bar of nothing is a legitimate void; one bar of anything else is a rounding artefact.
		if (len >= 2 || segments[i].kind === 'void' || segments.length === 1) continue;
		const prev = segments[i - 1];
		const next = segments[i + 1];
		if (next && (!prev || next.endBar - next.startBar >= prev.endBar - prev.startBar)) {
			next.startBar = segments[i].startBar;
		} else if (prev) {
			prev.endBar = segments[i].endBar;
		} else {
			continue;
		}
		segments.splice(i, 1);
	}

	// Neighbours that are the same material AND carry the same instruction say nothing twice;
	// merge only those. Merging on `kind` alone deleted 47% of the boundaries the segmenter
	// found, because a four-value energy vocabulary makes most neighbours look alike.
	for (let i = segments.length - 1; i > 0; i--) {
		if (segments[i].kind !== segments[i - 1].kind) continue;
		if (segments[i].group !== segments[i - 1].group) continue;
		// And never past this, however alike two neighbours are. A passage that runs longer
		// than four phrases is an arrangement rather than a section, and handing the show one
		// cue for it means the room does not move for ninety seconds. The engine re-subdivides
		// at sixteen bars anyway, so a longer span only removes the analyser's say in where.
		if (segments[i].endBar - segments[i - 1].startBar > MAX_MERGED_BARS) continue;
		segments[i - 1].endBar = segments[i].endBar;
		segments.splice(i, 1);
	}

	segments[0].startBar = 0;
	segments[segments.length - 1].endBar = barCount;
}
