import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
	DEFAULT_ROOM,
	EffectRegistry,
	Mixer,
	ShowPlayer,
	buildGeometry,
	type Show,
	type TrackAnalysis
} from '@mv/core';

/**
 * How much of what the room emits is a colour the show declared.
 *
 * The complaint this answers is that the biggest moment of every track is lit by an effect
 * calling `hsv2rgb` with hues of its own. Measured on the pixels the LEDs actually receive, so
 * it counts what reaches the wall rather than what the code intends.
 *
 *   node bench/colourprobe.ts [--seconds 6]
 */
const CACHE = join(import.meta.dirname, '..', 'cache');
const argv = process.argv.slice(2);
const flag = (n: string, d: number) => {
	const i = argv.indexOf(`--${n}`);
	return i >= 0 ? Number(argv[i + 1]) : d;
};
const seconds = flag('seconds', 6);
const fps = 30;
/** Degrees a pixel's hue may sit from a declared one and still count as on-palette. */
const TOLERANCE = 22;

function hueOf(r: number, g: number, b: number): number {
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const d = max - min;
	if (d < 1e-6) return -1;
	let h: number;
	if (max === r) h = ((g - b) / d) % 6;
	else if (max === g) h = (b - r) / d + 2;
	else h = (r - g) / d + 4;
	return ((h * 60) % 360 + 360) % 360;
}

const arc = (a: number, b: number) => {
	const d = Math.abs(((a - b) % 360) + 360) % 360;
	return Math.min(d, 360 - d);
};

const ids = [
	...new Set(
		readdirSync(CACHE)
			.filter((f) => f.endsWith('.show.json'))
			.map((f) => f.replace('.show.json', ''))
	)
].sort();

const geometry = buildGeometry(DEFAULT_ROOM);
let onTotal = 0;
let litTotal = 0;
let greyTotal = 0;

console.log(`${'track'.padEnd(22)}${'peak look'.padEnd(16)}${'on-palette'.padStart(11)}${'near-white'.padStart(12)}`);
for (const id of ids) {
	const analysis = JSON.parse(
		readFileSync(join(CACHE, `${id}.analysis.json`), 'utf8')
	) as TrackAnalysis;
	const show = JSON.parse(readFileSync(join(CACHE, `${id}.show.json`), 'utf8')) as Show;

	const peak = analysis.sections.find((s) => s.energyRank === 1);
	const from = peak?.startTime ?? 30;
	const mixer = new Mixer(geometry);
	const player = new ShowPlayer(mixer, new EffectRegistry());
	player.load(analysis, show);
	player.reset();
	const dt = 1 / fps;
	for (let t = 0; t < from; t += dt) player.update(t, dt);

	let on = 0;
	let lit = 0;
	let grey = 0;
	const anchorHues: number[] = [];
	for (let i = 0; i < seconds * fps; i++) {
		const t = from + i * dt;
		mixer.render(player.update(t, dt));

		// The palette the effects were handed this frame, already cross-faded. Every colour an
		// effect that addresses by slot can emit is a sample of this ring, so a hue that is not
		// on it is one the effect chose for itself.
		anchorHues.length = 0;
		for (let a = 0; a < mixer.palette.length; a += 3) {
			const h = hueOf(mixer.palette[a], mixer.palette[a + 1], mixer.palette[a + 2]);
			if (h >= 0) anchorHues.push(h);
		}

		const bytes = mixer.bytes;
		for (let k = 0; k < geometry.count; k++) {
			const o = k * 3;
			const r = bytes[o];
			const g = bytes[o + 1];
			const b = bytes[o + 2];
			if (r + g + b < 24) continue;
			lit++;
			const max = Math.max(r, g, b);
			const sat = max > 0 ? (max - Math.min(r, g, b)) / max : 0;
			// A near-white pixel has no hue to be wrong about, and every palette has a white slot.
			if (sat < 0.2) {
				grey++;
				on++;
				continue;
			}
			const h = hueOf(r, g, b);
			if (h >= 0 && anchorHues.some((x) => arc(h, x) <= TOLERANCE)) on++;
		}
	}

	const cue = show.cues.find((c) => c.bar >= (peak?.startBar ?? 0));
	const look = cue?.layers.master?.effect ?? cue?.layers.accent?.effect ?? cue?.layers.bed?.effect ?? '-';
	onTotal += on;
	litTotal += lit;
	greyTotal += grey;
	console.log(
		`${id.padEnd(22)}${look.padEnd(16)}${((100 * on) / Math.max(1, lit)).toFixed(1).padStart(10)}%${((100 * grey) / Math.max(1, lit)).toFixed(1).padStart(11)}%`
	);
}

console.log(
	`\ncorpus: ${((100 * onTotal) / Math.max(1, litTotal)).toFixed(1)}% of lit pixels on a declared hue (${((100 * greyTotal) / Math.max(1, litTotal)).toFixed(1)}% near-white)`
);
