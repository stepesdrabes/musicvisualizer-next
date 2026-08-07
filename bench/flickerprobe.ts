import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
	BUILT_IN_EFFECTS,
	DEFAULT_ROOM,
	EffectRegistry,
	Mixer,
	ShowPlayer,
	buildGeometry,
	makePalette,
	type Show,
	type TrackAnalysis
} from '@mv/core';

/**
 * How much each effect SHIMMERS, driven by a real track rather than by the gate's smooth script.
 *
 * The complaint this exists to measure is that the room blinks, and no mean level or coverage
 * figure can see it. Frame-to-frame change cannot either: a swell moves every pixel every frame
 * and looks calm. What reads as blinking is change that REVERSES - up, down, up - so the metric
 * is the second difference of each pixel's brightness, which is zero for any straight ramp
 * however fast and large for jitter however small.
 *
 *   flicker   mean |v[t] - 2v[t-1] + v[t-2]| in bytes. Under about 1 reads as still; past 4 the
 *             room visibly shimmers at 60 fps.
 *   onbeat    of the frames where the room changes most, the share landing within 60 ms of a
 *             beat. A rhythmic effect scores high; one driven by spectrum noise scores chance.
 *   swing     the effect's own brightness range over the passage, so a still effect and a dead
 *             one can be told apart.
 *
 *   node bench/flickerprobe.ts [--track <id>] [--section intro] [--role bed]
 */
const CACHE = join(import.meta.dirname, '..', 'cache');
const argv = process.argv.slice(2);
const flag = (n: string) => {
	const i = argv.indexOf(`--${n}`);
	return i >= 0 ? argv[i + 1] : undefined;
};
const onlyRole = flag('role');
const want = flag('section') ?? 'intro';
const fps = 60;

const ids = readdirSync(CACHE)
	.filter((f) => f.endsWith('.analysis.json'))
	.map((f) => f.replace('.analysis.json', ''))
	.sort();
const trackId = flag('track') ?? ids[0];

const analysis = JSON.parse(
	readFileSync(join(CACHE, `${trackId}.analysis.json`), 'utf8')
) as TrackAnalysis;
const show = JSON.parse(readFileSync(join(CACHE, `${trackId}.show.json`), 'utf8')) as Show;
const g = buildGeometry(DEFAULT_ROOM);

/** Real frames from the player, so the spectrum, bands and grid are the track's own. */
const frames = [];
{
	const mixer = new Mixer(g);
	const player = new ShowPlayer(mixer, new EffectRegistry());
	player.load(analysis, show);
	player.reset();
	const dt = 1 / fps;
	for (let t = 0; t < analysis.duration; t += dt) {
		const f = player.update(t, dt);
		if (f.section !== want) continue;
		frames.push({
			...f,
			bands: Float32Array.from(f.bands),
			spectrum: Float32Array.from(f.spectrum)
		});
	}
}
if (frames.length < 8) {
	console.error(`${trackId} has no ${want} long enough to measure`);
	process.exit(1);
}

const beats = analysis.beats;
const nearBeat = (t: number) => beats.some((b) => Math.abs(b - t) <= 0.06);

const rows: { id: string; role: string; flicker: number; change: number; onbeat: number; swing: number }[] = [];

for (const def of BUILT_IN_EFFECTS) {
	if (onlyRole && def.role !== onlyRole) continue;
	if (def.role === 'master' || def.role === 'transient') continue;

	const mixer = new Mixer(g);
	mixer.palette = makePalette({ base: 204, accent: 14, third: 157, sat: 0.9, shade: 0.17 });
	mixer.intensity = 1;
	mixer.floor = 0;
	mixer.layers[def.role].setEffect(def, g);

	const n = g.count;
	let prev: Uint8Array | null = null;
	let prev2: Uint8Array | null = null;
	let accel = 0;
	let samples = 0;
	let lo = 255;
	let hi = 0;
	const change: { t: number; d: number }[] = [];

	for (const f of frames) {
		mixer.render(f);
		const now = new Uint8Array(n);
		let frameChange = 0;
		for (let k = 0; k < n; k++) {
			const i = k * 3;
			now[k] = Math.max(mixer.bytes[i], mixer.bytes[i + 1], mixer.bytes[i + 2]);
			if (now[k] < lo) lo = now[k];
			if (now[k] > hi) hi = now[k];
			if (prev) frameChange += Math.abs(now[k] - prev[k]);
			if (prev && prev2) {
				accel += Math.abs(now[k] - 2 * prev[k] + prev2[k]);
				samples++;
			}
		}
		if (prev) change.push({ t: f.t, d: frameChange / n });
		prev2 = prev;
		prev = now;
	}

	// The busiest tenth of frames: where the room is actually doing something.
	change.sort((a, b) => b.d - a.d);
	const busiest = change.slice(0, Math.max(1, Math.round(change.length / 10)));
	const onbeat = busiest.filter((c) => nearBeat(c.t)).length / busiest.length;

	rows.push({
		id: def.id,
		role: def.role,
		flicker: samples > 0 ? accel / samples : 0,
		change: change.reduce((a, c) => a + c.d, 0) / Math.max(1, change.length),
		onbeat,
		swing: hi - lo
	});
}

// What share of frames sit within 60 ms of a beat at all, so `onbeat` has a chance line.
const chance =
	frames.filter((f) => nearBeat(f.t)).length / Math.max(1, frames.length);

const order = ['bed', 'rhythm', 'accent'];
rows.sort((a, b) => b.flicker - a.flicker);

console.error(`${trackId} ${want}: ${frames.length} frames, chance of landing on a beat ${(100 * chance).toFixed(0)}%`);
console.error(`${'effect'.padEnd(20)}${'role'.padEnd(10)}${'flicker'.padStart(9)}${'change'.padStart(9)}${'onbeat'.padStart(8)}${'swing'.padStart(7)}`);
for (const r of rows) {
	console.error(
		r.id.padEnd(20) + r.role.padEnd(10) + r.flicker.toFixed(2).padStart(9) + r.change.toFixed(2).padStart(9) + `${(100 * r.onbeat).toFixed(0)}%`.padStart(8) + r.swing.toFixed(0).padStart(7)
	);
}
void order;

const mean = (pick: (r: (typeof rows)[number]) => number) =>
	rows.reduce((a, r) => a + pick(r), 0) / Math.max(1, rows.length);
const emit = (name: string, v: number, d = 2) => console.log(`${name}\t${v.toFixed(d)}`);
emit('mean flicker', mean((r) => r.flicker));
emit('mean change', mean((r) => r.change));
emit('shimmering', rows.filter((r) => r.flicker > 4).length, 0);
emit('mean onbeat %', 100 * mean((r) => r.onbeat), 0);
emit('chance %', 100 * chance, 0);
