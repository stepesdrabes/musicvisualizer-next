import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
	DEFAULT_ROOM,
	EffectRegistry,
	Mixer,
	ShowPlayer,
	buildGeometry,
	type SectionKind,
	type TrackAnalysis
} from '@mv/core';
import { composeShow } from '@mv/author-engine';

/**
 * What each section kind actually delivers to the LEDs, in bytes.
 *
 * Bytes, not the authoring domain, because that is the only number that says whether a passage
 * is visible: gamma 2.2 means an authoring value of 0.2 is byte 8 and 0.6 is byte 84, so a
 * ratio that looks modest upstream is the difference between a lit room and a dark one.
 *
 * `lit` is the share of LEDs above byte 8, which is roughly where a pixel stops reading as off
 * in a dark room. A passage can average a respectable byte and still be invisible if all of it
 * is in a handful of pixels.
 *
 * `drift` is what `move` cannot say. `move` is a per-FRAME delta, so in a groove it is mostly
 * drum transients and in an intro, which has no drums by construction, it reads near zero however
 * alive the room looks. Slow movement at musical timescales is exactly what a quiet section is
 * supposed to have, and a frame-to-frame difference is blind to it: the same class of error as
 * judging shimmer by mean level. `drift` is each pixel's own spread around its half-second
 * average, so a field that travels across a phrase scores and a field that sits still does not.
 *
 * `move` and `shape` are what a level cannot say. `move` is how many bytes the average pixel
 * changes from frame to frame, so a wash that sits still scores near zero however bright it is;
 * `shape` is the spread across the room in the same frame, so a solid colour scores zero
 * whatever it is doing over time. "Plain colour with a little drift" is a passage with a
 * respectable mean byte and almost nothing in either column.
 */
const CACHE = join(import.meta.dirname, '..', 'cache');
const fps = 30;
const VISIBLE = 8;

const ids = [
	...new Set(
		readdirSync(CACHE)
			.filter((f) => f.endsWith('.analysis.json'))
			.map((f) => f.replace('.analysis.json', ''))
	)
].sort();

const geometry = buildGeometry(DEFAULT_ROOM);
interface Cell {
	sum: number;
	peak: number;
	lit: number;
	move: number;
	shape: number;
	drift: number;
	hue: number;
	n: number;
}
const stats = new Map<SectionKind, Cell>();
const previous = new Uint8Array(geometry.count);

for (const id of ids) {
	const analysis = JSON.parse(
		readFileSync(join(CACHE, `${id}.analysis.json`), 'utf8')
	) as TrackAnalysis;
	const mixer = new Mixer(geometry);
	const player = new ShowPlayer(mixer, new EffectRegistry());
	player.load(analysis, composeShow(analysis));
	player.reset();

	const dt = 1 / fps;
	previous.fill(0);
	let first = true;
	// A half-second running mean per pixel. Subtracting it leaves what moved over a phrase and
	// removes both the standing level and the frame-rate shimmer flickerprobe already reports.
	const smoothed = new Float32Array(previous.length);
	// The same half-second reference over all three channels. `drift` is the max channel and so
	// is blind to a hue rotation at constant luminance, which is exactly what a colour-led bed
	// does: spectrumBed writes one gain to every pixel and moves only the slot.
	const smoothedRgb = new Float32Array(mixer.bytes.length);
	const tau = 0.5;
	for (let t = 0; t < analysis.duration; t += dt) {
		const f = player.update(t, dt);
		mixer.render(f);
		let sum = 0;
		let peak = 0;
		let lit = 0;
		let move = 0;
		const n = mixer.bytes.length / 3;
		for (let k = 0; k < n; k++) {
			const i = k * 3;
			const v = Math.max(mixer.bytes[i], mixer.bytes[i + 1], mixer.bytes[i + 2]);
			sum += v;
			if (v > peak) peak = v;
			if (v >= VISIBLE) lit++;
			if (!first) move += Math.abs(v - previous[k]);
			previous[k] = v;
		}
		const mean = sum / n;
		let shape = 0;
		for (let k = 0; k < n; k++) shape += Math.abs(previous[k] - mean);

		const a = 1 - Math.exp(-dt / tau);
		let drift = 0;
		for (let k = 0; k < n; k++) {
			if (first) smoothed[k] = previous[k];
			else smoothed[k] += (previous[k] - smoothed[k]) * a;
			drift += Math.abs(previous[k] - smoothed[k]);
		}
		let hue = 0;
		for (let c = 0; c < mixer.bytes.length; c++) {
			if (first) smoothedRgb[c] = mixer.bytes[c];
			else smoothedRgb[c] += (mixer.bytes[c] - smoothedRgb[c]) * a;
			hue += Math.abs(mixer.bytes[c] - smoothedRgb[c]);
		}

		const cell = stats.get(f.section) ?? { sum: 0, peak: 0, lit: 0, move: 0, shape: 0, drift: 0, hue: 0, n: 0 };
		cell.sum += mean;
		cell.peak += peak;
		cell.lit += lit / n;
		cell.move += first ? 0 : move / n;
		cell.shape += shape / n;
		cell.drift += first ? 0 : drift / n;
		cell.hue += first ? 0 : hue / n;
		cell.n++;
		stats.set(f.section, cell);
		first = false;
	}
}

