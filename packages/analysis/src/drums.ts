import type { Spectrogram } from './dsp/spectrogram.ts';
import { separate } from './dsp/hpss.ts';
import { maxFilter, quantile, smooth } from './dsp/stats.ts';
import { pickPeaks, refinePeakTime, type Peak } from './onsets.ts';

/**
 * One drum's detections, with the evidence they were drawn from.
 *
 * `curve` is carried alongside the hits because the stage that corrects them against the
 * track's own repetition has to ask what the audio says at a moment the detector reported
 * nothing: a pattern may only complete a hit that is faintly there, never one that is absent.
 */
export interface DrumStream {
	times: number[];
	/** Peak height above the local floor, index-aligned with `times`. */
	levels: number[];
	/** Detection function minus its local floor, clamped at zero, at `fps`. */
	curve: Float32Array;
	fps: number;
}

export interface DrumOnsets {
	kick: DrumStream;
	snare: DrumStream;
	hat: DrumStream;
}

/**
 * Band edges, in Hz.
 *
 * `KICK` stops at 90 because a bass guitar's open E is 41 Hz but a synth bassline usually
 * sits an octave up, and 110 Hz inside the kick band is what makes every eighth note read as
 * a kick. `BASS_NOTE` is the band a kick has little in and a bass note has most of, so the
 * difference between the two separates them.
 *
 * `SNARE_BODY` is the drum's shell resonance and `SNARE_CRACK` its noise burst. A snare needs
 * both at once: that is what tells it from a distorted kick, whose high-frequency content is
 * clipping products locked to a 50 Hz fundamental rather than an independent 200 Hz mode, and
 * from a hi-hat, which has the crack and no body at all.
 */
const KICK = [20, 90] as const;
const BASS_NOTE = [110, 260] as const;
const SNARE_BODY = [150, 400] as const;
const SNARE_CRACK = [1500, 8000] as const;
const HAT = [6000, 20000] as const;

/** How much of the bass band's rise is charged against the kick band's, per band. */
const BASS_WEIGHT = 4;
/** Refractory gaps as a fraction of a sixteenth note. */
const KICK_GAP = 0.75;
const SNARE_GAP = 0.75;

function bandFlux(
	mag: Float32Array,
	frames: number,
	bands: number,
	centreHz: Float32Array,
	loHz: number,
	hiHz: number,
	lag: number
): Float32Array {
	let lo = 0;
	let hi = bands;
	while (lo < bands && centreHz[lo] < loHz) lo++;
	while (hi > lo && centreHz[hi - 1] > hiHz) hi--;
	if (hi <= lo) hi = Math.min(bands, lo + 1);

	const out = new Float32Array(frames);
	// Per band rather than summed, so two bands of different widths are in the same units and a
	// weight applied between them means one fixed thing.
	const width = hi - lo;
	for (let f = lag; f < frames; f++) {
		let acc = 0;
		for (let b = lo; b < hi; b++) {
			const cur = Math.log10(1 + mag[f * bands + b]);
			const prev = Math.log10(1 + mag[(f - lag) * bands + b]);
			if (cur > prev) acc += cur - prev;
		}
		out[f] = acc / width;
	}
	return out;
}

function normaliseCurve(curve: Float32Array, out = new Float32Array(curve.length)): Float32Array {
	const sorted = Float32Array.from(curve).sort();
	const top = sorted[Math.floor(sorted.length * 0.995)] || 1;
	for (let i = 0; i < curve.length; i++) out[i] = curve[i] / top;
	return out;
}

/** Drop candidates that land within `windowSec` of a stronger event in another stream. */
function suppressNear(candidates: Peak[], suppressors: Peak[], windowSec: number): Peak[] {
	if (suppressors.length === 0) return candidates;
	let j = 0;
	return candidates.filter((c) => {
		while (j < suppressors.length && suppressors[j].time < c.time - windowSec) j++;
		for (let k = j; k < suppressors.length && suppressors[k].time <= c.time + windowSec; k++) {
			if (Math.abs(suppressors[k].time - c.time) <= windowSec) return false;
		}
		return true;
	});
}

export interface DrumOptions {
	/** Sets the refractory gaps, so a 175 bpm track can resolve what a 90 bpm one cannot. */
	beatPeriod: number;
	/** The broadband onset curve the beat grid was fitted to, at `spec.fps`. */
	odf: Float32Array;
}

