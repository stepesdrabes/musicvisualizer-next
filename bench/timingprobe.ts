import { readdirSync } from 'node:fs';
import { decodeAudio } from '@mv/analysis';
import { extractFeatures } from '../packages/analysis/src/features.ts';
import { detectBeats } from '../packages/analysis/src/beats.ts';
import { detectDrums } from '../packages/analysis/src/drums.ts';
import { measureLoudness } from '../packages/analysis/src/loudness.ts';
import { pickPeaks, refinePeakTime } from '../packages/analysis/src/onsets.ts';

/**
 * Signed offset of each onset stream to the nearest sixteenth of the tracked beat grid.
 *
 * The beat grid is fitted to `odf`, so whatever systematic offset `odf` carries is absorbed
 * into the grid and reads as zero here. Any stream built by a different route keeps its own,
 * and that difference is exactly how late a flash arrives.
 */
const CACHE = new URL('../cache/', import.meta.url).pathname;
const ids = [
	...new Set(
		readdirSync(CACHE)
			.filter((f) => f.endsWith('.m4a'))
			.map((f) => f.replace('.m4a', ''))
	)
].sort();

/** Signed distance to the nearest sixteenth, seconds; positive means late. */
function offsets(times: readonly number[], beats: Float64Array): number[] {
	const out: number[] = [];
	for (const t of times) {
		if (t < beats[0] || t > beats[beats.length - 1]) continue;
		let lo = 0;
		let hi = beats.length - 1;
		while (hi - lo > 1) {
			const mid = (lo + hi) >> 1;
			if (beats[mid] <= t) lo = mid;
			else hi = mid;
		}
		const span = beats[lo + 1] - beats[lo];
		if (!(span > 1e-6)) continue;
		const step = span / 4;
		const k = Math.round((t - beats[lo]) / step);
		out.push(t - (beats[lo] + k * step));
	}
	return out;
}

const stat = (xs: number[]) => {
	if (xs.length === 0) return { mean: 0, median: 0, n: 0 };
	const sorted = [...xs].sort((a, b) => a - b);
	return {
		mean: xs.reduce((a, b) => a + b, 0) / xs.length,
		median: sorted[sorted.length >> 1],
		n: xs.length
	};
};

const rows: Record<string, number[]> = { odf: [], kick: [], snare: [], hat: [] };

console.log('track                              odf     kick    snare      hat   (mean ms, + = late)');
for (const id of ids) {
	const audio = await decodeAudio(`${CACHE}${id}.m4a`);
	const loud = measureLoudness(audio.mono, audio.sampleRate);
	const mono = Float32Array.from(audio.mono);
	const gain = Math.pow(10, (-14 - loud.integrated) / 20);
	if (Number.isFinite(gain)) {
		const g = Math.min(gain, 40);
		for (let i = 0; i < mono.length; i++) mono[i] *= g;
	}

	const f = extractFeatures(mono, audio.sampleRate);
	const grid = detectBeats(f.odf, f.curves.fps, audio.duration, {});
	const drums = detectDrums(f.spec, { beatPeriod: grid.beatPeriod, odf: f.odf });

	// The same peak picker on the very curve the grid was fitted to, as the zero reference.
	const odfPeaks = pickPeaks(f.odf, f.curves.fps, {
		localMaxSec: 0.03,
		movingMeanSec: 0.1,
		delta: 0.1,
		refractorySec: Math.max(0.07, grid.beatPeriod * 0.4)
	}).map((p) => refinePeakTime(f.odf, p.frame, f.curves.fps));

	const cells = [
		['odf', odfPeaks],
		['kick', drums.kick.times],
		['snare', drums.snare.times],
		['hat', drums.hat.times]
	] as const;
	const parts: string[] = [];
	for (const [name, times] of cells) {
		const o = offsets(times, grid.beats);
		rows[name].push(...o);
		parts.push((stat(o).mean * 1000).toFixed(1).padStart(8));
	}
	console.log(id.padEnd(30), parts.join(' '));
}

console.log('\ncorpus (mean / median ms, n)');
for (const [name, xs] of Object.entries(rows)) {
	const s = stat(xs);
	console.log(
		`  ${name.padEnd(6)} ${(s.mean * 1000).toFixed(1).padStart(7)} ${(s.median * 1000).toFixed(1).padStart(8)} ${String(s.n).padStart(8)}`
	);
}
