import { readdirSync } from 'node:fs';
import { decodeAudio } from '@mv/analysis';
import { extractFeatures } from '/Users/prace/musicvisualizer-next/packages/analysis/src/features.ts';
import { detectBeats } from '/Users/prace/musicvisualizer-next/packages/analysis/src/beats.ts';
import { detectDrums } from '/Users/prace/musicvisualizer-next/packages/analysis/src/drums.ts';
import { measureLoudness } from '/Users/prace/musicvisualizer-next/packages/analysis/src/loudness.ts';
import { BeatThis, tempoFrom } from '/Users/prace/musicvisualizer-next/bench/beatthis.ts';

/** Median |kick - nearest beat|, and the share landing within 30 ms. The kick detector is the
 *  same for both grids, so this compares the grids without needing an annotation. */
function hug(kicks: number[], beats: number[]) {
	if (!kicks.length || !beats.length) return { median: NaN, within30: NaN };
	const devs: number[] = [];
	let j = 0;
	for (const k of kicks) {
		while (j + 1 < beats.length && Math.abs(beats[j + 1] - k) <= Math.abs(beats[j] - k)) j++;
		let best = Math.abs(beats[j] - k);
		if (j > 0) best = Math.min(best, Math.abs(beats[j - 1] - k));
		devs.push(best);
	}
	devs.sort((a, b) => a - b);
	return { median: devs[devs.length >> 1], within30: devs.filter((d) => d <= 0.03).length / devs.length };
}

const spread = (beats: number[]) => {
	const loc: number[] = [];
	for (let i = 0; i + 16 < beats.length; i += 16) loc.push((60 * 16) / (beats[i + 16] - beats[i]));
	if (loc.length < 4) return 0;
	loc.sort((a, b) => a - b);
	const p10 = loc[Math.floor(loc.length * 0.1)], p90 = loc[Math.floor(loc.length * 0.9)], mid = loc[loc.length >> 1];
	return mid > 0 ? (p90 - p10) / mid : 0;
};

const CACHE = '/Users/prace/musicvisualizer-next/cache';
const ids = [...new Set(readdirSync(CACHE).filter((f) => f.endsWith('.m4a')).map((f) => f.replace('.m4a', '')))];
const model = await BeatThis.create();

console.log('track                        | current bpm  const  kickHug  w30  | beatthis bpm  drift  kickHug  w30');
for (const id of ids) {
	const audio = await decodeAudio(`${CACHE}/${id}.m4a`);
	const loud = measureLoudness(audio.mono, audio.sampleRate);
	const mono = Float32Array.from(audio.mono);
	const g0 = Math.pow(10, (-14 - loud.integrated) / 20);
	if (Number.isFinite(g0)) { const g = Math.min(g0, 40); for (let i = 0; i < mono.length; i++) mono[i] *= g; }
	const f = extractFeatures(mono, audio.sampleRate);
	const cur = detectBeats(f.odf, f.curves.fps, audio.duration, {});
	const kicks = detectDrums(f.spec, { beatPeriod: cur.beatPeriod, odf: f.odf }).kick;   // raw, unquantised
	const bt = await model.run(audio.mono);

	const hc = hug(kicks, Array.from(cur.beats));
	const hb = hug(kicks, bt.beats);
	console.log(
		id.padEnd(28) + '|' +
		String(cur.bpm.toFixed(2)).padStart(9) + String(cur.constant).padStart(7) +
		(hc.median * 1000).toFixed(1).padStart(8) + 'ms' + (100 * hc.within30).toFixed(0).padStart(5) + '%  |' +
		String(tempoFrom(bt.beats).toFixed(2)).padStart(9) + (100 * spread(bt.beats)).toFixed(1).padStart(7) + '%' +
		(hb.median * 1000).toFixed(1).padStart(8) + 'ms' + (100 * hb.within30).toFixed(0).padStart(5) + '%'
	);
}
