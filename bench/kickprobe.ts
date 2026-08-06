import { readdirSync } from 'node:fs';
import { decodeAudio } from '@mv/analysis';
import { extractFeatures } from '/Users/prace/musicvisualizer-next/packages/analysis/src/features.ts';
import { detectBeats } from '/Users/prace/musicvisualizer-next/packages/analysis/src/beats.ts';
import { chromagram } from '/Users/prace/musicvisualizer-next/packages/analysis/src/chroma.ts';
import { beatSynchronous } from '/Users/prace/musicvisualizer-next/packages/analysis/src/beatsync.ts';
import { detectMeter } from '/Users/prace/musicvisualizer-next/packages/analysis/src/downbeats.ts';
import { detectDrums } from '/Users/prace/musicvisualizer-next/packages/analysis/src/drums.ts';
import { quantiseOnsets } from '/Users/prace/musicvisualizer-next/packages/analysis/src/quantise.ts';
import { measureLoudness } from '/Users/prace/musicvisualizer-next/packages/analysis/src/loudness.ts';

const near = (t: number, xs: number[], tol: number) => xs.some((x) => Math.abs(x - t) <= tol);
const CACHE = '/Users/prace/musicvisualizer-next/cache';
const ids = [...new Set(readdirSync(CACHE).filter((f) => f.endsWith('.m4a')).map((f) => f.replace('.m4a', '')))];

console.log('track                            det   quant  invented  dropped   moved>20ms  maxMove');
for (const id of ids) {
	const audio = await decodeAudio(`${CACHE}/${id}.m4a`);
	const loud = measureLoudness(audio.mono, audio.sampleRate);
	const mono = Float32Array.from(audio.mono);
	const gain = Math.pow(10, (-14 - loud.integrated) / 20);
	if (Number.isFinite(gain)) { const g = Math.min(gain, 40); for (let i = 0; i < mono.length; i++) mono[i] *= g; }
	const f = extractFeatures(mono, audio.sampleRate);
	const g = detectBeats(f.odf, f.curves.fps, audio.duration, {});
	const ch = chromagram(mono, audio.sampleRate);
	const bf = beatSynchronous(f.spec, ch, f.curves, f.odf, g.beats, audio.duration);
	const m = detectMeter(bf);
	const det = detectDrums(f.spec, { beatPeriod: g.beatPeriod }).kick;
	const quant = quantiseOnsets(det, { beats: g.beats, beatsPerBar: m.beatsPerBar, duration: audio.duration });

	const tol = g.beatPeriod / 8;                       // half a 16th slot
	const invented = quant.filter((t) => !near(t, det, tol)).length;
	const dropped = det.filter((t) => !near(t, quant, tol)).length;
	let moved = 0, maxMove = 0;
	for (const t of det) {
		let best = Infinity;
		for (const q of quant) best = Math.min(best, Math.abs(q - t));
		if (best <= tol) { if (best > 0.02) moved++; if (best > maxMove) maxMove = best; }
	}
	console.log(
		id.padEnd(32),
		String(det.length).padStart(4), String(quant.length).padStart(6),
		`${String(invented).padStart(6)} ${(100 * invented / Math.max(1, quant.length)).toFixed(0).padStart(3)}%`,
		String(dropped).padStart(7), String(moved).padStart(10),
		(maxMove * 1000).toFixed(0).padStart(8) + 'ms',
		g.constant ? '' : '  NON-CONSTANT'
	);
}
