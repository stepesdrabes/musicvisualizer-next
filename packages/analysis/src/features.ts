import { BAND_EDGES_HZ, NUM_BANDS } from '@mv/core';
import { FFT, lowpassInPlace } from './fft.ts';

export const N_FFT = 2048;
export const HOP = 512;

/** Tilt compensation for the ~-3 dB/octave slope of real music, per band. */
const PINK_COMPENSATION = [1.0, 1.7, 3.2, 6.5];

export interface BandMap {
	lo: Uint16Array;
	hi: Uint16Array;
}

export function buildBandMap(fftSize: number, sampleRate: number): BandMap {
	const binHz = sampleRate / fftSize;
	const bins = fftSize / 2;
	const lo = new Uint16Array(NUM_BANDS);
	const hi = new Uint16Array(NUM_BANDS);
	for (let b = 0; b < NUM_BANDS; b++) {
		lo[b] = Math.max(1, Math.min(bins - 1, Math.round(BAND_EDGES_HZ[b] / binHz)));
		hi[b] = Math.max(lo[b] + 1, Math.min(bins, Math.round(BAND_EDGES_HZ[b + 1] / binHz)));
	}
	return { lo, hi };
}

/** RMS of magnitudes blended with the band peak, which keeps narrow transients visible. */
function aggregateBands(mags: Float32Array, map: BandMap, out: Float32Array): void {
	for (let b = 0; b < NUM_BANDS; b++) {
		let sumSq = 0;
		let peak = 0;
		const from = map.lo[b];
		const to = map.hi[b];
		for (let k = from; k < to; k++) {
			const m = mags[k];
			sumSq += m * m;
			if (m > peak) peak = m;
		}
		const rms = Math.sqrt(sumSq / (to - from));
		out[b] = rms * 0.72 + peak * 0.28;
	}
}

export function magToDb(v: number): number {
	return 20 * Math.log10(Math.max(v, 1e-9));
}

export interface Features {
	featureRate: number;
	frameCount: number;
	/** frameCount * NUM_BANDS, dB. */
	bandDb: Float32Array;
	rms: Float32Array;
	centroid: Float32Array;
	flatness: Float32Array;
	/** Raw broadband spectral flux, unconditioned. */
	novelty: Float32Array;
	/** Time-domain sub-band flux; the STFT cannot resolve a kick attack at 23 Hz per bin. */
	kickFlux: Float32Array;
	snareFlux: Float32Array;
	hatFlux: Float32Array;
}