const ORDER: SectionKind[] = ['void', 'intro', 'outro', 'breakdown', 'build', 'groove', 'drop'];
console.log(
	`${'section'.padEnd(12)}${'mean byte'.padStart(11)}${'peak byte'.padStart(11)}${'lit %'.padStart(8)}${'move'.padStart(8)}${'shape'.padStart(8)}${'drift'.padStart(8)}${'colour'.padStart(8)}`
);
for (const kind of ORDER) {
	const c = stats.get(kind);
	if (!c || c.n === 0) continue;
	console.log(
		`${kind.padEnd(12)}${(c.sum / c.n).toFixed(1).padStart(11)}${(c.peak / c.n).toFixed(0).padStart(11)}${((100 * c.lit) / c.n).toFixed(0).padStart(8)}${(c.move / c.n).toFixed(2).padStart(8)}${(c.shape / c.n).toFixed(1).padStart(8)}${(c.drift / c.n).toFixed(2).padStart(8)}${(c.hue / c.n).toFixed(2).padStart(8)}`
	);
}
const quietMove = (['intro', 'outro', 'breakdown'] as const).reduce(
	(acc, k) => {
		const c = stats.get(k);
		return c
			? {
					move: acc.move + c.move,
					shape: acc.shape + c.shape,
					drift: acc.drift + c.drift,
					hue: acc.hue + c.hue,
					n: acc.n + c.n
				}
			: acc;
	},
	{ move: 0, shape: 0, drift: 0, hue: 0, n: 0 }
);

const quiet = ['intro', 'outro', 'breakdown'] as const;
const pick = (kinds: readonly SectionKind[]) => {
	let sum = 0;
	let n = 0;
	for (const k of kinds) {
		const c = stats.get(k);
		if (c) {
			sum += c.sum;
			n += c.n;
		}
	}
	return n > 0 ? sum / n : 0;
};
console.log(`\nquiet\t${pick(quiet).toFixed(1)}`);
console.log(`drop\t${pick(['drop']).toFixed(1)}`);
console.log(`ratio\t${(pick(['drop']) / Math.max(1e-6, pick(quiet))).toFixed(2)}`);
console.log(`quiet move\t${(quietMove.move / Math.max(1, quietMove.n)).toFixed(2)}`);
console.log(`quiet shape\t${(quietMove.shape / Math.max(1, quietMove.n)).toFixed(1)}`);
console.log(`quiet drift\t${(quietMove.drift / Math.max(1, quietMove.n)).toFixed(2)}`);
console.log(`quiet colour\t${(quietMove.hue / Math.max(1, quietMove.n)).toFixed(2)}`);
