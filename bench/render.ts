import { spawn } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
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
 * Render a show to a watchable video, with the track's own audio muxed in.
 *
 * The point is to judge what numbers cannot: whether the light lands ON the kick. A plan view
 * of the room is used rather than the three.js preview because it needs no GL and because a
 * flat view makes a timing error obvious, where perspective and bloom hide it.
 *
 *   node bench/render.ts <trackId> [--from 60] [--seconds 45] [--full] [--fps 60]
 *
 * The pixels come from the same Mixer the DDP transport sends, so what is on screen is what
 * would be on the wall.
 */

const CACHE = process.env.MV_CACHE_DIR ?? join(import.meta.dirname, '..', 'cache');
const OUT_DIR = join(import.meta.dirname, 'renders');

const argv = process.argv.slice(2);
const flag = (name: string, fallback: number): number => {
	const i = argv.indexOf(`--${name}`);
	return i >= 0 ? Number(argv[i + 1]) : fallback;
};

const trackId = argv[0];
if (!trackId) {
	const ids = [...new Set(readdirSync(CACHE).filter((f) => f.endsWith('.show.json')).map((f) => f.replace('.show.json', '')))];
	console.error('usage: node bench/render.ts <trackId> [--from 60] [--seconds 45] [--full]');
	console.error(`cached shows: ${ids.join(' ')}`);
	process.exit(1);
}

const analysis = JSON.parse(readFileSync(join(CACHE, `${trackId}.analysis.json`), 'utf8')) as TrackAnalysis;
const show = JSON.parse(readFileSync(join(CACHE, `${trackId}.show.json`), 'utf8')) as Show;
const audio = ['m4a', 'webm', 'opus', 'mp3', 'wav'].map((e) => join(CACHE, `${trackId}.${e}`)).find(existsSync);
if (!audio) throw new Error(`no audio for ${trackId}`);

const fps = flag('fps', 60);
const full = argv.includes('--full');
// Default to the peak, which is where a show either works or does not.
const peak = analysis.sections.find((s) => s.energyRank === 1);
const from = full ? 0 : flag('from', Math.max(0, (peak?.startTime ?? 30) - 12));
const seconds = full ? analysis.duration : flag('seconds', 45);

const W = 900;
const H = 640;
const ROOM_W = 560;
const ROOM_H = 448;
const OX = (W - ROOM_W) / 2;
const OY = 40;
const TIMELINE_Y = H - 70;

const geometry = buildGeometry(DEFAULT_ROOM);
const mixer = new Mixer(geometry);
const registry = new EffectRegistry();
for (const g of show.generatedEffects ?? []) {
	// A generated effect is sandboxed source; rendering without it would silently blank every
	// cue that names it, which would look like a bug in the show rather than in this script.
	console.error(`note: generated effect '${g.id}' is not loaded, cues naming it render dark`);
}
const player = new ShowPlayer(mixer, registry);
player.load(analysis, show);

const frame = new Uint8Array(W * H * 3);

function clear(): void {
	for (let i = 0; i < frame.length; i += 3) {
		frame[i] = 8;
		frame[i + 1] = 8;
		frame[i + 2] = 10;
	}
}

/** Additive splat with a quadratic falloff: an LED is a point source, not a square. */
function splat(cx: number, cy: number, r: number, rr: number, gg: number, bb: number): void {
	const x0 = Math.max(0, Math.floor(cx - r));
	const x1 = Math.min(W - 1, Math.ceil(cx + r));
	const y0 = Math.max(0, Math.floor(cy - r));
	const y1 = Math.min(H - 1, Math.ceil(cy + r));
	for (let y = y0; y <= y1; y++) {
		for (let x = x0; x <= x1; x++) {
			const dx = x - cx;
			const dy = y - cy;
			const d2 = (dx * dx + dy * dy) / (r * r);
			if (d2 >= 1) continue;
			const w = (1 - d2) * (1 - d2);
			const o = (y * W + x) * 3;
			frame[o] = Math.min(255, frame[o] + rr * w);
			frame[o + 1] = Math.min(255, frame[o + 1] + gg * w);
			frame[o + 2] = Math.min(255, frame[o + 2] + bb * w);
		}
	}
}

function rect(x: number, y: number, w: number, h: number, rr: number, gg: number, bb: number): void {
	for (let yy = Math.max(0, y); yy < Math.min(H, y + h); yy++) {
		for (let xx = Math.max(0, x); xx < Math.min(W, x + w); xx++) {
			const o = (yy * W + xx) * 3;
			frame[o] = rr;
			frame[o + 1] = gg;
			frame[o + 2] = bb;
		}
	}
}

/**
 * Where each LED sits in the plan view, precomputed once. The room's own coordinates are
 * metres from the centre, so this is a straight affine map rather than anything clever.
 */
