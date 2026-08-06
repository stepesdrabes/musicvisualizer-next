import { clamp01, dbAt, normalise01 } from './features.ts';

export const MIN_BPM = 84;
export const MAX_BPM = 200;

const PRIOR_BPM = 132;
const PRIOR_SIGMA = 0.55;

export interface GridFit {
	bpm: number;
	firstBeat: number;
	confidence: number;
}

/**
 * How well a candidate grid explains the onsets. The two halves catch opposite errors:
 *
 *   coverage  = fraction of grid slots holding an onset  -> catches double tempo
 *   precision = fraction of onsets sitting on a slot     -> catches half tempo
 */
export function gridQuality(
	times: Float32Array,
	period: number,
	offset: number
): { coverage: number; precision: number } {
	if (times.length === 0 || period <= 0) return { coverage: 0, precision: 0 };

	const tol = period * 0.15;
	const slots = new Set<number>();
	let hits = 0;

	for (const t of times) {
		const k = Math.round((t - offset) / period);
		if (Math.abs(t - (offset + k * period)) <= tol) {
			hits++;
			slots.add(k);
		}
	}

	// Only count slots inside the span where onsets were actually observed, so a long silent
	// outro does not look like missing beats.
	const span = Math.max(times[times.length - 1] - times[0], period);
	const expected = Math.max(1, Math.round(span / period) + 1);

	return { coverage: Math.min(1, slots.size / expected), precision: hits / times.length };
}

/**
 * Fit one global tempo and phase to the whole track.
 *
 * Coarse stage: a histogram of folded inter-onset intervals, weighted by a log-Gaussian
 * prior, which kills the classic 75-vs-150 error before it starts.
 *
 * Fine stage: circular vector strength. Map every onset to an angle 2*pi*t/T and sum the
 * unit vectors; if T is right they pile up at one angle and the sum is long. That is
 * O(onsets) per candidate instead of O(onsets * phases), so 0.01 BPM resolution is
 * affordable, and the resultant's argument hands us the phase for free. Resolution matters
 * more than it looks: at 150 BPM over 4 minutes a 0.1 BPM error walks off by 40% of a beat.
 */
