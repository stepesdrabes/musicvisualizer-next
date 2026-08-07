import { MAX_BPM, MIN_BPM } from './tempo.ts';
import { sampleAt } from './dsp/stats.ts';

/**
 * Whether a beat sequence could just as well be read at half or double the rate.
 *
 * This deliberately does not correct anything, because a corrector was tried and measured and
 * it does not work. On the four tracks where a listener settled the level by ear, the obvious
 * discriminator - do the midpoints between beats carry onsets of their own - came out
 * anti-correlated with the truth: a track that must NOT be doubled had midpoints at 70% of the
 * beat strength, and one that must be doubled had them at 50%. A log-normal tempo prior scored
 * two of four as well, and one of the four disagreements was a 2:3 relationship rather than an
 * octave at all. Acc1 against Acc2 is the standing open problem in tempo estimation and it is
 * not going to be closed by a threshold here.
 *
 * What is worth having is an honest flag. The tracker's level is kept, this says how safe that
 * is, and the two together let the app offer a half/double correction on exactly the tracks
 * that need one instead of on all of them.
 */

/** Where the perceptual tactus sits, and how wide in octaves. Matches `tempo.ts`. */
const PRIOR_BPM = 120;
const PRIOR_OCTAVES = 0.6;
/**
 * The relatives of a reading that a listener might have counted instead.
 *
 * Offered on the evidence of the tempo prior alone, and NOT gated on any local discriminator.
 * That is the finding of the listening test, not laziness: the obvious test - do the midpoints
 * between beats carry onsets of their own - came out anti-correlated with the truth, and it is
 * also structurally wrong for the case that matters most. A double-time reading of a rock track
 * has real hats on the beats a halved reading would drop, so "alternate beats are weak" is
 * never true and halving was never offered on the one track that needed it.
 *
 * Two thirds is here because the error is not always an octave. A track counted in six where it
 * is played in four is out by exactly this, and offering only half and double left the listener
 * with no way to say so.
 */
const RELATIVES = [1 / 2, 2 / 3, 3 / 2, 2];
/**
 * Below this the reading sits somewhere a tactus rarely does, and the app says so.
 *
 * It means exactly that and nothing more. A prior cannot adjudicate metrical level - the
 * listening test settled that - so this decides how PROMINENTLY to offer the correction, never
 * whether to offer it. The alternatives are there on every track either way, because the only
 * reliable judge of this is the person in the room.
 */
const UNUSUAL_TACTUS = 0.6;

function prior(bpm: number): number {
	return Math.exp(-0.5 * (Math.log2(bpm / PRIOR_BPM) / PRIOR_OCTAVES) ** 2);
}

function meanAt(odf: Float32Array, fps: number, times: readonly number[]): number {
	if (times.length === 0) return 0;
	let acc = 0;
	for (const t of times) acc += sampleAt(odf, t * fps);
	return acc / times.length;
}

export function medianPeriod(beats: readonly number[]): number {
	if (beats.length < 2) return 0;
	const d: number[] = [];
	for (let i = 1; i < beats.length; i++) d.push(beats[i] - beats[i - 1]);
	d.sort((a, b) => a - b);
	return d[d.length >> 1];
}

export interface MetricalAssessment {
	bpm: number;
	/** True when half or double is defensible on the evidence, so a listener may disagree. */
	ambiguous: boolean;
	/** 0..1. How safe the reported level is; low means offer the correction prominently. */
	confidence: number;
	/** Readings a listener might prefer, most plausible first. Empty when nothing rivals. */
	alternatives: number[];
	reason: string;
}

export function assessMetricalLevel(
	beats: readonly number[],
	odf: Float32Array,
	fps: number
): MetricalAssessment {
	const period = medianPeriod(beats);
	if (beats.length < 8 || !(period > 1e-6)) {
		return { bpm: 0, ambiguous: true, confidence: 0, alternatives: [], reason: 'too few beats' };
	}
	const bpm = 60 / period;

	const onBeat = meanAt(odf, fps, beats);
	if (!(onBeat > 1e-9)) {
		return { bpm, ambiguous: true, confidence: 0, alternatives: [], reason: 'no onset energy on the beats' };
	}

	const mids: number[] = [];
	for (let i = 1; i < beats.length; i++) mids.push((beats[i - 1] + beats[i]) / 2);
	const midRatio = meanAt(odf, fps, mids) / onBeat;

	const alternatives = RELATIVES.map((r) => bpm * r)
		.filter((alt) => alt >= MIN_BPM && alt <= MAX_BPM)
		.sort((x, y) => prior(y) - prior(x));

	// A rival reading almost always exists, so "a rival exists" would flag everything and mean
	// nothing. What is worth saying is that this reading is an unusual place for a tactus.
	const support = prior(bpm);
	const ambiguous = support < UNUSUAL_TACTUS;

	return {
		bpm,
		ambiguous,
		confidence: Math.max(0, Math.min(1, support)),
		alternatives: alternatives.map((x) => Math.round(x * 100) / 100),
		reason: ambiguous
			? `${Math.round(bpm)} bpm is an unusual tactus; ${Math.round(alternatives[0])} is a commoner reading of the same beats`
			: `midpoints ${(midRatio * 100).toFixed(0)}% of beat strength`
	};
}
