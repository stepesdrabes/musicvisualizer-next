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
/** Above this, the beats a doubled reading would add are carrying real onsets. */
const MIDPOINT_SUPPORTED = 0.5;
/** Below this, alternate beats are weak enough that a halved reading is arguable. */
const ALTERNATE_WEAK = 0.6;

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

	const even = beats.filter((_, i) => i % 2 === 0);
	const odd = beats.filter((_, i) => i % 2 === 1);
	const a = meanAt(odf, fps, even);
	const b = meanAt(odf, fps, odd);
	const strong = Math.max(a, b);
	const altRatio = strong > 1e-9 ? Math.min(a, b) / strong : 1;

	const alternatives: number[] = [];
	if (bpm * 2 <= MAX_BPM && midRatio >= MIDPOINT_SUPPORTED) alternatives.push(bpm * 2);
	if (bpm / 2 >= MIN_BPM && altRatio <= ALTERNATE_WEAK) alternatives.push(bpm / 2);
	// A shuffle read straight, or a straight groove read as a shuffle, is a two-against-three
	// disagreement rather than an octave, and it happens often enough to be worth naming.
	if (bpm * 1.5 <= MAX_BPM && midRatio >= MIDPOINT_SUPPORTED) alternatives.push(bpm * 1.5);

	alternatives.sort((x, y) => prior(y) - prior(x));

	const rivalled = alternatives.some((alt) => prior(alt) > prior(bpm));
	const confidence = rivalled
		? Math.max(0, Math.min(1, prior(bpm) / Math.max(...alternatives.map(prior), 1e-9)))
		: Math.max(0, Math.min(1, 1 - Math.max(0, midRatio - MIDPOINT_SUPPORTED)));

	return {
		bpm,
		ambiguous: alternatives.length > 0,
		confidence,
		alternatives: alternatives.map((x) => Math.round(x * 100) / 100),
		reason: `midpoints ${(midRatio * 100).toFixed(0)}% of beat strength, alternates ${(altRatio * 100).toFixed(0)}%`
	};
}