/**
 * Place a detected hit on the broadband onset it belongs to.
 *
 * Which frames are drums is decided by the band curves above; where they are is not. The beat
 * grid is fitted to `odf`, so any stream placed by a different curve carries its own systematic
 * offset against everything the grid drives. The kick's is the worst, for a reason no threshold
 * can reach: a 93 ms analysis window cannot localise a 50 Hz event, so the low-band flux is
 * still climbing most of a window after the drum was struck and its maximum lands 24 ms late on
 * the median track, against 0.8 ms for the broadband curve.
 *
 * Bounded at half a sixteenth so a hit can never be dragged onto a neighbouring slot, and
 * falling back to the band curve's own peak when there is no onset nearby at all.
 */
function placeOnOnset(
	curve: Float32Array,
	peaks: readonly Peak[],
	odf: Float32Array,
	fps: number,
	radiusSec: number
): number[] {
	const radius = Math.max(1, Math.round(radiusSec * fps));
	return peaks.map((p) => {
		let best = -1;
		let bestValue = 0;
		const from = Math.max(1, p.frame - radius);
		const to = Math.min(odf.length - 2, p.frame + radius);
		for (let i = from; i <= to; i++) {
			if (odf[i] >= odf[i - 1] && odf[i] >= odf[i + 1] && odf[i] > bestValue) {
				bestValue = odf[i];
				best = i;
			}
		}
		return best >= 0 ? refinePeakTime(odf, best, fps) : refinePeakTime(curve, p.frame, fps);
	});
}

/**
 * Move detection TIMES onto the broadband onset curve, for streams that arrive from a
 * model rather than from the band curves above. Same contract as `placeOnOnset`: bounded
 * at half a sixteenth so a hit cannot be dragged onto a neighbouring slot, falling back
 * to the original time when no onset lives nearby.
 */
export function snapTimesToOnsets(
	times: readonly number[],
	odf: Float32Array,
	fps: number,
	radiusSec: number
): number[] {
	const radius = Math.max(1, Math.round(radiusSec * fps));
	return times.map((t) => {
		const frame = Math.round(t * fps);
		let best = -1;
		let bestValue = 0;
		const from = Math.max(1, frame - radius);
		const to = Math.min(odf.length - 2, frame + radius);
		for (let i = from; i <= to; i++) {
			if (odf[i] >= odf[i - 1] && odf[i] >= odf[i + 1] && odf[i] > bestValue) {
				bestValue = odf[i];
				best = i;
			}
		}
		return best >= 0 ? refinePeakTime(odf, best, fps) : t;
	});
}

/**
 * Kick, snare and hat onsets from the percussive component.
 *
 * Separating first is what makes this work at all. A bassline and a kick share the bottom
 * two octaves, and no filter can tell them apart, because the difference is not where the
 * energy is but how it behaves over time: the separation is exactly that question, asked
 * once, for every cell.
 */
