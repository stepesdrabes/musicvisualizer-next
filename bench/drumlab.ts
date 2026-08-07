import { readdirSync } from 'node:fs';
import { decodeAudio } from '@mv/analysis';
import { extractFeatures } from '../packages/analysis/src/features.ts';
import { detectBeats } from '../packages/analysis/src/beats.ts';
import { detectDrums } from '../packages/analysis/src/drums.ts';
import { measureLoudness } from '../packages/analysis/src/loudness.ts';
import { fMeasure, synthesise, type Stage } from '../packages/analysis/src/fixture.ts';

/**
 * One scorecard for the drum detector, printed as `name<tab>value` so `tune.ts` can sweep
 * against it.
 *
 * Four things at once, because every constant here trades them against each other: accuracy on
 * material with exact ground truth, whether a sixteenth roll is resolvable at all, how punctual
 * the stream is against the beat grid, and how many hits come out of real tracks.
 */

const CACHE = new URL('../cache/', import.meta.url).pathname;
const ids = [
	...new Set(
		readdirSync(CACHE)
			.filter((f) => f.endsWith('.m4a'))
			.map((f) => f.replace('.m4a', ''))
	)
].sort();

const normalised = (mono: Float32Array, sampleRate: number) => {
	const out = Float32Array.from(mono);
	const loud = measureLoudness(mono, sampleRate);
	const gain = Math.pow(10, (-14 - loud.integrated) / 20);
	if (Number.isFinite(gain)) {
		const g = Math.min(gain, 40);
		for (let i = 0; i < out.length; i++) out[i] *= g;
	}
	return out;
};

const analyse = (mono: Float32Array, sampleRate: number, duration: number) => {
	const f = extractFeatures(normalised(mono, sampleRate), sampleRate);
	const grid = detectBeats(f.odf, f.curves.fps, duration, {});
	return { f, grid, drums: detectDrums(f.spec, { beatPeriod: grid.beatPeriod, odf: f.odf }) };
};

function offsetMedian(times: readonly number[], beats: Float64Array): number {
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
		out.push(t - (beats[lo] + step * Math.round((t - beats[lo]) / step)));
	}
	if (!out.length) return 0;
	out.sort((a, b) => a - b);
	return out[out.length >> 1] * 1000;
}

// --- the arrangement fixture, exact ground truth ---------------------------------------------
const fixture = synthesise();
const fx = analyse(fixture.mono, fixture.sampleRate, fixture.duration);
const kickF = fMeasure(fixture.kick, fx.drums.kick.times, 0.05);
const snareF = fMeasure(fixture.snare, fx.drums.snare.times, 0.05);
const hatF = fMeasure(fixture.hat, fx.drums.hat.times, 0.05);

// --- a sixteenth-note kick roll, which the refractory gap decides ----------------------------
/** Kicks on every sixteenth for eight bars, over a quiet pad so the grid still tracks. */
function roll(bpm: number): { mono: Float32Array; sampleRate: number; duration: number; kick: number[] } {
	const sampleRate = 22050;
	const beat = 60 / bpm;
	const sixteenth = beat / 4;
	const duration = beat * 4 * 16;
	const mono = new Float32Array(Math.ceil(duration * sampleRate));
	const kick: number[] = [];
	for (let t = 0; t + 0.2 < duration; t += sixteenth) {
		kick.push(t);
		const i0 = Math.floor(t * sampleRate);
		for (let i = 0; i < 0.14 * sampleRate && i0 + i < mono.length; i++) {
			const s = i / sampleRate;
			const f = 55 + 60 * Math.exp(-s * 40);
			mono[i0 + i] += Math.sin(2 * Math.PI * f * s) * Math.min(1, s / 0.002) * Math.exp(-s * 30);
		}
	}
	for (let i = 0; i < mono.length; i++) {
		const t = i / sampleRate;
		mono[i] = Math.max(-1, Math.min(1, mono[i] + Math.sin(2 * Math.PI * 440 * t) * 0.05));
	}
	return { mono, sampleRate, duration, kick };
}

const rolls = [120, 175].map((bpm) => {
	const r = roll(bpm);
	const a = analyse(r.mono, r.sampleRate, r.duration);
	const m = fMeasure(r.kick, a.drums.kick.times, 0.04);
	return { bpm, recall: m.recall, precision: m.precision };
});

/**
 * How concentrated the kicks are on the sixteenth grid: the share landing in the busiest four
 * of sixteen slots. Four to the floor is 1.0 and an even spread is 0.25, which is the shape a
 * detector firing on everything produces and which reads in the room as a strobe.
 */
function slotConcentration(times: readonly number[], beats: Float64Array, beatsPerBar = 4): number {
	const slots = new Float64Array(beatsPerBar * 4);
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
		const within = Math.round(((t - beats[lo]) / span) * 4);
		slots[((lo % beatsPerBar) * 4 + within) % slots.length]++;
	}
	const total = slots.reduce((a, b) => a + b, 0);
	if (total === 0) return 0;
	const sorted = [...slots].sort((a, b) => b - a);
	return (sorted[0] + sorted[1] + sorted[2] + sorted[3]) / total;
}

// --- real tracks ------------------------------------------------------------------------------
let kicks = 0;
let snares = 0;
let hats = 0;
const offsets: number[] = [];
const concentration: number[] = [];
for (const id of ids) {
	const audio = await decodeAudio(`${CACHE}${id}.m4a`);
	const a = analyse(audio.mono, audio.sampleRate, audio.duration);
	kicks += a.drums.kick.times.length;
	snares += a.drums.snare.times.length;
	hats += a.drums.hat.times.length;
	offsets.push(offsetMedian(a.drums.kick.times, a.grid.beats));
	concentration.push(slotConcentration(a.drums.kick.times, a.grid.beats));
}
offsets.sort((x, y) => x - y);

const emit = (name: string, value: number, digits = 3) =>
	console.log(`${name}\t${value.toFixed(digits)}`);

emit('kick F', kickF.f);
emit('kick prec', kickF.precision);
emit('kick rec', kickF.recall);
emit('snare rec', snareF.recall);
emit('hat F', hatF.f);
for (const r of rolls) {
	emit(`roll${r.bpm} rec`, r.recall);
	emit(`roll${r.bpm} prec`, r.precision);
}
emit('kick concentr', concentration.reduce((a, b) => a + b, 0) / concentration.length);
emit('kick offset ms', offsets[offsets.length >> 1], 1);
emit('kicks/track', kicks / ids.length, 0);
emit('snares/track', snares / ids.length, 0);
emit('hats/track', hats / ids.length, 0);