const px = new Float32Array(geometry.count);
const py = new Float32Array(geometry.count);
for (let i = 0; i < geometry.count; i++) {
	px[i] = OX + ((geometry.x[i] + DEFAULT_ROOM.width / 2) / DEFAULT_ROOM.width) * ROOM_W;
	py[i] = OY + ((DEFAULT_ROOM.depth / 2 - geometry.y[i]) / DEFAULT_ROOM.depth) * ROOM_H;
}

const SECTION_RGB: Record<string, [number, number, number]> = {
	intro: [60, 70, 90],
	groove: [70, 110, 150],
	breakdown: [90, 70, 130],
	build: [170, 130, 60],
	void: [30, 30, 36],
	drop: [200, 70, 90],
	outro: [55, 60, 75]
};

const total = Math.round(seconds * fps);
const ff = spawn(
	'ffmpeg',
	[
		'-hide_banner', '-loglevel', 'error', '-y',
		'-f', 'rawvideo', '-pixel_format', 'rgb24', '-video_size', `${W}x${H}`, '-framerate', String(fps), '-i', 'pipe:0',
		'-ss', String(from), '-t', String(seconds), '-i', audio,
		'-map', '0:v', '-map', '1:a',
		'-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
		'-c:a', 'aac', '-b:a', '192k', '-shortest',
		join(OUT_DIR, `${trackId}.mp4`)
	],
	{ stdio: ['pipe', 'inherit', 'inherit'] }
);

mkdirSync(OUT_DIR, { recursive: true });

ff.stdin.on('error', (e) => {
	console.error(`ffmpeg stdin: ${e.message}`);
	process.exit(1);
});

// One listener for the whole run: attaching a fresh error handler per frame leaks them at
// sixty a second and Node starts warning about it a fifth of a second in.
const write = (buf: Uint8Array): Promise<void> =>
	new Promise((resolve) => {
		if (ff.stdin.write(buf)) resolve();
		else ff.stdin.once('drain', resolve);
	});

player.reset();
// Run the player up to the start so envelopes, cue cursors and effect state are what they
// would be if the track had been playing all along, rather than cold.
const dt = 1 / fps;
for (let t = 0; t < from; t += dt) player.update(t, dt);

for (let i = 0; i < total; i++) {
	const t = from + i * dt;
	const f = player.update(t, dt);
	mixer.render(f);
	clear();

	const bytes = mixer.bytes;
	for (let k = 0; k < geometry.count; k++) {
		const o = k * 3;
		const r = bytes[o];
		const g = bytes[o + 1];
		const b = bytes[o + 2];
		if (r + g + b < 6) continue;
		splat(px[k], py[k], 5.5, r, g, b);
	}

	// Timeline: sections as blocks, played part bright, the rest veiled.
	for (const s of analysis.sections) {
		const c = SECTION_RGB[s.kind] ?? [80, 80, 80];
		const x0 = Math.round((s.startTime / analysis.duration) * (W - 80)) + 40;
		const x1 = Math.round((s.endTime / analysis.duration) * (W - 80)) + 40;
		const played = t >= s.startTime;
		rect(x0, TIMELINE_Y, Math.max(1, x1 - x0 - 1), 16, played ? c[0] : c[0] >> 2, played ? c[1] : c[1] >> 2, played ? c[2] : c[2] >> 2);
	}
	const head = Math.round((t / analysis.duration) * (W - 80)) + 40;
	rect(head - 1, TIMELINE_Y - 5, 3, 26, 255, 255, 255);

	// Event lamps: beat, downbeat, kick, snare. These are what a timing error shows up in.
	const lamps: [boolean, number, number, number][] = [
		[f.downbeat, 255, 220, 120],
		[f.beat, 120, 200, 255],
		[f.kickEnv > 0.05, 255, 110, 110],
		[f.snareEnv > 0.05, 140, 255, 170]
	];
	lamps.forEach(([on, r, g, b], k) => {
		const cx = 60 + k * 34;
		const cy = H - 26;
		if (on) splat(cx, cy, 13, r, g, b);
		rect(cx - 4, cy - 4, 8, 8, on ? r : 40, on ? g : 40, on ? b : 46);
	});

	// Build progress, so a build that does not climb is visible as a flat bar.
	if (f.buildProgress > 0) rect(W - 240, H - 30, Math.round(200 * f.buildProgress), 8, 200, 160, 60);

	await write(frame);
}

ff.stdin.end();
await new Promise((resolve) => ff.on('close', resolve));
console.log(`wrote ${join(OUT_DIR, `${trackId}.mp4`)}  (${from.toFixed(1)}s .. ${(from + seconds).toFixed(1)}s @ ${fps}fps)`);
