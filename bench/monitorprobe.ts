import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
	DEFAULT_ROOM,
	EffectRegistry,
	Mixer,
	ShowPlayer,
	buildGeometry,
	compileGenerated,
	type Show,
	type TrackAnalysis
} from '@mv/core';

/**
 * What one LED would show if it had to stand in for the whole room.
 *
 * `firmware/src/leds.rs` drives a single RGB LED from the fixture stream, so the DDP path can
 * be judged before there are strips to judge it with. It has to derive both colour and pulse
 * from the frame alone, and the numbers that decision needs can only be read off finished
 * shows: how bright a frame is in the bytes that reach the wire, and how far that moves inside
 * a beat. Both are set by the mixer's exposure, floor and slew rather than by any one effect.
 *
 *   node bench/monitorprobe.ts [trackId ...]
 *
 * Everything here is in the firmware's own units, so the constants below are its constants.
 */

const CACHE = process.env.MV_CACHE_DIR ?? join(import.meta.dirname, '..', 'cache');
const FPS = 60;

/** `leds.rs`, both of them. */
const RELEASE_SHIFT = 11;
const LEVEL_FLOOR = 2040;

const ids = process.argv.slice(2);
if (ids.length === 0) {
	ids.push(
		'K0HSD_i2DvA', // Daft Punk, four to the floor
		'UtF6Jej8yb4', // Avicii, big drop
		'Y91m7qbTj-k', // Ian Asher, dance edit
		'86URGgqONvA', // Iron Maiden, no drop in it at all
		'NdYWuo9OFAw', // Goo Goo Dolls, ballad
		'PmJuMNGp5YE' // Gracie Abrams, quiet throughout
	);
}

/**
 * Candidate summaries of one frame, each a mean over pixels of max(r,g,b) raised to a power.
 * A single LED cannot show light moving across a room, so everything a show says at constant
 * flux is lost to it either way; what separates these is how much of the beat survives.
 */
const SUMMARIES = { mean: 1, 'mean sq': 2, 'mean 4th': 4 } as const;
type Summary = keyof typeof SUMMARIES;

interface Row {
	title: string;
	bpm: number;
	levels: Record<Summary, number[]>;
	/** Saturation of the frame's mean colour, which is the hue the LED would show. */
	sat: number[];
}

