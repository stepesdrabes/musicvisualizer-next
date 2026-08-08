import { readFileSync } from 'node:fs';

/**
 * Reading frame-level model embeddings, and squeezing them down to something a linear probe can
 * be fitted on without the fit being mostly regularisation.
 *
 * Bench only. Nothing here ships: the question is whether a learned representation carries what
 * energy and drum density do not, and that is answered on cached features long before anything
 * decides how they would be produced inside `packages/analysis`.
 */

export interface Npy {
	shape: number[];
	data: Float32Array;
}

/**
 * A NumPy .npy array, float16 or float32, C order only.
 *
 * Written by hand rather than pulled in as a dependency because the format is a fixed header and
 * a raw buffer, and bench has no package.json of its own to hang a dependency from.
 */
export function readNpy(path: string): Npy {
	const buf = readFileSync(path);
	if (buf.toString('latin1', 0, 6) !== '\x93NUMPY') throw new Error(`${path}: not a .npy`);
	const major = buf[6];
	const headerLen = major === 1 ? buf.readUInt16LE(8) : buf.readUInt32LE(8);
	const start = (major === 1 ? 10 : 12) + headerLen;
	const header = buf.toString('latin1', major === 1 ? 10 : 12, start);

	if (/fortran_order['"]?\s*:\s*True/.test(header)) throw new Error(`${path}: fortran order`);
	const shapeText = header.match(/'shape'\s*:\s*\(([^)]*)\)/)?.[1] ?? '';
	const shape = shapeText
		.split(',')
		.map((s) => Number(s.trim()))
		.filter((n) => Number.isFinite(n));
	const descr = header.match(/'descr'\s*:\s*'([^']+)'/)?.[1] ?? '';

	const count = shape.reduce((a, b) => a * b, 1);
	const body = buf.subarray(start);
	if (descr === '<f2') {
		const half = new Float16Array(body.buffer, body.byteOffset, count);
		return { shape, data: Float32Array.from(half) };
	}
	if (descr === '<f4') {
		return { shape, data: new Float32Array(body.buffer.slice(body.byteOffset, body.byteOffset + count * 4)) };
	}
	throw new Error(`${path}: unsupported dtype ${descr}`);
}

/**
 * Mean of the frames covering [t0, t1), for one layer of a [frames, layers, dim] blob, in
 * `slices` equal sub-spans written end to end.
 *
 * `slices = 1` is a plain mean over the section. More than one keeps a time axis inside it, and
 * that is not a refinement: a build is defined by where it is GOING rather than by what it
 * contains, so a mean over the whole span is the one summary guaranteed to erase it. Measured,
 * `arrange()`'s hand-written trajectory rule beat every mean-pooled learned feature on exactly
 * that class and on no other.
 *
 * Times are on the AUDIO's clock, not the annotation's. The two differ by the fitted offset on
 * every Harmonix track and mixing them up would shift a section's embedding into its neighbour.
 */
export function poolSpan(
	npy: Npy,
	fps: number,
	layer: number,
	t0: number,
	t1: number,
	out: Float32Array,
	slices = 1
): void {
	const [frames, layers, dim] = npy.shape;
	const lo = Math.max(0, Math.min(frames - 1, Math.floor(t0 * fps)));
	const hi = Math.max(lo + 1, Math.min(frames, Math.ceil(t1 * fps)));
	out.fill(0);

	for (let s = 0; s < slices; s++) {
		const from = lo + Math.floor(((hi - lo) * s) / slices);
		const to = Math.max(from + 1, lo + Math.floor(((hi - lo) * (s + 1)) / slices));
		const at = s * dim;
		for (let f = from; f < Math.min(to, frames); f++) {
			const base = (f * layers + layer) * dim;
			for (let d = 0; d < dim; d++) out[at + d] += npy.data[base + d];
		}
		const n = Math.max(1, Math.min(to, frames) - from);
		for (let d = 0; d < dim; d++) out[at + d] /= n;
	}
}

export interface Projection {
	mean: Float64Array;
	/** components * dim, row-major. */
	basis: Float64Array;
	components: number;
	dim: number;
}

