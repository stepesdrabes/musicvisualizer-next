import { readFileSync, readdirSync } from 'node:fs';
import { decodeAudio } from '@mv/analysis';
import { extractFeatures } from '/Users/prace/musicvisualizer-next/packages/analysis/src/features.ts';

const ROOT = '/Users/prace/musicvisualizer-next/bench/corpus';
const meta = new Map<string, number>();
for (const line of readFileSync(`${ROOT}/harmonixset-main/dataset/metadata.csv`, 'utf8').trim().split('\n').slice(1)) {
	const id = line.slice(0, line.indexOf(','));
	// Duration is the field just before BPM: both are bare numbers near the end.
	const nums = line.match(/,(\d+\.\d+),(\d+),/);
	if (nums) meta.set(id, Number(nums[1]));
}

for (const file of readdirSync(`${ROOT}/harmonix/audio`).filter((f) => f.endsWith('.m4a'))) {
	const id = file.replace('.m4a', '');
	const beats = readFileSync(`${ROOT}/harmonixset-main/dataset/beats_and_downbeats/${id}.txt`, 'utf8')
		.trim().split('\n').map((l) => Number(l.trim().split(/\s+/)[0])).filter(Number.isFinite);
	const audio = await decodeAudio(`${ROOT}/harmonix/audio/${file}`);
	const f = extractFeatures(audio.mono, audio.sampleRate);
	const { odf, curves } = f;

	// Mean onset strength landing on the annotated beats, as a function of a constant offset.
	const score = (off: number) => {
		let acc = 0, n = 0;
		for (const b of beats) {
			const i = Math.round((b + off) * curves.fps);
			if (i < 0 || i >= odf.length) continue;
			acc += odf[i]; n++;
		}
		return n > 20 ? acc / n : 0;
	};
	let best = 0, bestS = -1;
	for (let off = -3; off <= 3.0001; off += 0.01) { const s = score(off); if (s > bestS) { bestS = s; best = off; } }
	const at0 = score(0);
	console.log(
		id.padEnd(26),
		'annDur', (meta.get(id) ?? 0).toFixed(1).padStart(6),
		'audioDur', audio.duration.toFixed(1).padStart(6),
		'| bestOffset', best.toFixed(2).padStart(6), 's',
		'score@best', bestS.toFixed(3), 'score@0', at0.toFixed(3),
		'ratio', (at0 / bestS).toFixed(3)
	);
}
