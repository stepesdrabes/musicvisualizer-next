import { clamp01 } from './features.ts';

/**
 * Ellis-2007 recipe: light smoothing, subtract a slow zero-phase moving average so the
 * curve is locally zero-mean, half-wave rectify, divide by its own standard deviation.
 * After this, "0.5" means the same thing in a quiet intro and a loud drop.
 */
export function conditionNovelty(raw: Float32Array, featureRate: number): Float32Array {
	const n = raw.length;
	const out = new Float32Array(n);

	for (let i = 0; i < n; i++) {
		const a = raw[Math.max(0, i - 1)];
		const b = raw[i];
		const c = raw[Math.min(n - 1, i + 1)];
		out[i] = a * 0.27 + b * 0.46 + c * 0.27;
	}

	// Single-pole run forwards then backwards, averaged, to keep the trend zero-phase.
	const tau = 0.35 * featureRate;
	const k = 1 - Math.exp(-1 / tau);
	const trend = new Float32Array(n);
	let acc = out[0];
	for (let i = 0; i < n; i++) {
		acc += (out[i] - acc) * k;
		trend[i] = acc;
	}
	acc = out[n - 1];
	for (let i = n - 1; i >= 0; i--) {
		acc += (out[i] - acc) * k;
		trend[i] = (trend[i] + acc) * 0.5;
	}

	let sumSq = 0;
	for (let i = 0; i < n; i++) {
		const v = Math.max(0, out[i] - trend[i]);
		out[i] = v;
		sumSq += v * v;
	}

	const std = Math.sqrt(sumSq / Math.max(1, n));
	if (std > 1e-9) {
		const inv = 1 / std;
		for (let i = 0; i < n; i++) out[i] *= inv;
	}
	return out;
}

export interface Peak {
	frame: number;
	strength: number;
}

/**
 * Adaptive-threshold peak picking. The threshold is a local median times a factor, not a
 * fixed level: a fixed threshold either misses a quiet intro or fires continuously through
 * a loud drop.
 *
 * The running median uses a coarse histogram because exact sorting per frame would be
 * O(n*w log w) over a 20k-frame curve.
 */
/**
 * Local max over ~1 s, via 0.25 s blocks. A median-only threshold is not enough on a sparse
 * curve: most frames between onsets are zero, so the median is zero and the threshold
 * collapses to its floor, which lets every weak eighth-note bass note through as a kick.
 */
function localMaxCurve(curve: Float32Array, featureRate: number): Float32Array {
	const block = Math.max(1, Math.round(0.25 * featureRate));
	const blocks = Math.ceil(curve.length / block);
	const blockMax = new Float32Array(blocks);
	for (let i = 0; i < curve.length; i++) {
		const b = (i / block) | 0;
		if (curve[i] > blockMax[b]) blockMax[b] = curve[i];
	}
	const out = new Float32Array(curve.length);
	// +-1 s rather than +-0.5 s. On a heavily limited master the flux never really rests, so a
	// short window's own maximum is modest and the gate it sets is too low to reject anything.
	const reach = 4;
	for (let i = 0; i < curve.length; i++) {
		const b = (i / block) | 0;
		let m = 0;
		for (let k = Math.max(0, b - reach); k <= Math.min(blocks - 1, b + reach); k++) {
			if (blockMax[k] > m) m = blockMax[k];
		}
		out[i] = m;
	}
	return out;
}

export function pickPeaks(
	curve: Float32Array,
	featureRate: number,
	refractorySec: number,
	/** A peak must also reach this fraction of the local maximum. */
	localMaxRatio = 0.3
): Peak[] {
	const n = curve.length;
	const win = Math.max(4, Math.round(featureRate * 0.5));
	const refractory = Math.max(1, Math.round(refractorySec * featureRate));
	const peaks: Peak[] = [];
	const localMax = localMaxCurve(curve, featureRate);

	let maxV = 1e-9;
	for (let i = 0; i < n; i++) if (curve[i] > maxV) maxV = curve[i];

	const BINS = 256;
	const hist = new Int32Array(BINS);
	const binOf = (v: number) =>
		Math.min(BINS - 1, Math.max(0, Math.floor((v / maxV) * (BINS - 1))));

	let count = 0;
	let lastPeak = -refractory * 2;

	for (let k = 0; k <= Math.min(win, n - 1); k++) {
		hist[binOf(curve[k])]++;
		count++;
	}

	for (let i = 0; i < n; i++) {
		let acc = 0;
		let medBin = 0;
		const half = count >> 1;
		for (let b = 0; b < BINS; b++) {
			acc += hist[b];
			if (acc >= half) {
				medBin = b;
				break;
			}
		}
		const med = (medBin / (BINS - 1)) * maxV;
		const threshold = Math.max(med * 1.6 + maxV * 0.012, localMax[i] * localMaxRatio);

		const v = curve[i];
		if (
			v > threshold &&
			i - lastPeak >= refractory &&
			(i === 0 || v >= curve[i - 1]) &&
			(i === n - 1 || v >= curve[i + 1])
		) {
			lastPeak = i;
			peaks.push({ frame: i, strength: clamp01(v / (threshold * 2)) });
		}

		if (i - win >= 0) {
			hist[binOf(curve[i - win])]--;
			count--;
		}
		if (i + 1 + win < n) {
			hist[binOf(curve[i + 1 + win])]++;
			count++;
		}
	}

	return peaks;
}

export function peakTimes(peaks: Peak[], featureRate: number): number[] {
	return peaks.map((p) => p.frame / featureRate);
}

/** Merge two onset streams into time-sorted parallel arrays. */
export function mergeOnsets(
	streams: { peaks: Peak[]; weight: number }[],
	featureRate: number
): { times: Float32Array; weights: Float32Array } {
	const total = streams.reduce((n, s) => n + s.peaks.length, 0);
	const pairs: { t: number; w: number }[] = new Array(total);
	let i = 0;
	for (const s of streams) {
		for (const p of s.peaks) {
			pairs[i++] = { t: p.frame / featureRate, w: p.strength * s.weight };
		}
	}
	pairs.sort((a, b) => a.t - b.t);
	return {
		times: Float32Array.from(pairs, (p) => p.t),
		weights: Float32Array.from(pairs, (p) => p.w)
	};
}

/** Drop hats within 30 ms of a kick: distorted kicks have huge high-frequency content. */
export function suppressNear(
	candidates: Peak[],
	suppressors: Peak[],
	featureRate: number,
	windowSec: number
): Peak[] {
	if (suppressors.length === 0) return candidates;
	const win = windowSec * featureRate;
	let j = 0;
	return candidates.filter((c) => {
		while (j < suppressors.length && suppressors[j].frame < c.frame - win) j++;
		for (let k = j; k < suppressors.length && suppressors[k].frame <= c.frame + win; k++) {
			if (Math.abs(suppressors[k].frame - c.frame) <= win) return false;
		}
		return true;
	});
}
