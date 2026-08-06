import { MAX_BPM, MIN_BPM, tempoCandidates, trackBeats } from './tempo.ts';
import { gaussianSmooth, mean, quantile, sampleAt } from './dsp/stats.ts';

export interface BeatGrid {
	bpm: number;
	beatPeriod: number;
	/** Time of beat 0, seconds. Always inside [0, beatPeriod). */
	firstBeat: number;
	/** Every beat in the track. Equal to the constant grid when `constant` is true. */
	beats: Float64Array;
	/** False when the track drifts enough that one period cannot describe it. */
	constant: boolean;
	/** 0..1. How much of the onset energy the grid actually explains. */
	confidence: number;
}

/** How much the bar-grouping test is allowed to overrule the tempogram. Swept, then fixed. */
const COHERENCE_WEIGHT = 1;

export interface BeatOptions {
	/** Constrain the search to within 6% of a known tempo. */
	bpmHint?: number;
}

/**
 * How strongly a constant grid at (period, phase) is supported by the onset curve: the mean
 * onset strength landing on its beats, measured only over the stretch where the track is
 * actually playing so a long silent outro cannot dilute it.
 */
function gridSupport(
	odf: Float32Array,
	fps: number,
	period: number,
	phase: number,
	from: number,
	to: number
): number {
	let acc = 0;
	let n = 0;
	const start = Math.ceil((from - phase) / period);
	const end = Math.floor((to - phase) / period);
	for (let k = start; k <= end; k++) {
		acc += sampleAt(odf, (phase + k * period) * fps);
		n++;
	}
	return n > 0 ? acc / n : 0;
}

function bestPhase(
	odf: Float32Array,
	fps: number,
	period: number,
	from: number,
	to: number,
	steps: number
): { phase: number; support: number } {
	let best = 0;
	let bestSupport = -1;
	for (let s = 0; s < steps; s++) {
		const phase = (s / steps) * period;
		const support = gridSupport(odf, fps, period, phase, from, to);
		if (support > bestSupport) {
			bestSupport = support;
			best = phase;
		}
	}
	return { phase: best, support: bestSupport };
}

/**
 * Refine a seed tempo into the best constant grid, coarse to fine.
 *
 * Resolution matters more than it looks: at 150 bpm over four minutes a 0.1 bpm error walks
 * the grid off the music by 40% of a beat, so the last pass has to resolve a thousandth.
 */
function refineGrid(
	odf: Float32Array,
	fps: number,
	seedBpm: number,
	from: number,
	to: number
): { bpm: number; phase: number; support: number } {
	let bpm = seedBpm;
	let phase = 0;
	let support = 0;

	for (const [range, step, phases] of [
		[0.02, 0.0015, 96],
		[0.002, 0.00015, 192],
		[0.0002, 0.00002, 384]
	] as const) {
		let bestBpm = bpm;
		let bestPhaseV = phase;
		let bestSupport = -1;
		for (let r = -range; r <= range + 1e-12; r += step) {
			const cand = bpm * (1 + r);
			if (cand < MIN_BPM * 0.9 || cand > MAX_BPM * 1.1) continue;
			const period = 60 / cand;
			const p = bestPhase(odf, fps, period, from, to, phases);
			if (p.support > bestSupport) {
				bestSupport = p.support;
				bestBpm = cand;
				bestPhaseV = p.phase;
			}
		}
		bpm = bestBpm;
		phase = bestPhaseV;
		support = bestSupport;
	}

	return { bpm, phase, support };
}

/** Onset strength at each beat of a constant grid, the sequence bars are made of. */
function beatSeries(
	odf: Float32Array,
	fps: number,
	period: number,
	phase: number,
	from: number,
	to: number
): number[] {
	const out: number[] = [];
	const reach = 3;
	for (let k = Math.ceil((from - phase) / period); k <= Math.floor((to - phase) / period); k++) {
		const c = Math.round((phase + k * period) * fps);
		let m = 0;
		for (let i = Math.max(0, c - reach); i <= Math.min(odf.length - 1, c + reach); i++) {
			if (odf[i] > m) m = odf[i];
		}
		out.push(m);
	}
	return out;
}

function autocorrelation(a: readonly number[], lag: number): number {
	const n = a.length - lag;
	if (n < 8) return 0;
	let m = 0;
	for (const v of a) m += v;
	m /= a.length;
	let num = 0;
	let den = 0;
	for (let i = 0; i < n; i++) {
		num += (a[i] - m) * (a[i + lag] - m);
		den += (a[i] - m) ** 2;
	}
	return den > 1e-12 ? num / den : 0;
}

/**
 * How strongly a candidate's beats organise into bars of three or four.
 *
 * This is the tie-breaker the tempogram cannot supply. A grid at three times the real tempo
 * explains the onsets about as well as the true one, because it lands on every triplet, but
 * its beats do not group: nothing recurs every three or four of them. Asking that question
 * separates 63 from 190 where no prior narrow enough to do it would leave 174 alone.
 */
function barCoherence(
	odf: Float32Array,
	fps: number,
	bpm: number,
	from: number,
	to: number
): number {
	const period = 60 / bpm;
	const phase = bestPhase(odf, fps, period, from, to, 96).phase;
	const series = beatSeries(odf, fps, period, phase, from, to);
	const four = (autocorrelation(series, 4) + autocorrelation(series, 8)) / 2;
	const three = (autocorrelation(series, 3) + autocorrelation(series, 6)) / 2;
	return Math.max(0, four, three);
}

