import { SPECTRUM_BANDS, encodeBase64, type SpectrumTrack } from '@mv/core';
import type { Spectrogram } from './dsp/spectrogram.ts';
import { normalise } from './dsp/stats.ts';

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
 * Fold the analyser's filterbank down to the handful of log-spaced bands the show carries.
 *
 * Per-band normalisation across the whole track, matching `Envelopes.bands`: the alternative is
 * a shared scale, which shows the mix's spectral tilt honestly and therefore shows a room where
 * only the bottom three bands ever move. What a meter wants is every column carrying its own
 * dynamics, which is also what an LED analyser's per-band AGC does.
 */
export function spectrumTrack(spec: Spectrogram, duration: number): SpectrumTrack {
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

	const column = new Float32Array(frames);
	const data = new Uint8Array(frames * bands);
	for (let k = 0; k < bands; k++) {
		for (let f = 0; f < frames; f++) column[f] = db[f * bands + k];
		const n = normalise(column, 0.02, 0.98);
		for (let f = 0; f < frames; f++) data[f * bands + k] = Math.round(n[f] * 255);
	}

	return { fps: SPECTRUM_FPS, bands, centreHz, data: encodeBase64(data) };
}
