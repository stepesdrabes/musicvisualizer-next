import { BAND_EDGES_HZ, NUM_BANDS, PHRASE_BARS, type EventTag, type SectionKind } from '@mv/core';
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

/** Mean band energies per bar, in dB, over the contract's four bands. */
export function barBands(spec: Spectrogram, bars: BarFeatures): Float32Array {
	const out = new Float32Array(bars.count * NUM_BANDS);
	const edges: [number, number][] = [];
	for (let k = 0; k < NUM_BANDS; k++) {
		let lo = 0;
		let hi = spec.bands;
		while (lo < spec.bands && spec.centreHz[lo] < BAND_EDGES_HZ[k]) lo++;
		while (hi > lo && spec.centreHz[hi - 1] > BAND_EDGES_HZ[k + 1]) hi--;
		edges.push([lo, Math.max(hi, lo + 1)]);
	}

	for (let b = 0; b < bars.count; b++) {
		const f0 = Math.max(0, Math.round(bars.time[b] * spec.fps));
		const f1 = Math.max(f0 + 1, Math.min(spec.frames, Math.round(bars.time[b + 1] * spec.fps)));
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

/** Short-term loudness resampled onto bars, then normalised across the track. */
function barLoudness(
	shortTerm: Float32Array,
	fps: number,
	bars: BarFeatures
): Float32Array {
	const out = new Float32Array(bars.count);
	for (let b = 0; b < bars.count; b++) {
		const f0 = Math.max(0, Math.round(bars.time[b] * fps));
		const f1 = Math.max(f0 + 1, Math.min(shortTerm.length, Math.round(bars.time[b + 1] * fps)));
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
const MAX_BUILD_BARS = 16;
/** The longest a merge may make a section. Four phrases. */
const MAX_MERGED_BARS = 32;
const MAX_VOID_BARS = 2;

export function arrange(
	spec: Spectrogram,
	bars: BarFeatures,
	bounds: readonly number[],
	groups: SegmentGroup,
	shortTerm: Float32Array,
	shortTermFps: number,
	kicksPerBar: Int32Array,
	snaresPerBar: Int32Array
): Arrangement {
	const count = bars.count;
	const bandsDb = barBands(spec, bars);

	// Each band normalised against its own distribution, so "sub is high" means high for this
	// track's sub rather than high compared with its mids.
	const bandsN = new Float32Array(count * NUM_BANDS);
	for (let k = 0; k < NUM_BANDS; k++) {
		const slice = new Float32Array(count);
		for (let b = 0; b < count; b++) slice[b] = bandsDb[b * NUM_BANDS + k];
		const n = normalise(slice, 0.02, 0.98);
		for (let b = 0; b < count; b++) bandsN[b * NUM_BANDS + k] = n[b];
	}

	const loudN = barLoudness(shortTerm, shortTermFps, bars);
	const energy = barEnergy(bandsN, count, loudN);
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

	const quiet = quantile(segEnergy, 0.3);
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
		} else if (e <= quiet) {
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

	// --- builds --------------------------------------------------------------------------
	// Bounded by the previous boundary rather than by walking back until the evidence runs
	// out: the segmentation already found where this passage began, and a build that starts
	// mid-section is a build the detector invented.
	for (let i = 1; i < segments.length; i++) {
		if (segments[i].kind !== 'drop') continue;
		const prev = segments[i - 1];
		if (prev.kind === 'drop' || prev.endBar - prev.startBar > MAX_BUILD_BARS) continue;

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
	if (segEnergy[0] < midEnergy) segments[0].kind = 'intro';
	const last = segments.length - 1;
	if (last > 0 && segEnergy[last] < midEnergy) segments[last].kind = 'outro';

	// --- phrase grid ---------------------------------------------------------------------
	const anchor = fitAnchor(segments.map((s) => s.startBar), count);
	snapToPhrases(segments, count, anchor);

	// --- the void ------------------------------------------------------------------------
	// Carved out of the bar before a drop rather than detected on its own, because that is
	// the only place it means anything: a held breath somewhere else is just a quiet bar.
	const floorMedian = median(bars.floor);
	for (let i = 1; i < segments.length; i++) {
		if (segments[i].kind !== 'drop') continue;
		const prev = segments[i - 1];
		if (prev.endBar - prev.startBar < 3) continue;
		let voidBars = 0;
		while (
			voidBars < MAX_VOID_BARS &&
			prev.endBar - voidBars - 1 > prev.startBar &&
			bars.floor[prev.endBar - voidBars - 1] < floorMedian * 0.3
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

/** The phrase offset that the most section changes already agree with. */
function fitAnchor(starts: readonly number[], barCount: number): number {
	let best = 0;
	let bestHits = -1;
	for (let anchor = 0; anchor < PHRASE_BARS; anchor++) {
		let hits = 0;
		for (const b of starts) {
			if (b <= 0 || b >= barCount) continue;
			if ((((b - anchor) % PHRASE_BARS) + PHRASE_BARS) % PHRASE_BARS === 0) hits++;
		}
		if (hits > bestHits) {
			bestHits = hits;
			best = anchor;
		}
	}
	return best;
}

/**
 * Pull every section change onto the phrase grid and guarantee nothing is shorter than two
 * bars, because the linter rejects an off-phrase cue outright and the sections are what the
 * cues are written against.
 */
function snapToPhrases(segments: Segment[], barCount: number, anchor: number): void {
	const nearest = (bar: number) => {
		const off = (((bar - anchor) % PHRASE_BARS) + PHRASE_BARS) % PHRASE_BARS;
		const down = bar - off;
		const up = down + PHRASE_BARS;
		return bar - down <= up - bar ? down : up;
	};

	for (let i = 1; i < segments.length; i++) {
		const target = Math.max(1, Math.min(barCount - 1, nearest(segments[i].startBar)));
		segments[i].startBar = target;
		segments[i - 1].endBar = target;
	}
	segments[0].startBar = 0;
	segments[segments.length - 1].endBar = barCount;

	// Anything the snapping emptied out, or that never had two bars to begin with, is folded
	// into whichever neighbour is better evidenced, which is the longer one.
	for (let i = segments.length - 1; i >= 0; i--) {
		const len = segments[i].endBar - segments[i].startBar;
		if (len >= 2 || segments.length === 1) continue;
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
