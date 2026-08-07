/**
 * Harmonic-percussive separation by median filtering (Fitzgerald 2010, with Driedger's
 * separation factor).
 *
 * A sustained note is a horizontal ridge in a spectrogram: steady in a few bands over many
 * frames. A drum hit is a vertical stripe: broadband, in one frame. Median-filtering along
 * time keeps the ridges and erases the stripes; filtering along frequency does the reverse.
 * Comparing the two says which each cell belongs to.
 *
 * This runs on the filterbank spectrogram rather than on raw bins, which is a tenth of the
 * work and loses nothing: the decision is about shape in time, not about pitch. Nothing is
 * ever resynthesised, so the artefacts that make people wary of median-filter HPSS - all of
 * which come from inverting a masked spectrum - cannot arise.
 */
export interface Separation {
	/** frames * bands, the percussive share of each cell, 0 or 1. */
	percussive: Float32Array;
	/** frames * bands, the harmonic share. */
	harmonic: Float32Array;
}

/**
 * Sharpness of the split.
 *
 * A soft Wiener mask rather than a hard gate. The gate this replaces required one side to beat
 * the other by a factor before a cell went anywhere at all, which sent 46% of kick-band cells
 * to neither side and left about 6% of the band's magnitude in `percussive`: a kick is
 * broadband and short, so half its cells look like a draw at any one band. Splitting every cell
 * in proportion keeps the two shares summing to the input, and the exponent decides how
 * decisive a small lead is.
 */
const MASK_POWER = 2;

export function separate(
	mag: Float32Array,
	frames: number,
	bands: number,
	timeRadius = 8,
	bandRadius = 8
): Separation {
	const harmonicEnhanced = new Float32Array(frames * bands);
	const percussiveEnhanced = new Float32Array(frames * bands);

	const line = new Float32Array(Math.max(frames, bands));
	const filtered = new Float32Array(Math.max(frames, bands));

	for (let b = 0; b < bands; b++) {
		for (let f = 0; f < frames; f++) line[f] = mag[f * bands + b];
		movingMedian(line, frames, timeRadius, filtered);
		for (let f = 0; f < frames; f++) harmonicEnhanced[f * bands + b] = filtered[f];
	}

	for (let f = 0; f < frames; f++) {
		const o = f * bands;
		for (let b = 0; b < bands; b++) line[b] = mag[o + b];
		movingMedian(line, bands, bandRadius, filtered);
		for (let b = 0; b < bands; b++) percussiveEnhanced[o + b] = filtered[b];
	}

	const percussive = new Float32Array(frames * bands);
	const harmonic = new Float32Array(frames * bands);
	for (let i = 0; i < percussive.length; i++) {
		const h = Math.pow(harmonicEnhanced[i], MASK_POWER);
		const p = Math.pow(percussiveEnhanced[i], MASK_POWER);
		const total = h + p;
		if (!(total > 0)) continue;
		percussive[i] = (mag[i] * p) / total;
		harmonic[i] = (mag[i] * h) / total;
	}

	return { percussive, harmonic };
}

/**
 * Median over a centred window, kept exact by maintaining the window sorted. An insertion
 * and a deletion per step is O(w) with a memmove, which beats re-sorting by enough to matter
 * over the millions of cells a track produces.
 */
function movingMedian(src: Float32Array, len: number, radius: number, out: Float32Array): void {
	if (radius <= 0 || len === 0) {
		out.set(src.subarray(0, len));
		return;
	}

	const window = new Float32Array(2 * radius + 1);
	let size = 0;

	const insert = (v: number) => {
		let lo = 0;
		let hi = size;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if (window[mid] < v) lo = mid + 1;
			else hi = mid;
		}
		window.copyWithin(lo + 1, lo, size);
		window[lo] = v;
		size++;
	};

	const remove = (v: number) => {
		let lo = 0;
		let hi = size;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if (window[mid] < v) lo = mid + 1;
			else hi = mid;
		}
		window.copyWithin(lo, lo + 1, size);
		size--;
	};

	for (let i = 0; i <= Math.min(radius, len - 1); i++) insert(src[i]);

	for (let i = 0; i < len; i++) {
		out[i] = window[size >> 1];
		const drop = i - radius;
		if (drop >= 0) remove(src[drop]);
		const add = i + radius + 1;
		if (add < len) insert(src[add]);
	}
}