export function extractFeatures(mono: Float32Array, sampleRate: number): Features {
	const featureRate = sampleRate / HOP;
	const frameCount = Math.max(1, Math.floor((mono.length - N_FFT) / HOP) + 1);

	const fft = new FFT(N_FFT);
	const re = new Float32Array(N_FFT);
	const im = new Float32Array(N_FFT);
	const mags = new Float32Array(N_FFT / 2);
	const map = buildBandMap(N_FFT, sampleRate);
	const binHz = sampleRate / N_FFT;

	const bandDb = new Float32Array(frameCount * NUM_BANDS);
	const bandLin = new Float32Array(NUM_BANDS);
	const rms = new Float32Array(frameCount);
	const centroid = new Float32Array(frameCount);
	const flatness = new Float32Array(frameCount);
	const novelty = new Float32Array(frameCount);
	const snareFlux = new Float32Array(frameCount);
	const hatFlux = new Float32Array(frameCount);
	const prevLog = new Float32Array(N_FFT / 2);

	let prevSnare = 0;
	let prevHat = 0;

	for (let f = 0; f < frameCount; f++) {
		fft.loadWindowed(mono, f * HOP, re, im);
		fft.transform(re, im);
		fft.magnitudes(re, im, mags);

		aggregateBands(mags, map, bandLin);
		for (let b = 0; b < NUM_BANDS; b++) {
			bandDb[f * NUM_BANDS + b] = magToDb(bandLin[b] * PINK_COMPENSATION[b]);
		}

		let sum = 0;
		let weighted = 0;
		let logSum = 0;
		let flux = 0;
		for (let k = 1; k < mags.length; k++) {
			const m = mags[k];
			sum += m;
			weighted += m * k;
			logSum += Math.log(m + 1e-9);
			// Log-compress before differencing so a quiet intro's onsets are comparable in
			// size to a loud drop's; raw linear flux gets this badly wrong.
			const lg = Math.log(1 + 100 * m);
			const d = lg - prevLog[k];
			if (d > 0) flux += d;
			prevLog[k] = lg;
		}

		const bins = mags.length - 1;
		const cHz = sum > 1e-9 ? (weighted / sum) * binHz : 0;
		centroid[f] = clamp01((Math.log10(Math.max(cHz, 20)) - 2) / 1.9);
		const geo = Math.exp(logSum / bins);
		const arith = sum / bins;
		flatness[f] = arith > 1e-9 ? clamp01(geo / arith) : 0;
		rms[f] = arith;
		novelty[f] = flux;

		// Flux on log-compressed linear energy, not on dB differences: at low levels a dB
		// delta is huge and noisy, which made the hat detector fire near-continuously.
		// Snare reads mid only, never low: the kick's body lives in low, so including it made
		// every four-on-the-floor kick register as a snare as well.
		const snare = Math.log(1 + 60 * bandLin[2]);
		snareFlux[f] = Math.max(0, snare - prevSnare);
		prevSnare = snare;

		const hat = Math.log(1 + 80 * bandLin[3]);
		hatFlux[f] = Math.max(0, hat - prevHat);
		prevHat = hat;
	}

	// 75 Hz, cascaded for -24 dB/oct. A 110 Hz bassline is only 9 dB down through a single
	// 150 Hz section, so every eighth-note bass note read as a kick.
	const low = Float32Array.from(mono);
	lowpassInPlace(low, sampleRate, 75, 0.707);
	lowpassInPlace(low, sampleRate, 75, 0.707);

	const kickFlux = new Float32Array(frameCount);
	{
		const env = new Float32Array(frameCount);
		for (let f = 0; f < frameCount; f++) {
			let acc = 0;
			const start = f * HOP;
			const end = Math.min(start + HOP, low.length);
			for (let i = start; i < end; i++) acc += low[i] * low[i];
			env[f] = Math.sqrt(acc / Math.max(1, end - start));
		}

		// Smooth before differencing. A 55 Hz kick RMS'd over 11.6 ms windows ripples,
		// because the window is not a whole number of cycles, and that ripple reads as fresh
		// positive flux 100 ms into the decay: one kick detected two or three times.
		let prev = 0;
		for (let f = 0; f < frameCount; f++) {
			const a = env[Math.max(0, f - 1)];
			const b = env[f];
			const c = env[Math.min(frameCount - 1, f + 1)];
			const smooth = a * 0.27 + b * 0.46 + c * 0.27;
			const lg = Math.log(1 + 25 * smooth);
			kickFlux[f] = Math.max(0, lg - prev);
			prev = lg;
		}
	}

	return {
		featureRate,
		frameCount,
		bandDb,
		rms,
		centroid,
		flatness,
		novelty,
		kickFlux,
		snareFlux,
		hatFlux
	};
}

export function clamp01(v: number): number {
	return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Rescale to 0..1 between the 5th and 95th percentile, so a threshold means the same thing
 * on a squashed master as on a dynamic one and one outlier bar cannot set the top.
 */
export function normalise01(a: Float32Array | Int32Array, out = new Float32Array(a.length)): Float32Array {
	if (a.length === 0) return out;
	const sorted = Float32Array.from(a).sort();
	const lo = sorted[Math.floor(sorted.length * 0.05)];
	const hi = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
	const span = Math.max(hi - lo, 1e-9);
	for (let i = 0; i < a.length; i++) out[i] = clamp01((a[i] - lo) / span);
	return out;
}

export function dbAt(bandDb: Float32Array, frame: number, band: number): number {
	return bandDb[frame * NUM_BANDS + band];
}
