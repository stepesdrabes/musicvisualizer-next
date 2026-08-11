/**
 * Beat, downbeat and tempo metrics, faithful to mir_eval 0.8.
 *
 * Recovered from the deleted harness (bench/metrics.ts, removed in b94e2fa), unchanged: the
 * numbers must stay comparable with the baselines recorded against it.
 *
 * Faithful rather than approximate on purpose: these numbers are the only thing that says
 * whether a change to the analyser is real, and a metric that is merely close makes a
 * regression look like noise. Every threshold and every denominator here matches
 * mir_eval.beat and mir_eval.tempo so the figures are comparable with published ones.
 */

/** mir_eval trims the first five seconds: nobody's tracker has locked on yet. */
export const MIN_BEAT_TIME = 5;
const F_WINDOW = 0.07;
const PHASE_THRESHOLD = 0.175;
const PERIOD_THRESHOLD = 0.175;
const TEMPO_TOL = 0.04;

export function trimBeats(beats: readonly number[], minTime = MIN_BEAT_TIME): number[] {
	return beats.filter((b) => b >= minTime);
}

/**
 * Maximum bipartite matching between reference and estimated events inside `window`.
 *
 * Greedy nearest-neighbour is the obvious shortcut and it undercounts: two estimates either
 * side of one reference can steal each other's partners, which shows up as a lower F on
 * exactly the dense-onset tracks that matter here.
 */
function matchEvents(ref: readonly number[], est: readonly number[], window: number): number {
	const adj: number[][] = ref.map(() => []);
	let j = 0;
	for (let i = 0; i < ref.length; i++) {
		while (j < est.length && est[j] < ref[i] - window) j++;
		for (let k = j; k < est.length && est[k] <= ref[i] + window; k++) adj[i].push(k);
	}

	const matchOfEst = new Int32Array(est.length).fill(-1);
	const seen = new Uint8Array(est.length);

	const augment = (i: number): boolean => {
		for (const k of adj[i]) {
			if (seen[k]) continue;
			seen[k] = 1;
			if (matchOfEst[k] === -1 || augment(matchOfEst[k])) {
				matchOfEst[k] = i;
				return true;
			}
		}
		return false;
	};

	let matched = 0;
	for (let i = 0; i < ref.length; i++) {
		seen.fill(0);
		if (augment(i)) matched++;
	}
	return matched;
}

export function fMeasure(
	ref: readonly number[],
	est: readonly number[],
	window = F_WINDOW
): number {
	if (ref.length === 0 || est.length === 0) return 0;
	const hits = matchEvents(ref, est, window);
	const precision = hits / est.length;
	const recall = hits / ref.length;
	return precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
}

/** Linear interpolation of a beat sequence onto fractional indices, as np.interp does. */
function interpolateBeats(beats: readonly number[], step: number): number[] {
	const out: number[] = [];
	for (let x = 0; x <= beats.length - 1 + 1e-9; x += step) {
		const i = Math.min(beats.length - 2, Math.floor(x));
		if (i < 0) {
			out.push(beats[0]);
			continue;
		}
		const frac = x - i;
		out.push(beats[i] + (beats[i + 1] - beats[i]) * frac);
	}
	return out;
}

/**
 * The metrical variations AML is allowed to match against: double time, both half-time
 * phases, the offbeat, and the three third-time phases.
 */
function referenceVariations(ref: readonly number[]): number[][] {
	if (ref.length < 2) return [];
	const double = interpolateBeats(ref, 0.5);
	return [
		double,
		ref.filter((_, i) => i % 2 === 0),
		ref.filter((_, i) => i % 2 === 1),
		double.filter((_, i) => i % 2 === 1),
		ref.filter((_, i) => i % 3 === 0),
		ref.filter((_, i) => i % 3 === 1),
		ref.filter((_, i) => i % 3 === 2)
	];
}