export function detectDrums(spec: Spectrogram, opts: DrumOptions): DrumOnsets {
	const { percussive } = separate(spec.mag, spec.frames, spec.bands);
	const lag = 2;

	const raw = (lo: number, hi: number) =>
		bandFlux(percussive, spec.frames, spec.bands, spec.centreHz, lo, hi, lag);
	const flux = (lo: number, hi: number) => normaliseCurve(raw(lo, hi));

	const bodyCurve = flux(SNARE_BODY[0], SNARE_BODY[1]);
	const crackCurve = flux(SNARE_CRACK[0], SNARE_CRACK[1]);
	const hatCurve = flux(HAT[0], HAT[1]);

	// A kick puts far more into 20-90 Hz than into the octave above it. A bass note does the
	// reverse, and subtracting one from the other is what stops an eighth-note bassline being
	// counted as eighth-note kicks.
	//
	// Subtracted before normalising, not after. Normalising each curve by its own 99.5th
	// percentile first made the weight mean something different on every track: measured across
	// the cached ones it landed anywhere between 1.16 and 4.08, so a track with a quiet bass had
	// its kicks defended four times as hard as one with a loud bass.
	const kickBand = raw(KICK[0], KICK[1]);
	const bassBand = raw(BASS_NOTE[0], BASS_NOTE[1]);
	const kickCurve = new Float32Array(spec.frames);
	for (let f = 0; f < spec.frames; f++) {
		kickCurve[f] = Math.max(0, kickBand[f] - BASS_WEIGHT * bassBand[f]);
	}
	normaliseCurve(kickCurve, kickCurve);

	// A snare is the two bands agreeing, and the weaker of them decides. The minimum rather
	// than the product because a hi-hat has a strong crack and no body at all, and a product
	// would still let it through at the square root of its body content.
	//
	// Nothing here looks at how much low end the frame has, tempting though it is. In most of
	// this repertoire the backbeat lands on a kick, so at the snare's own frame the bottom
	// octave is as loud as it ever gets, and any test that reads that as "this is a kick"
	// deletes the snares it was written to find.
	const snareCurve = new Float32Array(spec.frames);
	for (let f = 0; f < spec.frames; f++) {
		snareCurve[f] = Math.min(bodyCurve[f], crackCurve[f]);
	}

	const fps = spec.fps;
	// As a fraction of a sixteenth, not of a beat. At 40% of a beat the gap was wider than a
	// sixteenth at every reachable tempo, so a sixteenth roll was undetectable by construction:
	// 67 of 144 resolved at 120 bpm and 1 of 211 at 175. Below about half a sixteenth the
	// spectrogram's own 10 ms hop and 93 ms window decide the limit rather than this does.
	const sixteenth = opts.beatPeriod / 4;
	const kickGap = Math.max(0.05, sixteenth * KICK_GAP);
	const snareGap = Math.max(0.06, sixteenth * SNARE_GAP);

	const kickPeaks = pickPeaks(kickCurve, fps, {
		localMaxSec: 0.03,
		movingMeanSec: 0.1,
		delta: 0.06,
		refractorySec: kickGap
	});
	const snarePeaks = pickPeaks(snareCurve, fps, {
		localMaxSec: 0.03,
		movingMeanSec: 0.1,
		// Higher than the kick's, because the two-band conjunction is not by itself decisive:
		// an offbeat bass note under an offbeat hat lights both bands at once and looks exactly
		// like a snare to it. This is where the threshold pays for that.
		delta: 0.15,
		refractorySec: snareGap
	});

	// A backbeat lands on a kick in most of this repertoire, so a coincident kick cannot veto
	// a snare outright; it only does when the bottom end is doing much more than the snare
	// bands are, which is a kick that happens to have a bright click.
	const kickLevel = maxFilter(kickCurve, Math.max(1, Math.round(0.03 * fps)));
	const snareKept = snarePeaks.filter((p) => p.strength > 0.3 * kickLevel[p.frame]);

	// Hats are vetoed near kicks only. A hi-hat on the backbeat is not a mistake, it is how
	// the pattern is played, so suppressing hats near snares deletes half of them.
	const hatPeaks = suppressNear(
		pickPeaks(hatCurve, fps, {
			localMaxSec: 0.02,
			movingMeanSec: 0.08,
			delta: 0.05,
			// A thirty-second note at 175 bpm is 43 ms; below that it is cymbal decay
			// retriggering rather than a fresh hit.
			refractorySec: Math.max(0.04, opts.beatPeriod * 0.2)
		}),
		kickPeaks,
		0.02
	);

	const radius = Math.min(0.05, opts.beatPeriod / 8);
	const stream = (curve: Float32Array, peaks: Peak[], meanSec: number): DrumStream => ({
		times: placeOnOnset(curve, peaks, opts.odf, fps, radius),
		...levelsOf(curve, peaks, fps, meanSec)
	});

	return {
		kick: stream(kickCurve, kickPeaks, 0.1),
		snare: stream(snareCurve, snareKept, 0.1),
		hat: stream(hatCurve, hatPeaks, 0.08)
	};
}

/**
 * Hit strengths and the curve they came from, both measured above the same local floor.
 *
 * Scaled by a high quantile of the track's own peaks rather than by its loudest, so one
 * mastering artefact cannot push a whole track's kicks to a tenth of full and leave every ring
 * the same dim size.
 */
function levelsOf(
	curve: Float32Array,
	peaks: readonly Peak[],
	fps: number,
	movingMeanSec: number
): { levels: number[]; curve: Float32Array; fps: number } {
	const floor = smooth(curve, Math.max(1, Math.round(movingMeanSec * fps)));
	const excess = new Float32Array(curve.length);
	for (let i = 0; i < curve.length; i++) excess[i] = Math.max(0, curve[i] - floor[i]);

	const top = peaks.length > 0 ? quantile(peaks.map((p) => p.strength), 0.9) : 0;
	const scale = top > 1e-9 ? 1 / top : 0;
	for (let i = 0; i < excess.length; i++) excess[i] = Math.min(1, excess[i] * scale);

	return {
		levels: peaks.map((p) => Math.min(1, p.strength * scale)),
		curve: excess,
		fps
	};
}

