/** Iterative radix-2 FFT with precomputed bit-reversal, twiddle and Hann tables. */
export class FFT {
	private readonly rev: Uint32Array;
	private readonly cos: Float32Array;
	private readonly sin: Float32Array;
	private readonly window: Float32Array;
	readonly size: number;

	constructor(size: number) {
		if ((size & (size - 1)) !== 0) throw new Error(`FFT size must be a power of two: ${size}`);
		this.size = size;

		const bits = Math.log2(size);
		this.rev = new Uint32Array(size);
		for (let i = 0; i < size; i++) {
			let r = 0;
			for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
			this.rev[i] = r;
		}

		const half = size >> 1;
		this.cos = new Float32Array(half);
		this.sin = new Float32Array(half);
		for (let i = 0; i < half; i++) {
			this.cos[i] = Math.cos((-2 * Math.PI * i) / size);
			this.sin[i] = Math.sin((-2 * Math.PI * i) / size);
		}

		this.window = new Float32Array(size);
		for (let i = 0; i < size; i++) {
			this.window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
		}
	}

	/** Copy a Hann-windowed slice into re/im, zero-padding past the end of the signal. */
	loadWindowed(signal: Float32Array, offset: number, re: Float32Array, im: Float32Array): void {
		const n = this.size;
		for (let i = 0; i < n; i++) {
			const j = offset + i;
			re[i] = j < signal.length ? signal[j] * this.window[i] : 0;
			im[i] = 0;
		}
	}

	transform(re: Float32Array, im: Float32Array): void {
		const n = this.size;

		for (let i = 0; i < n; i++) {
			const j = this.rev[i];
			if (j > i) {
				let t = re[i];
				re[i] = re[j];
				re[j] = t;
				t = im[i];
				im[i] = im[j];
				im[j] = t;
			}
		}

		for (let len = 2; len <= n; len <<= 1) {
			const half = len >> 1;
			const step = n / len;
			for (let i = 0; i < n; i += len) {
				for (let k = 0; k < half; k++) {
					const tw = k * step;
					const wr = this.cos[tw];
					const wi = this.sin[tw];
					const a = i + k;
					const b = a + half;
					const xr = re[b] * wr - im[b] * wi;
					const xi = re[b] * wi + im[b] * wr;
					re[b] = re[a] - xr;
					im[b] = im[a] - xi;
					re[a] += xr;
					im[a] += xi;
				}
			}
		}
	}

	/** Fills the first size/2 bins with normalised magnitudes. */
	magnitudes(re: Float32Array, im: Float32Array, out: Float32Array): void {
		const scale = 2 / this.size;
		for (let k = 0; k < out.length; k++) {
			out[k] = Math.hypot(re[k], im[k]) * scale;
		}
	}
}

/** RBJ cookbook lowpass, applied in place. */
export function lowpassInPlace(
	signal: Float32Array,
	sampleRate: number,
	cutoffHz: number,
	q = 0.707
): void {
	const w0 = (2 * Math.PI * cutoffHz) / sampleRate;
	const cosW0 = Math.cos(w0);
	const alpha = Math.sin(w0) / (2 * q);

	const b0 = (1 - cosW0) / 2;
	const b1 = 1 - cosW0;
	const b2 = (1 - cosW0) / 2;
	const a0 = 1 + alpha;
	const a1 = -2 * cosW0;
	const a2 = 1 - alpha;

	const nb0 = b0 / a0;
	const nb1 = b1 / a0;
	const nb2 = b2 / a0;
	const na1 = a1 / a0;
	const na2 = a2 / a0;

	let x1 = 0;
	let x2 = 0;
	let y1 = 0;
	let y2 = 0;
	for (let i = 0; i < signal.length; i++) {
		const x0 = signal[i];
		const y0 = nb0 * x0 + nb1 * x1 + nb2 * x2 - na1 * y1 - na2 * y2;
		x2 = x1;
		x1 = x0;
		y2 = y1;
		y1 = y0;
		signal[i] = y0;
	}
}
