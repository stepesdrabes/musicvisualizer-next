import { readFileSync } from 'node:fs';
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
import { decodeAudio } from '@mv/analysis';

/**
 * The audio's low-band envelope and the show's kick envelope, side by side, frame by frame.
 *
 * The readable form of what `render.ts` shows: if the flash lands on the kick the two columns
 * peak on the same row, and if it is late the light column lags by however many rows.
 *
 *   node bench/flashprobe.ts <trackId> [--from 120] [--seconds 4]
 */
const CACHE = join(import.meta.dirname, '..', 'cache');
const argv = process.argv.slice(2);
const flag = (n: string, d: number) => {
	const i = argv.indexOf(`--${n}`);
	return i >= 0 ? Number(argv[i + 1]) : d;
};

const id = argv[0];
const analysis = JSON.parse(readFileSync(join(CACHE, `${id}.analysis.json`), 'utf8')) as TrackAnalysis;
const show = JSON.parse(readFileSync(join(CACHE, `${id}.show.json`), 'utf8')) as Show;
const audio = await decodeAudio(join(CACHE, `${id}.m4a`));

const peak = analysis.sections.find((s) => s.energyRank === 1);
const from = flag('from', Math.max(0, peak?.startTime ?? 60));
const seconds = flag('seconds', 4);
const fps = 60;

// Restricted to the kick's own band, because a broadband envelope is mostly vocal and cymbal
// and would make every comparison here a comparison with the wrong thing.
const env = new Float32Array(Math.ceil(audio.duration * fps));
{
	const low = new Float32Array(audio.mono.length);
	const a = Math.exp((-2 * Math.PI * 90) / audio.sampleRate);
	let y1 = 0;
	let y2 = 0;
	for (let i = 0; i < audio.mono.length; i++) {
		y1 = (1 - a) * audio.mono[i] + a * y1;
		y2 = (1 - a) * y1 + a * y2;
		low[i] = y2;
	}
	const hop = Math.max(1, Math.round(audio.sampleRate / fps));
	for (let f = 0; f < env.length; f++) {
		let acc = 0;
		const i0 = f * hop;
		for (let i = i0; i < Math.min(low.length, i0 + hop); i++) acc += low[i] * low[i];
		env[f] = Math.sqrt(acc / hop);
	}
	let top = 0;
	for (const v of env) if (v > top) top = v;
	if (top > 0) for (let f = 0; f < env.length; f++) env[f] /= top;
}

const geometry = buildGeometry(DEFAULT_ROOM);
const mixer = new Mixer(geometry);
const player = new ShowPlayer(mixer, new EffectRegistry());
player.load(analysis, show);
player.reset();

const dt = 1 / fps;
for (let t = 0; t < from; t += dt) player.update(t, dt);

const bar = (v: number, width: number, ch: string) =>
	ch.repeat(Math.round(Math.max(0, Math.min(1, v)) * width)).padEnd(width);

console.log(`${id}  ${from.toFixed(1)}s .. ${(from + seconds).toFixed(1)}s   audio | light   (o = kick onset)`);
const hits = analysis.onsets.kick.times;
for (let i = 0; i < seconds * fps; i++) {
	const t = from + i * dt;
	const f = player.update(t, dt);
	const e = env[Math.round(t * fps)] ?? 0;
	const onset = hits.some((h) => h >= t - dt / 2 && h < t + dt / 2);
	console.log(
		`${t.toFixed(3)} ${bar(e, 28, '#')} | ${bar(f.kickEnv, 28, '=')} ${onset ? 'o' : ' '} ${f.kickEnv.toFixed(2)}`
	);
}
