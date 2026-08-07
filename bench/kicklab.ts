import { readdirSync } from 'node:fs';
import { decodeAudio } from '@mv/analysis';
import { extractFeatures } from '../packages/analysis/src/features.ts';
import { detectBeats } from '../packages/analysis/src/beats.ts';
import { detectDrums } from '../packages/analysis/src/drums.ts';
import { measureLoudness } from '../packages/analysis/src/loudness.ts';
import { pickPeaks, refinePeakTime } from '../packages/analysis/src/onsets.ts';
import { separate } from '../packages/analysis/src/dsp/hpss.ts';
import { synthesise, fMeasure } from '../packages/analysis/src/fixture.ts';
import type { Spectrogram } from '../packages/analysis/src/dsp/spectrogram.ts';

/**
 * Candidate kick curves, scored two ways at once: how late their peaks land against the beat
 * grid on real tracks, and how well they recover the synthetic fixture's exact kick times.
 *
 * Both are needed. A curve can be made punctual by widening it until it fires on everything,
 * and accurate by narrowing it until it only catches the obvious ones.
 */

function bandFlux(
	mag: Float32Array,
	frames: number,
	bands: number,
	centreHz: Float32Array,
	loHz: number,
	hiHz: number,
	lag: number,
	maxFilterBands = 0
): Float32Array {
	let lo = 0;
	let hi = bands;
	while (lo < bands && centreHz[lo] < loHz) lo++;
	while (hi > lo && centreHz[hi - 1] > hiHz) hi--;
	if (hi <= lo) hi = Math.min(bands, lo + 1);

	const out = new Float32Array(frames);
	for (let f = lag; f < frames; f++) {
		let acc = 0;
		for (let b = lo; b < hi; b++) {
			const cur = Math.log10(1 + mag[f * bands + b]);
			let prev = 0;
			const from = Math.max(lo, b - maxFilterBands);
			const to = Math.min(hi - 1, b + maxFilterBands);
			for (let k = from; k <= to; k++) {
				const v = Math.log10(1 + mag[(f - lag) * bands + k]);
				if (v > prev) prev = v;
			}
			if (cur > prev) acc += cur - prev;
		}
		out[f] = acc;
	}
	return out;
}

function normaliseCurve(curve: Float32Array): Float32Array {
	const sorted = Float32Array.from(curve).sort();
	const top = sorted[Math.floor(sorted.length * 0.995)] || 1;
	const out = new Float32Array(curve.length);
	for (let i = 0; i < curve.length; i++) out[i] = curve[i] / top;
	return out;
}

interface Variant {
	name: string;
	build(perc: Float32Array, spec: Spectrogram): Float32Array;
	gap?(beatPeriod: number): number;
	/** Rewrites peak times, given the curve, its frame indices and the broadband odf. */
	place?(curve: Float32Array, frames: number[], fps: number, odf: Float32Array): number[];
}

/**
 * Walk back from the flux peak to where the rise began.
 *
 * A 93 ms analysis window cannot localise a 50 Hz event: the low band's energy keeps climbing
 * for most of a window after the stick hits, so the flux maximum is tens of milliseconds late
 * however clean the detection is. The foot of the rise is where the drum was actually struck.
 */
function backtrack(curve: Float32Array, frames: number[], fps: number, fraction: number): number[] {
	return frames.map((p) => {
		const target = curve[p] * fraction;
		let i = p;
		while (i > 0 && curve[i - 1] < curve[i] && curve[i] > target) i--;
		return refinePeakTime(curve, p, fps) - (p - i) / fps;
	});
}

/** Snap to the nearest broadband onset, which is punctual where a low-band flux is not. */
function snapToOdf(
	curve: Float32Array,
	frames: number[],
	fps: number,
	odf: Float32Array,
	radiusSec: number
): number[] {
	const radius = Math.max(1, Math.round(radiusSec * fps));
	return frames.map((p) => {
		let best = -1;
		let bestV = 0;
		for (let i = Math.max(1, p - radius); i <= Math.min(odf.length - 2, p + radius); i++) {
			if (odf[i] >= odf[i - 1] && odf[i] >= odf[i + 1] && odf[i] > bestV) {
				bestV = odf[i];
				best = i;
			}
		}
		return best >= 0 ? refinePeakTime(odf, best, fps) : refinePeakTime(curve, p, fps);
	});
}

const flux =
	(perc: Float32Array, spec: Spectrogram) =>
	(lo: number, hi: number, lag = 2, mf = 0) =>
		normaliseCurve(bandFlux(perc, spec.frames, spec.bands, spec.centreHz, lo, hi, lag, mf));

const sub = (a: Float32Array, b: Float32Array, w: number) => {
	const out = new Float32Array(a.length);
	for (let f = 0; f < a.length; f++) out[f] = Math.max(0, a[f] - w * b[f]);
	return out;
};

const current = (p: Float32Array, s: Spectrogram) => {
	const g = flux(p, s);
	return sub(g(20, 90), g(110, 260), 0.8);
};