/**
 * Randomised PCA, fitted on the training fold only.
 *
 * A 1024-dimensional embedding against roughly 1,500 training sections is a fit that is mostly
 * regularisation, and the number it produces says more about the penalty than the features. The
 * randomised range finder gets the top components in a handful of matrix products instead of the
 * 1024x1024 eigendecomposition, which matters because this runs once per fold per layer.
 *
 * Deterministic: the projection is seeded from a fixed constant, so two runs on the same fold
 * give the same basis and a difference between two layers is the layer.
 */
export function fitPca(rows: readonly Float32Array[], dim: number, components: number): Projection {
	const n = rows.length;
	const k = Math.min(components + 16, dim, n);

	const mean = new Float64Array(dim);
	for (const r of rows) for (let d = 0; d < dim; d++) mean[d] += r[d];
	for (let d = 0; d < dim; d++) mean[d] /= Math.max(1, n);

	let seed = 0x9e3779b1;
	const rand = () => {
		seed = (seed * 1103515245 + 12345) & 0x7fffffff;
		return seed / 0x7fffffff - 0.5;
	};

	let q = new Float64Array(k * dim);
	for (let i = 0; i < q.length; i++) q[i] = rand();
	orthonormalise(q, k, dim);

	// Two subspace iterations of Y = C Q with C = X^T X / n, never forming C.
	const scratch = new Float64Array(k);
	for (let iter = 0; iter < 3; iter++) {
		const next = new Float64Array(k * dim);
		for (const r of rows) {
			scratch.fill(0);
			for (let c = 0; c < k; c++) {
				let dot = 0;
				for (let d = 0; d < dim; d++) dot += q[c * dim + d] * (r[d] - mean[d]);
				scratch[c] = dot;
			}
			for (let c = 0; c < k; c++) {
				const s = scratch[c];
				if (s === 0) continue;
				for (let d = 0; d < dim; d++) next[c * dim + d] += s * (r[d] - mean[d]);
			}
		}
		orthonormalise(next, k, dim);
		q = next;
	}

	// The iteration converges to the dominant subspace but not to ordered components; ordering by
	// projected variance is what makes taking the first `components` rows mean anything.
	const variance = new Float64Array(k);
	for (const r of rows) {
		for (let c = 0; c < k; c++) {
			let dot = 0;
			for (let d = 0; d < dim; d++) dot += q[c * dim + d] * (r[d] - mean[d]);
			variance[c] += dot * dot;
		}
	}
	const order = [...variance.keys()].sort((a, b) => variance[b] - variance[a]).slice(0, components);
	const basis = new Float64Array(order.length * dim);
	order.forEach((c, i) => basis.set(q.subarray(c * dim, (c + 1) * dim), i * dim));

	return { mean, basis, components: order.length, dim };
}

/** Modified Gram-Schmidt, in place. Rows that collapse are refilled from the standard basis. */
function orthonormalise(q: Float64Array, k: number, dim: number): void {
	for (let c = 0; c < k; c++) {
		const row = q.subarray(c * dim, (c + 1) * dim);
		for (let p = 0; p < c; p++) {
			const prev = q.subarray(p * dim, (p + 1) * dim);
			let dot = 0;
			for (let d = 0; d < dim; d++) dot += row[d] * prev[d];
			for (let d = 0; d < dim; d++) row[d] -= dot * prev[d];
		}
		let norm = 0;
		for (let d = 0; d < dim; d++) norm += row[d] * row[d];
		norm = Math.sqrt(norm);
		if (norm < 1e-9) {
			row.fill(0);
			row[c % dim] = 1;
			norm = 1;
		}
		for (let d = 0; d < dim; d++) row[d] /= norm;
	}
}

export function project(p: Projection, x: Float32Array, out: number[]): void {
	for (let c = 0; c < p.components; c++) {
		let dot = 0;
		for (let d = 0; d < p.dim; d++) dot += p.basis[c * p.dim + d] * (x[d] - p.mean[d]);
		out[c] = dot;
	}
}
