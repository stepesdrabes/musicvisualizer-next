/**
 * The bench used to carry its own copy of the Beat This! front end. It now lives in
 * `packages/analysis/src/beatthis.ts`, because shipping one implementation and measuring a
 * different one is how a benchmark comes to disagree with the thing it is benchmarking.
 *
 * What stays here is only what the bench needs and the package does not: tempo and meter
 * derived from the model's beats, which the analyser gets from `metricalLevel.ts` and
 * `meterFromDownbeats` instead.
 */
export { BeatThis, BEATTHIS_RATE, logMelSpectrogram, type BeatThisResult } from '../packages/analysis/src/beatthis.ts';

/** Median inter-beat interval as bpm, which is what the reference reports as tempo. */
export function tempoFrom(beats: readonly number[]): number {
	if (beats.length < 2) return 0;
	const iois: number[] = [];
	for (let i = 1; i < beats.length; i++) iois.push(beats[i] - beats[i - 1]);
	iois.sort((a, b) => a - b);
	const median = iois[iois.length >> 1];
	return median > 0 ? 60 / median : 0;
}

/** Beats per bar from the spacing of downbeats along the beat sequence. */
export function meterFrom(beats: readonly number[], downbeats: readonly number[]): number {
	if (downbeats.length < 2 || beats.length === 0) return 0;
	const index = new Map<number, number>();
	beats.forEach((b, i) => index.set(b, i));
	const gaps: number[] = [];
	for (let i = 1; i < downbeats.length; i++) {
		const a = index.get(downbeats[i - 1]);
		const b = index.get(downbeats[i]);
		if (a !== undefined && b !== undefined && b > a) gaps.push(b - a);
	}
	if (gaps.length === 0) return 0;
	gaps.sort((a, b) => a - b);
	return gaps[gaps.length >> 1];
}