function pct(sorted: number[], p: number): number {
	if (sorted.length === 0) return 0;
	return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

const sorted = (xs: number[]): number[] => [...xs].sort((a, b) => a - b);

/** The follower in `leds.rs`: instant attack, and a release slow enough to leave a drop a drop. */
function follow(levels: number[], shift = RELEASE_SHIFT, floor = LEVEL_FLOOR): number[] {
	let peak = 0;
	return levels.map((l) => {
		if (l > peak) peak = l;
		else peak = Math.max(0, peak - Math.max(peak / 2 ** shift, 1));
		return l / Math.max(peak, floor);
	});
}

/** Peak to trough inside one beat, which is the unit the LED is meant to pulse on. */
function beatSwing(levels: number[], bpm: number): number[] {
	const beat = Math.max(2, Math.round((60 / bpm) * FPS));
	const out: number[] = [];
	for (let i = 0; i + beat <= levels.length; i += beat) {
		let lo = Infinity;
		let hi = 0;
		for (let k = i; k < i + beat; k++) {
			if (levels[k] < lo) lo = levels[k];
			if (levels[k] > hi) hi = levels[k];
		}
		if (hi > 0) out.push(1 - lo / hi);
	}
	return out;
}

/** The eye's response to a duty cycle, which is the inverse of the gamma the host encoded with. */
const seen = (duty: number): number => duty ** (1 / 2.2);

const rows: Row[] = [];

for (const id of ids) {
	const aPath = join(CACHE, `${id}.analysis.json`);
	const sPath = join(CACHE, `${id}.show.json`);
	if (!existsSync(aPath) || !existsSync(sPath)) {
		console.error(`skip ${id}: not cached`);
		continue;
	}

	const analysis = JSON.parse(readFileSync(aPath, 'utf8')) as TrackAnalysis;
	const show = JSON.parse(readFileSync(sPath, 'utf8')) as Show;
	const metaPath = join(CACHE, `${id}.meta.json`);
	const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf8')) : {};

	const geometry = buildGeometry(DEFAULT_ROOM);
	const mixer = new Mixer(geometry);
	const registry = new EffectRegistry();
	for (const gen of show.generatedEffects ?? []) {
		const compiled = compileGenerated(gen, geometry);
		if (compiled.def) registry.add(compiled.def);
	}
	const player = new ShowPlayer(mixer, registry);
	player.load(analysis, show);

	const dt = 1 / FPS;
	const frames = Math.floor(analysis.duration * FPS);
	const levels = { mean: [] as number[], 'mean sq': [] as number[], 'mean 4th': [] as number[] };
	const sat: number[] = [];

	for (let i = 0; i < frames; i++) {
		mixer.render(player.update(i * dt, dt));
		const b = mixer.bytes;
		let sr = 0;
		let sg = 0;
		let sb = 0;
		let s1 = 0;
		let s2 = 0;
		let s4 = 0;
		for (let o = 0; o < b.length; o += 3) {
			const r = b[o];
			const g = b[o + 1];
			const bl = b[o + 2];
			sr += r;
			sg += g;
			sb += bl;
			const m = r > g ? (r > bl ? r : bl) : g > bl ? g : bl;
			s1 += m;
			s2 += m * m;
			s4 += m * m * m * m;
		}
		const px = b.length / 3;
		levels['mean'].push(s1 / px);
		levels['mean sq'].push(s2 / px);
		levels['mean 4th'].push(s4 / px);
		const hi = Math.max(sr, sg, sb);
		sat.push(hi > 0 ? 1 - Math.min(sr, sg, sb) / hi : 0);
	}

	rows.push({ title: (meta.title ?? id).slice(0, 28), bpm: analysis.tempo.bpm, levels, sat });
}

const pool = (f: (r: Row) => number[]): number[] => sorted(rows.flatMap(f));

console.log('mean over 1320 px of max(r,g,b), in the bytes that reach the wire\n');
console.log('track                            p05   p50   p95   max   mean sat   beat swing');
for (const r of rows) {
	const s = sorted(r.levels['mean']);
	console.log(
		r.title.padEnd(30) +
			[pct(s, 0.05), pct(s, 0.5), pct(s, 0.95), s[s.length - 1]]
				.map((v) => v.toFixed(1).padStart(6))
				.join('') +
			pct(sorted(r.sat), 0.5).toFixed(2).padStart(11) +
			pct(sorted(beatSwing(r.levels['mean'], r.bpm)), 0.5).toFixed(2).padStart(13)
	);
}

console.log('\nWhy the summary is squared. Median swing inside one beat, per exponent:');
console.log('summary     ' + rows.map((r) => r.title.slice(0, 9).padStart(10)).join(''));
for (const k of Object.keys(SUMMARIES) as Summary[]) {
	console.log(
		k.padEnd(12) +
			rows
				.map((r) => pct(sorted(beatSwing(r.levels[k], r.bpm)), 0.5).toFixed(2).padStart(10))
				.join('')
	);
}

/**
 * The two things a monitor LED has to be at once, pulling opposite ways: bright enough that its
 * colour is readable, and swinging enough that the beat is visible in it. `duty = ratio ** g`.
 */
console.log('\nSummary against output curve, pooled over every frame of every track:');
console.log('summary       g   perceived p05    p50   per-beat dip   frames under 0.05');
for (const k of Object.keys(SUMMARIES) as Summary[]) {
	for (const g of [0.5, 1.0, 1.5, 2.0]) {
		const duty = rows.map((r) => follow(r.levels[k]).map((v) => v ** g));
		const eye = sorted(duty.flat().map(seen));
		const dips = sorted(duty.flatMap((d, i) => beatSwing(d.map(seen), rows[i].bpm)));
		console.log(
			k.padEnd(11) +
				g.toFixed(1).padStart(4) +
				[pct(eye, 0.05), pct(eye, 0.5)].map((v) => v.toFixed(2).padStart(11)).join('') +
				pct(dips, 0.5).toFixed(2).padStart(15) +
				`${(100 * (eye.filter((v) => v < 0.05).length / eye.length)).toFixed(1)}%`.padStart(19)
		);
	}
}

console.log(`\nRelease, on the chosen summary. Shift ${RELEASE_SHIFT} is what leds.rs uses.`);
console.log('shift  half-life   perceived p05   p50   per-beat dip');
for (const shift of [9, 10, 11, 12, 13]) {
	const duty = rows.map((r) => follow(r.levels['mean sq'], shift).map((v) => v ** 1.5));
	const eye = sorted(duty.flat().map(seen));
	const dips = sorted(duty.flatMap((d, i) => beatSwing(d.map(seen), rows[i].bpm)));
	console.log(
		String(shift).padStart(5) +
			`${((2 ** shift * Math.LN2) / FPS).toFixed(1)} s`.padStart(11) +
			[pct(eye, 0.05), pct(eye, 0.5)].map((v) => v.toFixed(2).padStart(11)).join('') +
			pct(dips, 0.5).toFixed(2).padStart(15)
	);
}

console.log(`\nFloor, in mean-square bytes. leds.rs uses ${LEVEL_FLOOR}, every pixel at byte 45.`);
console.log('It barely binds on a finished show, and is there for the ones that go quiet.');
for (const floor of [255, 1020, 2040, 4080, 8160]) {
	const eye = sorted(
		rows.flatMap((r) => follow(r.levels['mean sq'], RELEASE_SHIFT, floor).map((v) => seen(v ** 1.5)))
	);
	console.log(
		`  floor ${String(floor).padStart(4)}   perceived p05 ${pct(eye, 0.05).toFixed(3)}   p50 ${pct(eye, 0.5).toFixed(2)}`
	);
}
