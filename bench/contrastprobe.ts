import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
	DEFAULT_ROOM,
	EffectRegistry,
	Mixer,
	ShowPlayer,
	buildGeometry,
	type TrackAnalysis
} from '@mv/core';
import { composeShow } from '@mv/author-engine';

/**
 * Authored contrast against delivered contrast, over the whole corpus.
 *
 * The show is composed with an eight-to-one ratio between its drop and its breakdown and the
 * room receives two-to-one, so the single loudest structural gesture a show has is compressed
 * away between the mixer and the wall. `--raw` reports what the mixer produces before the
 * output chain, which is the authored figure; the default reports the bytes the LEDs receive.
 *
 * Printed as `name<tab>value` so `tune.ts` can sweep against it.
 */
const CACHE = join(import.meta.dirname, '..', 'cache');
const fps = 30;

const ids = [
	...new Set(
		readdirSync(CACHE)
			.filter((f) => f.endsWith('.analysis.json'))
			.map((f) => f.replace('.analysis.json', ''))
	)
].sort();

const geometry = buildGeometry(DEFAULT_ROOM);
const loudKinds = new Set(['drop']);
const quietKinds = new Set(['breakdown', 'intro', 'outro']);

let loudOut = 0;
let loudOutN = 0;
let quietOut = 0;
let quietOutN = 0;
let limited = 0;
let frames = 0;
const perTrack: number[] = [];
const darkest: number[] = [];

for (const id of ids) {
	const analysis = JSON.parse(
		readFileSync(join(CACHE, `${id}.analysis.json`), 'utf8')
	) as TrackAnalysis;
	// Composed here rather than read from the cache, so a sweep of the engine's own constants
	// changes what is measured instead of measuring yesterday's show.
	const show = composeShow(analysis);

	const mixer = new Mixer(geometry);
	const player = new ShowPlayer(mixer, new EffectRegistry());
	player.load(analysis, show);
	player.reset();

	let lo = 0;
	let lon = 0;
	let qo = 0;
	let qon = 0;
	// Tracked per section as well, because a corpus mean hides the one passage that is black.
	const perSection = new Map<number, { sum: number; n: number }>();

	const dt = 1 / fps;
	for (let t = 0; t < analysis.duration; t += dt) {
		const f = player.update(t, dt);
		mixer.render(f);

		// The bytes the LEDs receive, undone through gamma so a ratio means what it says.
		let out = 0;
		for (let i = 0; i < mixer.bytes.length; i += 3) {
			out += Math.max(mixer.bytes[i], mixer.bytes[i + 1], mixer.bytes[i + 2]);
		}
		out = Math.pow(out / (mixer.bytes.length / 3) / 255, 1 / 2.2);

		frames++;
		if (mixer.meanHeadroom < 0.999) limited++;

		if (loudKinds.has(f.section)) {
			lo += out;
			lon++;
		} else if (quietKinds.has(f.section)) {
			qo += out;
			qon++;
		}
		if (quietKinds.has(f.section)) {
			const cell = perSection.get(f.barIndex - (f.barIndex % 4)) ?? { sum: 0, n: 0 };
			cell.sum += out;
			cell.n++;
			perSection.set(f.barIndex - (f.barIndex % 4), cell);
		}
	}

	if (lon === 0 || qon === 0) continue;
	loudOut += lo;
	loudOutN += lon;
	quietOut += qo;
	quietOutN += qon;
	const delivered = qo / qon > 1e-6 ? lo / lon / (qo / qon) : 0;
	perTrack.push(delivered);
	for (const cell of perSection.values()) if (cell.n > 30) darkest.push(cell.sum / cell.n);
}

const delivered = quietOut / quietOutN > 1e-6 ? loudOut / loudOutN / (quietOut / quietOutN) : 0;
const emit = (name: string, value: number, digits = 2) =>
	console.log(`${name}\t${value.toFixed(digits)}`);

emit('delivered ratio', delivered);
emit('drop level', loudOut / loudOutN, 3);
emit('quiet level', quietOut / quietOutN, 3);
darkest.sort((a, b) => a - b);
emit('darkest quiet', darkest[0] ?? 0, 3);
emit('p10 quiet', darkest[Math.floor(darkest.length * 0.1)] ?? 0, 3);
emit('frames limited %', (100 * limited) / Math.max(1, frames), 1);
emit('tracks', perTrack.length, 0);