/** Trim leading and trailing near-silence, which no grid should be scored against. */
function activeSpan(odf: Float32Array, fps: number): [number, number] {
	const level = gaussianSmooth(odf, fps * 0.5);
	const floor = quantile(level, 0.55) * 0.35;
	let lo = 0;
	let hi = level.length - 1;
	while (lo < hi && level[lo] < floor) lo++;
	while (hi > lo && level[hi] < floor) hi--;
	return [lo / fps, hi / fps];
}

/**
 * Spread of the local tempo over 16-beat windows, as a fraction of the median. A programmed
 * track sits under half a percent; anything played to a click stays under two; a live take
 * without one runs well past that.
 *
 * Measured on the tracked sequence rather than on the grid, because the grid cannot bend by
 * construction and would always report zero.
 */
function tempoSpread(times: Float64Array): number {
	const win = 16;
	const locals: number[] = [];
	for (let i = 0; i + win < times.length; i += win) {
		locals.push((60 * win) / (times[i + win] - times[i]));
	}
	if (locals.length < 4) return 0;
	locals.sort((a, b) => a - b);
	const p10 = locals[Math.floor(locals.length * 0.1)];
	const p90 = locals[Math.floor(locals.length * 0.9)];
	const mid = locals[locals.length >> 1];
	return mid > 0 ? (p90 - p10) / mid : 0;
}

export function detectBeats(
	odf: Float32Array,
	fps: number,
	duration: number,
	opts: BeatOptions = {}
): BeatGrid {
	const [from, to] = activeSpan(odf, fps);
	const minBpm = opts.bpmHint ? opts.bpmHint * 0.94 : MIN_BPM;
	const maxBpm = opts.bpmHint ? opts.bpmHint * 1.06 : MAX_BPM;
	const candidates = tempoCandidates(odf, fps, minBpm, maxBpm);
	if (candidates.length === 0) return fallbackGrid(duration, (minBpm + maxBpm) / 2);

	// Grid support cannot arbitrate between octaves: half the grid points of a half-tempo
	// reading land on the strongest beats of the real one, so support rises monotonically as
	// the tempo halves and would pick 69 for every 138 track. The tempogram's salience, which
	// already carries the tempo prior, decides instead, weighted by whether the resulting
	// beats group into bars.
	const shortlist = candidates
		.slice(0, 4)
		.filter((c) => c.salience > candidates[0].salience * 0.5);

	let best: { bpm: number; phase: number; support: number; score: number } | null = null;
	let runnerUp = 0;
	for (const c of shortlist) {
		const g = refineGrid(odf, fps, c.bpm, from, to);
		const score = c.salience * (1 + COHERENCE_WEIGHT * barCoherence(odf, fps, g.bpm, from, to));
		if (!best || score > best.score) {
			if (best) runnerUp = Math.max(runnerUp, best.score);
			best = { ...g, score };
		} else {
			runnerUp = Math.max(runnerUp, score);
		}
	}
	if (!best) return fallbackGrid(duration, (minBpm + maxBpm) / 2);

	// No octave correction beyond the prior. Comparing the beats against the midpoints between
	// them looks like it should settle half-versus-double, and it does not: swept over 243
	// annotated tracks, every threshold pair tried lost accuracy against leaving the
	// tempogram's answer alone, because at a true tempo the midpoints still carry 45 to 75
	// per cent of the beats' strength and the two cases overlap.
	const period = 60 / best.bpm;
	const phase = ((best.phase % period) + period) % period;

	// The tracked sequence is what says whether one period can describe the whole track. It is
	// not used for the beats themselves unless it has to be: a constant grid keeps its phase
	// across a quiet passage, where the tracker is free to slip half a beat and slip back.
	const dp = trackBeats(odf, fps, best.bpm);
	const drifting = dp.times.length > 32 && tempoSpread(dp.times) > 0.025;

	const beats = drifting ? Float64Array.from(dp.times) : constantBeats(phase, period, duration);

	// Two independent doubts, and the smaller wins. The grid can land squarely on every onset
	// and still be at the wrong metrical level, which is the error that actually happens: the
	// margin term is what says so, and it is what should send a caller looking for a published
	// tempo rather than trusting this one.
	const reference = mean(odf, Math.round(from * fps), Math.round(to * fps)) || 1e-9;
	const support = Math.max(0, Math.min(1, (best.support / reference - 1) / 3));
	const margin = best.score > 0 ? Math.max(0, Math.min(1, 1 - runnerUp / best.score)) : 0;

	return {
		bpm: drifting ? dp.bpm : best.bpm,
		beatPeriod: drifting ? 60 / dp.bpm : period,
		firstBeat: drifting ? (beats[0] ?? 0) : phase,
		beats,
		constant: !drifting,
		confidence: Math.min(support, 0.35 + 0.65 * margin)
	};
}

function fallbackGrid(duration: number, bpm: number): BeatGrid {
	const period = 60 / bpm;
	return {
		bpm,
		beatPeriod: period,
		firstBeat: 0,
		beats: constantBeats(0, period, duration),
		constant: true,
		confidence: 0
	};
}

function constantBeats(phase: number, period: number, duration: number): Float64Array {
	const first = phase % period;
	const count = Math.max(0, Math.floor((duration - first) / period) + 1);
	const beats = new Float64Array(count);
	for (let i = 0; i < count; i++) beats[i] = first + i * period;
	return beats;
}
