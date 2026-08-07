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

		const cell = stats.get(f.section) ?? { sum: 0, peak: 0, lit: 0, move: 0, shape: 0, n: 0 };
		cell.sum += mean;
		cell.peak += peak;
		cell.lit += lit / n;
		cell.move += first ? 0 : move / n;
		cell.shape += shape / n;
		cell.n++;
		stats.set(f.section, cell);
		first = false;
	}
}

const ORDER: SectionKind[] = ['void', 'intro', 'outro', 'breakdown', 'build', 'groove', 'drop'];
console.log(
	`${'section'.padEnd(12)}${'mean byte'.padStart(11)}${'peak byte'.padStart(11)}${'lit %'.padStart(8)}${'move'.padStart(8)}${'shape'.padStart(8)}`
);
for (const kind of ORDER) {
	const c = stats.get(kind);
	if (!c || c.n === 0) continue;
	console.log(
		`${kind.padEnd(12)}${(c.sum / c.n).toFixed(1).padStart(11)}${(c.peak / c.n).toFixed(0).padStart(11)}${((100 * c.lit) / c.n).toFixed(0).padStart(8)}${(c.move / c.n).toFixed(2).padStart(8)}${(c.shape / c.n).toFixed(1).padStart(8)}`
	);
}
const quietMove = (['intro', 'outro', 'breakdown'] as const).reduce(
	(acc, k) => {
		const c = stats.get(k);
		return c ? { move: acc.move + c.move, shape: acc.shape + c.shape, n: acc.n + c.n } : acc;
	},
	{ move: 0, shape: 0, n: 0 }
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