export function fitBeatGrid(
	times: Float32Array,
	weights: Float32Array,
	duration: number,
	minBpm = MIN_BPM,
	maxBpm = MAX_BPM
): GridFit {
	const fallbackBpm = Math.min(maxBpm, Math.max(minBpm, PRIOR_BPM));
	if (times.length < 8) return { bpm: fallbackBpm, firstBeat: 0, confidence: 0 };

	const minP = 60 / maxBpm;
	const maxP = 60 / minBpm;

	const BINS = 600;
	const hist = new Float32Array(BINS);
	for (let i = 1; i < times.length; i++) {
		for (let j = Math.max(0, i - 8); j < i; j++) {
			let d = times[i] - times[j];
			if (d <= 0.05 || d > 5) continue;
			while (d > maxP) d /= 2;
			while (d < minP) d *= 2;
			if (d < minP || d > maxP) continue;
			const bin = Math.floor(((d - minP) / (maxP - minP)) * (BINS - 1));
			const w = (weights[i] + weights[j]) * 0.5;
			for (let k = -2; k <= 2; k++) {
				const b = bin + k;
				if (b >= 0 && b < BINS) hist[b] += w * Math.exp(-(k * k) / 2);
			}
		}
	}

	// Score without mutating the histogram mid-scan, and keep each score attached to its own
	// candidate: re-deriving the bin from a bpm lands off-by-one and reads the wrong bin.
	const candidates: { bpm: number; score: number }[] = [];
	for (let b = 1; b < BINS - 1; b++) {
		if (hist[b] <= hist[b - 1] || hist[b] < hist[b + 1]) continue;
		const p = minP + (b / (BINS - 1)) * (maxP - minP);
		const bpm = 60 / p;
		const prior = Math.exp(-0.5 * (Math.log2(bpm / PRIOR_BPM) / PRIOR_SIGMA) ** 2);
		candidates.push({ bpm, score: hist[b] * prior });
	}
	candidates.sort((a, b) => b.score - a.score);

	const seeds = candidates.slice(0, 5).map((c) => c.bpm);
	if (seeds.length === 0) seeds.push(fallbackBpm);
	for (const mult of [0.5, 2]) {
		const b = seeds[0] * mult;
		if (b >= minBpm && b <= maxBpm) seeds.push(b);
	}

	let wSum = 0;
	for (const w of weights) wSum += w;
	if (wSum <= 0) wSum = times.length;

	let best = { bpm: fallbackBpm, offset: 0, score: -1, coverage: 0, precision: 0 };

	for (const seed of seeds) {
		const lo = Math.max(minBpm, seed * 0.975);
		const hi = Math.min(maxBpm, seed * 1.025);

		let localBpm = seed;
		let localPhase = 0;
		let localStrength = -1;

		for (let bpm = lo; bpm <= hi; bpm += 0.01) {
			const k = (2 * Math.PI) / (60 / bpm);
			let sx = 0;
			let sy = 0;
			for (let i = 0; i < times.length; i++) {
				const a = times[i] * k;
				sx += weights[i] * Math.cos(a);
				sy += weights[i] * Math.sin(a);
			}
			const strength = Math.hypot(sx, sy) / wSum;
			if (strength > localStrength) {
				localStrength = strength;
				localBpm = bpm;
				localPhase = Math.atan2(sy, sx);
			}
		}

		const T = 60 / localBpm;
		let offset = (localPhase / (2 * Math.PI)) * T;
		offset = ((offset % T) + T) % T;

		// Vector strength alone cannot separate octaves on real material: EDM puts hats on
		// the offbeat, so at double tempo BOTH kicks and hats land on the grid and the
		// resultant is longer at the wrong answer. Coverage fixes it: at double tempo only
		// half the slots contain anything.
		const q = gridQuality(times, T, offset);
		const prior = Math.exp(-0.5 * (Math.log2(localBpm / PRIOR_BPM) / PRIOR_SIGMA) ** 2);
		const score = q.coverage * (0.55 + 0.45 * q.precision) * (0.7 + 0.3 * prior);

		if (score > best.score) {
			best = { bpm: localBpm, offset, score, coverage: q.coverage, precision: q.precision };
		}
	}

	// The 8th-note bassline trap: kicks and snares on the quarters, bass filling between.
	// The double grid covers everything, but half its slots only ever hold the weak hits.
	if (best.bpm / 2 >= minBpm) {
		const T = 60 / best.bpm;
		let evenSum = 0;
		let evenN = 0;
		let oddSum = 0;
		let oddN = 0;
		for (let i = 0; i < times.length; i++) {
			const k = Math.round((times[i] - best.offset) / T);
			if (Math.abs(times[i] - (best.offset + k * T)) > T * 0.15) continue;
			if (((k % 2) + 2) % 2 === 0) {
				evenSum += weights[i];
				evenN++;
			} else {
				oddSum += weights[i];
				oddN++;
			}
		}
		const even = evenN ? evenSum / evenN : 0;
		const odd = oddN ? oddSum / oddN : 0;
		const hi = Math.max(even, odd);
		const lo = Math.min(even, odd);
		if (hi > 0 && lo / hi < 0.55 && evenN > 4 && oddN > 4) {
			if (odd > even) best.offset += T;
			best.bpm /= 2;
		}
	}

	let firstBeat = best.offset;
	if (firstBeat > duration) firstBeat = 0;

	// Reported as grid quality rather than raw vector strength: downstream this means "does
	// every beat really have a hit on it", not "how tightly do onsets cluster in phase".
	return {
		bpm: best.bpm,
		firstBeat,
		confidence: clamp01(best.coverage * (0.5 + 0.5 * best.precision))
	};
}

/**
 * Refine to a constant grid by maximising envelope support at grid points.
 *
 * A 0.5% period error is invisible to vector strength but walks the grid off the onsets by
 * the last chorus, so this sweeps progressively finer around the seed.
 */
export function refineGrid(
	envelope: Float32Array,
	featureRate: number,
	seedBpm: number,
	duration: number,
	minBpm = MIN_BPM,
	maxBpm = MAX_BPM
): { bpm: number; firstBeat: number } {
	const n = envelope.length;

	const supportAt = (T: number, phase: number): number => {
		let score = 0;
		const beats = Math.floor((duration - phase) / T);
		for (let k = 0; k < beats; k++) {
			const x = (phase + k * T) * featureRate;
			const i0 = Math.floor(x);
			if (i0 < 0 || i0 >= n - 1) continue;
			const u = x - i0;
			score += envelope[i0] * (1 - u) + envelope[i0 + 1] * u;
		}
		return beats > 0 ? score / beats : 0;
	};

	const bestPhaseFor = (T: number, phases: number) => {
		let bp = 0;
		let bs = -1;
		for (let s = 0; s < phases; s++) {
			const phase = (s / phases) * T;
			const sc = supportAt(T, phase);
			if (sc > bs) {
				bs = sc;
				bp = phase;
			}
		}
		return { phase: bp, score: bs };
	};

	let bpm = seedBpm;
	let firstBeat = 0;

	for (const [range, step] of [
		[0.015, 0.001],
		[0.001, 0.0001],
		[0.0001, 0.00001]
	] as const) {
		let bestScore = -1;
		let bestBpm = bpm;
		let bestPhase = firstBeat;
		for (let r = -range; r <= range + 1e-9; r += step) {
			const cand = bpm * (1 + r);
			if (cand < minBpm || cand > maxBpm) continue;
			const T = 60 / cand;
			const { phase, score } = bestPhaseFor(T, 48);
			if (score > bestScore) {
				bestScore = score;
				bestBpm = cand;
				bestPhase = phase;
			}
		}
		bpm = bestBpm;
		firstBeat = bestPhase;
	}

	// supportAt is a per-slot mean, so this is exactly "how strong is the average beat at
	// each level". If the half-tempo grid wins, the fast grid was filled by weak subdivisions.
	if (bpm / 2 >= minBpm) {
		const fullT = 60 / bpm;
		const fullScore = supportAt(fullT, firstBeat);
		const a = supportAt(fullT * 2, firstBeat);
		const b = supportAt(fullT * 2, firstBeat + fullT);
		if (Math.max(a, b) > fullScore * 1.08) {
			if (b > a) firstBeat += fullT;
			bpm /= 2;
		}
	}

	{
		const T = 60 / bpm;
		let bestScore = -1;
		let best = firstBeat;
		for (let s = -12; s <= 12; s++) {
			const phase = (((firstBeat + (s / 24) * 0.08 * T) % T) + T) % T;
			const sc = supportAt(T, phase);
			if (sc > bestScore) {
				bestScore = sc;
				best = phase;
			}
		}
		firstBeat = best;
	}

	return { bpm, firstBeat };
}

