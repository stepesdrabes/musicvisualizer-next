import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { decodeAudio } from '@mv/analysis';
import { extractFeatures } from '../packages/analysis/src/features.ts';
import { detectBeats } from '../packages/analysis/src/beats.ts';
import { measureLoudness } from '../packages/analysis/src/loudness.ts';
import { BeatThis } from './beatthis.ts';

/**
 * An A/B click test for tracks where the two beat trackers disagree on metrical level.
 *
 * No annotation exists for this repertoire and the obvious objective proxy is biased: a
 * half-time grid has twice the gap between beats, so any "how close is the nearest beat"
 * measure prefers the faster reading whether or not it is right. A listener settles it in
 * seconds, so the job here is to make listening easy.
 *
 * The two grids are panned hard apart and given different pitches. Where they agree the two
 * clicks fuse to the centre; where they disagree they separate, and which one is playing the
 * song is immediately obvious.
 */

const CACHE = join(import.meta.dirname, '..', 'cache');
const OUT = join(import.meta.dirname, 'clicktests');
const RATE = 44100;
const SECONDS = 20;

/** Short decaying sine, which reads as a click without masking the music under it. */
function click(buf: Float32Array, at: number, freq: number, gain: number): void {
	const start = Math.round(at * RATE);
	const len = Math.round(0.05 * RATE);
	for (let i = 0; i < len; i++) {
		const j = start + i;
		if (j < 0 || j >= buf.length) continue;
		const env = Math.exp(-i / (RATE * 0.008));
		buf[j] += Math.sin((2 * Math.PI * freq * i) / RATE) * env * gain;
	}
}

function writeWav(path: string, left: Float32Array, right: Float32Array): void {
	const n = left.length;
	const buf = Buffer.alloc(44 + n * 4);
	buf.write('RIFF', 0);
	buf.writeUInt32LE(36 + n * 4, 4);
	buf.write('WAVE', 8);
	buf.write('fmt ', 12);
	buf.writeUInt32LE(16, 16);
	buf.writeUInt16LE(1, 20);
	buf.writeUInt16LE(2, 22);
	buf.writeUInt32LE(RATE, 24);
	buf.writeUInt32LE(RATE * 4, 28);
	buf.writeUInt16LE(4, 32);
	buf.writeUInt16LE(16, 34);
	buf.write('data', 36);
	buf.writeUInt32LE(n * 4, 40);
	for (let i = 0; i < n; i++) {
		const l = Math.max(-1, Math.min(1, left[i]));
		const r = Math.max(-1, Math.min(1, right[i]));
		buf.writeInt16LE(Math.round(l * 32767), 44 + i * 4);
		buf.writeInt16LE(Math.round(r * 32767), 44 + i * 4 + 2);
	}
	writeFileSync(path, buf);
}

const run = (cmd: string, args: string[]): Promise<void> =>
	new Promise((resolve, reject) => {
		const c = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'inherit'] });
		c.on('error', reject);
		c.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
	});

mkdirSync(OUT, { recursive: true });
const ids = process.argv.slice(2);
const model = await BeatThis.create();

for (const id of ids) {
	const audioPath = ['m4a', 'webm', 'opus', 'mp3'].map((e) => join(CACHE, `${id}.${e}`)).find(existsSync);
	if (!audioPath) {
		console.error(`no audio for ${id}`);
		continue;
	}

	const audio = await decodeAudio(audioPath);
	const loud = measureLoudness(audio.mono, audio.sampleRate);
	const mono = Float32Array.from(audio.mono);
	const g0 = Math.pow(10, (-14 - loud.integrated) / 20);
	if (Number.isFinite(g0)) {
		const g = Math.min(g0, 40);
		for (let i = 0; i < mono.length; i++) mono[i] *= g;
	}

	const f = extractFeatures(mono, audio.sampleRate);
	const current = detectBeats(f.odf, f.curves.fps, audio.duration, {});
	const bt = await model.run(audio.mono);

	// A quarter of the way in, which is past any intro and inside the groove.
	const from = Math.min(audio.duration * 0.25, Math.max(0, audio.duration - SECONDS - 1));
	const n = Math.round(SECONDS * RATE);
	const left = new Float32Array(n);
	const right = new Float32Array(n);

	for (const t of current.beats) {
		if (t < from || t >= from + SECONDS) continue;
		click(left, t - from, 1400, 0.5);
	}
	for (const t of bt.beats) {
		if (t < from || t >= from + SECONDS) continue;
		click(right, t - from, 700, 0.5);
	}

	const wav = join(OUT, `${id}.clicks.wav`);
	writeWav(wav, left, right);

	const out = join(OUT, `${id}.ab.m4a`);
	await run('ffmpeg', [
		'-hide_banner', '-loglevel', 'error', '-y',
		'-ss', String(from), '-t', String(SECONDS), '-i', audioPath,
		'-i', wav,
		'-filter_complex',
		'[0:a]aformat=channel_layouts=stereo,volume=0.55[m];[1:a]volume=1.0[c];[m][c]amix=inputs=2:duration=first:dropout_transition=0[a]',
		'-map', '[a]', '-c:a', 'aac', '-b:a', '192k',
		out
	]);

	const bpm = (beats: number[]) => {
		if (beats.length < 2) return 0;
		const d: number[] = [];
		for (let i = 1; i < beats.length; i++) d.push(beats[i] - beats[i - 1]);
		d.sort((a, b) => a - b);
		return 60 / d[d.length >> 1];
	};
	console.log(
		`${id}  ${from.toFixed(1)}s..${(from + SECONDS).toFixed(1)}s  ` +
			`LEFT high click = current ${current.bpm.toFixed(1)} bpm  |  ` +
			`RIGHT low click = beat-this ${bpm(bt.beats).toFixed(1)} bpm`
	);
}
