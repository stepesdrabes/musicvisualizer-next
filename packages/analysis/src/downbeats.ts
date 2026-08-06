import type { BeatFeatures } from './beatsync.ts';
import { rowDistance } from './beatsync.ts';
import { PITCH_CLASSES } from './chroma.ts';
import { mean, stdev } from './dsp/stats.ts';

export interface Meter {
	beatsPerBar: number;
	/** Which beat index mod beatsPerBar starts a bar. */
	phase: number;
	/** 0..1; how much better this reading is than the runner-up. */
	confidence: number;
}

const CANDIDATE_METERS = [4, 3];
/**
 * Four beats to a bar unless three is clearly better. In the Harmonix Set 890 of 912 tracks
 * are in four, so a marginal preference for three is much more likely to be a detector
 * artefact than a waltz.
 */
const THREE_PENALTY = 0.72;

function z(a: Float32Array): Float32Array {
	const out = new Float32Array(a.length);
	const m = mean(a);
	const s = stdev(a) || 1;
	for (let i = 0; i < a.length; i++) out[i] = (a[i] - m) / s;
	return out;
}

/**
 * A per-beat "this is a downbeat" score from cues that do not need to know the meter.
 *
 * The three that carry the weight are: harmony changes on the downbeat far more often than
 * anywhere else; the kick lands on it; and the snare deliberately does not, which is why the
 * mid-band term is subtracted rather than added.
 */
export function downbeatLikelihood(bf: BeatFeatures): Float32Array {
	const n = bf.count;
	const out = new Float32Array(n);
	if (n === 0) return out;

	const harmonic = new Float32Array(n);
	const bassJump = new Float32Array(n);
	for (let i = 1; i < n; i++) {
		harmonic[i] = rowDistance(bf.chroma, i - 1, i, PITCH_CLASSES);
		bassJump[i] = Math.abs(Math.log10((bf.bass[i] + 1e-6) / (bf.bass[i - 1] + 1e-6)));
	}

	const zh = z(harmonic);
	const zb = z(bassJump);
	const zf = z(bf.flux);
	const zl = z(bf.low);
	const zm = z(bf.mid);

	// Weights chosen against the GTZAN beat and downbeat annotations. Broadband spectral
	// change is deliberately absent: on its own it predicts downbeats, but next to harmonic
	// change it only adds what that already says, and fitting it a weight bought nothing that
	// survived a held-out half.
	for (let i = 0; i < n; i++) {
		out[i] = 1.2 * zh[i] + 0.25 * zb[i] + 0.5 * zf[i] + 0.8 * zl[i] - 0.8 * zm[i];
	}
	return out;
}

/** Autocorrelation of a beat-level curve at one lag, mean-removed and variance-normalised. */
function acfAt(a: Float32Array, lag: number): number {
	const n = a.length - lag;
	if (n < 4) return 0;
	const m = mean(a);
	let num = 0;
	let da = 0;
	for (let i = 0; i < n; i++) {
		num += (a[i] - m) * (a[i + lag] - m);
		da += (a[i] - m) ** 2;
	}
	return da > 1e-12 ? num / da : 0;
}

/**
 * Meter and downbeat phase together.
 *
 * The meter comes from where the beat sequence repeats itself: a bar in four makes the beat
 * two bars away resemble this one, so the likelihood curve correlates at lags 4, 8 and 16,
 * where three-time correlates at 3, 6 and 12. The phase then just picks whichever residue
 * class collects the most downbeat evidence.
 */
export function detectMeter(bf: BeatFeatures): Meter {
	const like = downbeatLikelihood(bf);
	if (bf.count < 8) return { beatsPerBar: 4, phase: 0, confidence: 0 };

	const scored = CANDIDATE_METERS.map((m) => {
		const repetition = (acfAt(like, m) + acfAt(like, m * 2) + acfAt(like, m * 4)) / 3;

		let bestPhase = 0;
		let bestSeparation = -Infinity;
		let runnerUp = -Infinity;
		for (let p = 0; p < m; p++) {
			let on = 0;
			let onN = 0;
			let off = 0;
			let offN = 0;
			for (let i = 0; i < bf.count; i++) {
				if (i % m === p) {
					on += like[i];
					onN++;
				} else {
					off += like[i];
					offN++;
				}
			}
			const separation = on / Math.max(1, onN) - off / Math.max(1, offN);
			if (separation > bestSeparation) {
				runnerUp = bestSeparation;
				bestSeparation = separation;
				bestPhase = p;
			} else if (separation > runnerUp) {
				runnerUp = separation;
			}
		}

		const prior = m === 3 ? THREE_PENALTY : 1;
		return {
			beatsPerBar: m,
			phase: bestPhase,
			score: (Math.max(0, repetition) + Math.max(0, bestSeparation)) * prior,
			margin: bestSeparation - runnerUp
		};
	});

	scored.sort((a, b) => b.score - a.score);
	const best = scored[0];
	const second = scored[1];
	const confidence = second && best.score > 0 ? 1 - Math.min(1, second.score / best.score) : 0;

	return {
		beatsPerBar: best.beatsPerBar,
		phase: best.phase,
		confidence: Math.max(0, Math.min(1, (confidence + Math.min(1, best.margin)) / 2))
	};
}

/**
 * Which bar index starts a phrase, given where sections actually change.
 *
 * Taken from the boundaries rather than from novelty, because the whole point of the anchor
 * is that the arrangement's own changes land on it; deriving it from anything else leaves
 * every boundary a bar off the grid the cues are held to.
 */
export function fitPhraseAnchor(
	boundaryBars: readonly number[],
	phraseBars: number,
	barCount: number
): number {
	if (boundaryBars.length === 0) return 0;
	let best = 0;
	let bestHits = -1;
	for (let anchor = 0; anchor < phraseBars; anchor++) {
		let hits = 0;
		for (const b of boundaryBars) {
			if (b <= 0 || b >= barCount) continue;
			if ((((b - anchor) % phraseBars) + phraseBars) % phraseBars === 0) hits++;
		}
		if (hits > bestHits) {
			bestHits = hits;
			best = anchor;
		}
	}
	return best;
}
