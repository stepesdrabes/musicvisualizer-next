import { SPECTRUM_BANDS, encodeBase64, sectionBase, type SectionKind, type SpectrumTrack } from '@mv/core';
import type { Spectrogram } from './dsp/spectrogram.ts';
import { centredMedian, quantile } from './dsp/stats.ts';

/**
 * Frames per second the spectrum is shipped at.
 *
 * Fifty, against the analyser's hundred. The eye integrates over about fifty milliseconds, so
 * twenty is already finer than anything a room can show, and halving the rate halves the
 * largest thing in the file. Below forty a sixteenth-note flicker at club tempo starts to alias.
 */
export const SPECTRUM_FPS = 50;
/**
 * The analysed range. Thirty hertz because nothing below it survives an LED strip anyway, and
 * sixteen kilohertz because that is where the filterbank ends.
 */
const MIN_HZ = 30;
const MAX_HZ = 16000;

/**
 * How many frames either side the centred median looks, at SPECTRUM_FPS.
 *
 * Zero group delay, which is the one thing an offline analyser gets for free and a realtime one
 * can never have. Measured on the corpus, the shipped spectrum's own frame-to-frame acceleration
 * was 8.80 bytes against the 4 bytes at which `flickerprobe` calls an effect shimmering: half of
 * its variance was noise, and every effect reading it had to pay for that noise with smoothing.
 * Removing it here is what makes the wider window below affordable.
 */
const MEDIAN_RADIUS = 5;
/**
 * The window, in dB, that the byte range is spread across.
 *
 * Swept: 26 dB gives more contrast (SD 0.280) and too little headroom (mean 0.653), 36 dB gives
 * 0.261. Thirty is where contrast stops paying for the range it costs.
 */
const WINDOW_DB = 30;
/**
 * The most a quiet section may be lifted toward the loud ones, in dB.
 *
 * The whole safety argument for the lift, and the number to re-measure before touching. A section
 * kind whose own q95 sits below the reference gets pulled up by at most this much, so a quiet
 * passage keeps some of its own articulation without arriving at a drop's. Six dB inside a 30 dB
 * window is 0.20 of the byte range and nothing more. Pooled across every INSTANCE of a kind, never
 * fitted per instance: per-instance AGC is exactly what makes every section look identical.
 */
const MAX_LIFT_DB = 6;

/**
 * Fold the analyser's filterbank down to the handful of log-spaced bands the show carries.
 *
 * A fixed dB window against one shared reference per band, NOT the per-band quantile stretch this
 * used to do. Stretching each band across its own whole-track range means every band reads near
 * full whenever it is near its own maximum, so a drop - where they all are - arrived as a flat
 * plateau: measured, mean 0.768 with a standard deviation of 0.136 and 14% of values pinned above
 * 0.93, which is a room with nothing left to react with. It also destroys the RELATIVE height
 * between bands, and that relationship is what makes a spectrum look like music rather than like
 * twenty independent meters.
 *
 * The reference is the 95th percentile over the loud sections pooled, so "1.0" means "as loud as
 * this track's loud passages get". Drops and grooves are genuinely about equally loud in this
 * repertoire (0.769 against 0.750 measured), so the spectrum is not asked to tell them apart; a
 * drop reads through its layers, its motion and its lit area instead.
 */
export function spectrumTrack(
	spec: Spectrogram,
	duration: number,
	sectionAt: (t: number) => SectionKind
): SpectrumTrack {
	const frames = Math.max(1, Math.round(duration * SPECTRUM_FPS));
	const bands = SPECTRUM_BANDS;

	// Band edges, and the source bins each one owns. A band narrower than the filterbank's own
	// spacing down at the bottom still gets one bin, or the sub would read as silence.
	const edges: number[] = [];
	for (let k = 0; k <= bands; k++) {
		edges.push(MIN_HZ * Math.pow(MAX_HZ / MIN_HZ, k / bands));
	}
	const centreHz: number[] = [];
	const range: [number, number][] = [];
	for (let k = 0; k < bands; k++) {
		let lo = 0;
		let hi = spec.bands;
		while (lo < spec.bands && spec.centreHz[lo] < edges[k]) lo++;
		while (hi > lo && spec.centreHz[hi - 1] > edges[k + 1]) hi--;
		range.push([Math.min(lo, spec.bands - 1), Math.max(hi, Math.min(lo + 1, spec.bands))]);
		centreHz.push(Math.round(Math.sqrt(edges[k] * edges[k + 1])));
	}

	const db = new Float32Array(frames * bands);
	for (let f = 0; f < frames; f++) {
		const s0 = Math.min(spec.frames - 1, Math.max(0, Math.round((f * spec.fps) / SPECTRUM_FPS)));
		const s1 = Math.max(s0 + 1, Math.min(spec.frames, Math.round(((f + 1) * spec.fps) / SPECTRUM_FPS)));
		for (let k = 0; k < bands; k++) {
			const [lo, hi] = range[k];
			let acc = 0;
			for (let s = s0; s < s1; s++) {
				for (let j = lo; j < hi; j++) acc += spec.mag[s * spec.bands + j];
			}
			const linear = acc / ((s1 - s0) * (hi - lo));
			db[f * bands + k] = 20 * Math.log10(Math.max(linear, 1e-7));
		}
	}

	const kinds: SectionKind[] = [];
	for (let f = 0; f < frames; f++) kinds.push(sectionAt((f + 0.5) / SPECTRUM_FPS));
	const loud: number[] = [];
	// By section BASE, or a verse/chorus track has no 'loud' frames at all and the window
	// silently falls back to the whole-track pooling meant for ambient edge cases.
	for (let f = 0; f < frames; f++) {
		const base = sectionBase(kinds[f]);
		if (base === 'drop' || base === 'groove') loud.push(f);
	}

	const column = new Float32Array(frames);
	const smoothed = new Float32Array(frames);
	const scratch: number[] = [];
	const data = new Uint8Array(frames * bands);

	for (let k = 0; k < bands; k++) {
		for (let f = 0; f < frames; f++) column[f] = db[f * bands + k];
		centredMedian(column, MEDIAN_RADIUS, smoothed);

		// A track with no loud section at all - an ambient piece, or one segmented into nothing but
		// intro and outro - has to reference something, and its own whole self is the honest choice.
		scratch.length = 0;
		if (loud.length > frames / 20) for (const f of loud) scratch.push(smoothed[f]);
		else for (let f = 0; f < frames; f++) scratch.push(smoothed[f]);
		const reference = quantile(scratch, 0.95);

		// One lift per section KIND, pooled over every instance of it.
		const lift = new Map<SectionKind, number>();
		for (const kind of new Set(kinds)) {
			scratch.length = 0;
			for (let f = 0; f < frames; f++) if (kinds[f] === kind) scratch.push(smoothed[f]);
			if (scratch.length === 0) continue;
			lift.set(kind, Math.max(0, Math.min(MAX_LIFT_DB, reference - quantile(scratch, 0.95))));
		}

		for (let f = 0; f < frames; f++) {
			const v = (smoothed[f] - reference + (lift.get(kinds[f]) ?? 0) + WINDOW_DB) / WINDOW_DB;
			data[f * bands + k] = Math.round(Math.max(0, Math.min(1, v)) * 255);
		}
	}

	return { fps: SPECTRUM_FPS, bands, centreHz, data: encodeBase64(data) };
}