/**
 * Which beat of four is the downbeat. Folds three evidence streams over the four candidate
 * phases: onset novelty and bass change say "1", snare flux says "2 and 4".
 */
export function detectDownbeat(
	noveltyN: Float32Array,
	snareFlux: Float32Array,
	bandDb: Float32Array,
	featureRate: number,
	firstBeat: number,
	beatPeriod: number,
	beatCount: number,
	frameCount: number
): number {
	const nov = new Float32Array(beatCount);
	const snare = new Float32Array(beatCount);
	const sub = new Float32Array(beatCount);

	const halfWin = Math.max(1, Math.round(0.07 * featureRate));
	for (let k = 0; k < beatCount; k++) {
		const t = firstBeat + k * beatPeriod;
		const c = Math.round(t * featureRate);
		const f0 = Math.max(0, c - halfWin);
		const f1 = Math.min(frameCount, c + halfWin + 1);
		if (f1 <= f0) continue;

		let nv = 0;
		let sn = 0;
		for (let f = f0; f < f1; f++) {
			if (noveltyN[f] > nv) nv = noveltyN[f];
			if (snareFlux[f] > sn) sn = snareFlux[f];
		}
		nov[k] = nv;
		snare[k] = sn;

		const g0 = Math.max(0, c);
		const g1 = Math.min(frameCount, Math.round((t + beatPeriod) * featureRate));
		let sb = 0;
		for (let f = g0; f < g1; f++) {
			sb += Math.pow(10, (dbAt(bandDb, f, 0) + dbAt(bandDb, f, 1)) / 40);
		}
		sub[k] = g1 > g0 ? sb / (g1 - g0) : 0;
	}

	normalise01(nov, nov);
	normalise01(snare, snare);

	const bassChange = new Float32Array(beatCount);
	for (let k = 1; k < beatCount; k++) {
		const a = 20 * Math.log10(sub[k - 1] + 1e-9);
		const b = 20 * Math.log10(sub[k] + 1e-9);
		bassChange[k] = Math.abs(b - a);
	}
	normalise01(bassChange, bassChange);

	const score = new Float32Array(4);
	const counts = new Int32Array(4);
	for (let k = 0; k < beatCount; k++) {
		const p = k % 4;
		score[p] += nov[k] + 0.4 * bassChange[k] - 0.6 * snare[k];
		counts[p]++;
	}
	for (let p = 0; p < 4; p++) if (counts[p] > 0) score[p] /= counts[p];

	let best = 0;
	for (let p = 1; p < 4; p++) if (score[p] > score[best]) best = p;
	return best;
}

/** Fold boundary novelty at period 8 and take the offset with the most energy. */
export function fitPhraseAnchor(
	barNovelty: Float32Array,
	barsPerPhrase = 8
): number {
	if (barNovelty.length < barsPerPhrase * 2) return 0;
	let bestOffset = 0;
	let bestScore = -1;
	for (let o = 0; o < barsPerPhrase; o++) {
		let sum = 0;
		let n = 0;
		for (let b = o; b < barNovelty.length; b += barsPerPhrase) {
			sum += barNovelty[b] * barNovelty[b];
			n++;
		}
		const score = n > 0 ? sum / n : 0;
		if (score > bestScore) {
			bestScore = score;
			bestOffset = o;
		}
	}
	return bestOffset;
}
