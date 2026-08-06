import type { Spectrogram } from './dsp/spectrogram.ts';
import { separate } from './dsp/hpss.ts';
import { maxFilter } from './dsp/stats.ts';
import { pickPeaks, refinePeakTime, type Peak } from './onsets.ts';

export interface DrumOnsets {
	kick: number[];
	snare: number[];
	hat: number[];
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
	for (let f = lag; f < frames; f++) {
		let acc = 0;
		for (let b = lo; b < hi; b++) {
			const cur = Math.log10(1 + mag[f * bands + b]);
			const prev = Math.log10(1 + mag[(f - lag) * bands + b]);
			if (cur > prev) acc += cur - prev;
		}
		out[f] = acc;
	}
	return out;
}

function normaliseCurve(curve: Float32Array): Float32Array {
	const sorted = Float32Array.from(curve).sort();
	const top = sorted[Math.floor(sorted.length * 0.995)] || 1;
	const out = new Float32Array(curve.length);
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

	const flux = (lo: number, hi: number) =>
		normaliseCurve(bandFlux(percussive, spec.frames, spec.bands, spec.centreHz, lo, hi, lag));

	const kickBand = flux(KICK[0], KICK[1]);
	const bassBand = flux(BASS_NOTE[0], BASS_NOTE[1]);
	const bodyCurve = flux(SNARE_BODY[0], SNARE_BODY[1]);
	const crackCurve = flux(SNARE_CRACK[0], SNARE_CRACK[1]);
	const hatCurve = flux(HAT[0], HAT[1]);

	// A kick puts far more into 20-90 Hz than into the octave above it. A bass note does the
	// reverse, and subtracting one from the other is what stops an eighth-note bassline being
	// counted as eighth-note kicks.
	const kickCurve = new Float32Array(spec.frames);
	for (let f = 0; f < spec.frames; f++) {
		kickCurve[f] = Math.max(0, kickBand[f] - 0.8 * bassBand[f]);
	}

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
	// Two kicks to a beat is common, three is not; sixteenth-note kicks are rare enough that
	// resolving them is not worth what it costs in doubles.
	const kickGap = Math.max(0.07, opts.beatPeriod * 0.4);
	const snareGap = Math.max(0.08, opts.beatPeriod * 0.4);

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

	return {
		kick: kickPeaks.map((p) => refinePeakTime(kickCurve, p.frame, fps)),
		snare: snareKept.map((p) => refinePeakTime(snareCurve, p.frame, fps)),
		hat: hatPeaks.map((p) => refinePeakTime(hatCurve, p.frame, fps))
	};
}