const VARIANTS: Variant[] = [
	{ name: 'current', build: current },
	{ name: 'current, lag 1', build: (p, s) => { const g = flux(p, s); return sub(g(20, 90, 1), g(110, 260, 1), 0.8); } },
	{ name: 'no bass subtraction', build: (p, s) => flux(p, s)(20, 90) },
	{ name: 'backtrack 0.7', build: current, place: (c, f, fps) => backtrack(c, f, fps, 0.7) },
	{ name: 'backtrack 0.5', build: current, place: (c, f, fps) => backtrack(c, f, fps, 0.5) },
	{ name: 'backtrack 0.3', build: current, place: (c, f, fps) => backtrack(c, f, fps, 0.3) },
	{ name: 'backtrack 0.15', build: current, place: (c, f, fps) => backtrack(c, f, fps, 0.15) },
	{ name: 'snap to odf 30 ms', build: current, place: (c, f, fps, o) => snapToOdf(c, f, fps, o, 0.03) },
	{ name: 'snap to odf 50 ms', build: current, place: (c, f, fps, o) => snapToOdf(c, f, fps, o, 0.05) },
	{ name: 'snap to odf 80 ms', build: current, place: (c, f, fps, o) => snapToOdf(c, f, fps, o, 0.08) }
];

const CACHE = new URL('../cache/', import.meta.url).pathname;
const ids = [
	...new Set(
		readdirSync(CACHE)
			.filter((f) => f.endsWith('.m4a'))
			.map((f) => f.replace('.m4a', ''))
	)
].sort();

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

const peaks = (v: Variant, curve: Float32Array, fps: number, gap: number, odf: Float32Array) => {
	const frames = pickPeaks(curve, fps, {
		localMaxSec: 0.03,
		movingMeanSec: 0.1,
		delta: 0.06,
		refractorySec: gap
	}).map((p) => p.frame);
	return v.place
		? v.place(curve, frames, fps, odf)
		: frames.map((f) => refinePeakTime(curve, f, fps));
};

/** Mean signed error of matched estimates against exact times, seconds; positive means late. */
function signedError(truth: readonly number[], est: readonly number[], tol: number): number {
	let acc = 0;
	let n = 0;
	for (const r of truth) {
		let best = Infinity;
		for (const e of est) if (Math.abs(e - r) < Math.abs(best)) best = e - r;
		if (Math.abs(best) <= tol) {
			acc += best;
			n++;
		}
	}
	return n > 0 ? acc / n : 0;
}

// --- fixture accuracy -----------------------------------------------------------------------
const fixture = synthesise();
const fixMono = Float32Array.from(fixture.mono);
{
	const loud = measureLoudness(fixture.mono, fixture.sampleRate);
	const gain = Math.pow(10, (-14 - loud.integrated) / 20);
	if (Number.isFinite(gain)) {
		const g = Math.min(gain, 40);
		for (let i = 0; i < fixMono.length; i++) fixMono[i] *= g;
	}
}
const fixFeat = extractFeatures(fixMono, fixture.sampleRate);
const fixGrid = detectBeats(fixFeat.odf, fixFeat.curves.fps, fixture.duration, {});
const fixPerc = separate(fixFeat.spec.mag, fixFeat.spec.frames, fixFeat.spec.bands).percussive;

// --- real tracks ----------------------------------------------------------------------------
interface Track {
	perc: Float32Array;
	spec: Spectrogram;
	beats: Float64Array;
	beatPeriod: number;
	odf: Float32Array;
}
const tracks: Track[] = [];
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
	tracks.push({
		perc: separate(f.spec.mag, f.spec.frames, f.spec.bands).percussive,
		spec: f.spec,
		beats: grid.beats,
		beatPeriod: grid.beatPeriod,
		odf: f.odf
	});
}
process.stderr.write(`${tracks.length} tracks loaded\n`);

const median = (xs: number[]) => {
	if (!xs.length) return 0;
	const s = [...xs].sort((a, b) => a - b);
	return s[s.length >> 1];
};

const report = (name: string, cacheTimes: number[][], fixTimes: number[]) => {
	const all: number[] = [];
	let count = 0;
	for (const [i, times] of cacheTimes.entries()) {
		count += times.length;
		all.push(...offsets(times, tracks[i].beats));
	}
	const m = fMeasure(fixture.kick, fixTimes, 0.05);
	console.log(
		`${name.padEnd(24)}${((all.reduce((a, b) => a + b, 0) / all.length) * 1000).toFixed(1).padStart(9)}${(median(all) * 1000).toFixed(1).padStart(8)}${(count / tracks.length).toFixed(0).padStart(7)}${(signedError(fixture.kick, fixTimes, 0.05) * 1000).toFixed(1).padStart(11)}${m.f.toFixed(3).padStart(8)}${m.precision.toFixed(3).padStart(7)}${m.recall.toFixed(3).padStart(7)}`
	);
};

console.log(
	`${'variant'.padEnd(24)}${'cache ms'.padStart(9)}${'median'.padStart(8)}${'n/trk'.padStart(7)}${'fixture ms'.padStart(11)}${'F'.padStart(8)}${'prec'.padStart(7)}${'rec'.padStart(7)}`
);
for (const v of VARIANTS) {
	const cacheTimes = tracks.map((t) =>
		peaks(v, v.build(t.perc, t.spec), t.spec.fps, v.gap ? v.gap(t.beatPeriod) : Math.max(0.07, t.beatPeriod * 0.4), t.odf)
	);
	const fixGap = v.gap ? v.gap(fixGrid.beatPeriod) : Math.max(0.07, fixGrid.beatPeriod * 0.4);
	const fixTimes = peaks(v, v.build(fixPerc, fixFeat.spec), fixFeat.spec.fps, fixGap, fixFeat.odf);
	report(v.name, cacheTimes, fixTimes);
}

// The shipped detector, through its own entry point, as the control.
report(
	'detectDrums() shipped',
	tracks.map((t) => detectDrums(t.spec, { beatPeriod: t.beatPeriod, odf: t.odf }).kick),
	detectDrums(fixFeat.spec, { beatPeriod: fixGrid.beatPeriod, odf: fixFeat.odf }).kick
);