function continuityHelper(ref: readonly number[], est: readonly number[]): [number, number] {
	if (ref.length === 0 || est.length === 0) return [0, 0];

	const n = Math.max(ref.length, est.length);
	const used = new Uint8Array(n);
	const success = new Uint8Array(n);

	for (let m = 0; m < est.length; m++) {
		let nearest = 0;
		let minDiff = Infinity;
		for (let i = 0; i < ref.length; i++) {
			const d = Math.abs(est[m] - ref[i]);
			if (d < minDiff) {
				minDiff = d;
				nearest = i;
			}
		}
		if (used[nearest]) continue;

		// The first beat and the first annotation have no interval behind them, so both
		// intervals are read forward instead. Everything after looks backward.
		const forward = nearest === 0 || m === 0;
		const refInterval = forward
			? nearest + 1 < ref.length
				? ref[nearest + 1] - ref[nearest]
				: ref[nearest] - ref[nearest - 1]
			: ref[nearest] - ref[nearest - 1];
		const estInterval = forward
			? m + 1 < est.length
				? est[m + 1] - est[m]
				: est[m] - est[m - 1]
			: est[m] - est[m - 1];

		let phase: number;
		if (refInterval === 0) phase = minDiff === 0 ? 1 : Infinity;
		else phase = Math.abs(minDiff / refInterval);

		let period: number;
		if (refInterval === 0) period = estInterval === 0 ? 0 : Infinity;
		else period = Math.abs(1 - estInterval / refInterval);

		if (phase < PHASE_THRESHOLD && period < PERIOD_THRESHOLD) {
			used[nearest] = 1;
			success[m] = 1;
		}
	}

	let longest = 0;
	let run = 0;
	let total = 0;
	for (let i = 0; i < n; i++) {
		if (success[i]) {
			run++;
			total++;
			if (run > longest) longest = run;
		} else {
			run = 0;
		}
	}
	return [longest / n, total / n];
}

export interface Continuity {
	cmlC: number;
	cmlT: number;
	amlC: number;
	amlT: number;
}

export function continuity(ref: readonly number[], est: readonly number[]): Continuity {
	if (ref.length === 0 || est.length === 0) return { cmlC: 0, cmlT: 0, amlC: 0, amlT: 0 };
	const [cmlC, cmlT] = continuityHelper(ref, est);
	let amlC = cmlC;
	let amlT = cmlT;
	for (const variation of referenceVariations(ref)) {
		const [c, t] = continuityHelper(variation, est);
		if (c > amlC) amlC = c;
		if (t > amlT) amlT = t;
	}
	return { cmlC, cmlT, amlC, amlT };
}

/**
 * Acc1 is the estimate within 4% of the annotated tempo; Acc2 forgives a metrical factor.
 *
 * The factor set is the MIREX one. Two thirds and three halves are in it because a tracker
 * that reads a 6/8 track in two is not making the same mistake as one that is simply wrong.
 */
const METRICAL_FACTORS = [1 / 3, 1 / 2, 2 / 3, 1, 3 / 2, 2, 3];

export function tempoAccuracy(
	refBpm: number,
	estBpm: number,
	tol = TEMPO_TOL
): { acc1: boolean; acc2: boolean } {
	if (!(refBpm > 0) || !(estBpm > 0)) return { acc1: false, acc2: false };
	const acc1 = Math.abs(estBpm - refBpm) / refBpm <= tol;
	const acc2 = METRICAL_FACTORS.some((m) => Math.abs(estBpm - refBpm * m) / (refBpm * m) <= tol);
	return { acc1, acc2 };
}

export interface BeatScores {
	f: number;
	cmlC: number;
	cmlT: number;
	amlC: number;
	amlT: number;
}

export function scoreBeats(ref: readonly number[], est: readonly number[]): BeatScores {
	const r = trimBeats(ref);
	const e = trimBeats(est);
	const c = continuity(r, e);
	return { f: fMeasure(r, e), ...c };
}
