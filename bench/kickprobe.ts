import { readdirSync } from 'node:fs';
import { decodeAudio } from '@mv/analysis';
import { extractFeatures } from '../packages/analysis/src/features.ts';
import { detectBeats } from '../packages/analysis/src/beats.ts';
import { chromagram } from '../packages/analysis/src/chroma.ts';
import { beatSynchronous } from '../packages/analysis/src/beatsync.ts';
import { detectMeter } from '../packages/analysis/src/downbeats.ts';
import { detectDrums, type DrumStream } from '../packages/analysis/src/drums.ts';
import { barGroups, quantiseOnsets } from '../packages/analysis/src/quantise.ts';
import { measureLoudness } from '../packages/analysis/src/loudness.ts';
import {
	barSynchronous,
	groupSegments,
	segmentBars,
	similarityMatrix
} from '../packages/analysis/src/structure.ts';

/**
 * What the pattern correction adds, removes and keeps, reported separately.
 *
 * A single F-measure would hide the trade: fewer fabrications bought with more misses is not an
 * improvement, and the target is both counts falling at once.
 */
const CACHE = new URL('../cache/', import.meta.url).pathname;
const ids = [
	...new Set(
		readdirSync(CACHE)
			.filter((f) => f.endsWith('.m4a'))
			.map((f) => f.replace('.m4a', ''))
	)
].sort();

const near = (t: number, xs: readonly number[], tol: number) =>
	xs.some((x) => Math.abs(x - t) <= tol);

const which = process.argv.includes('--snare')
	? 'snare'
	: process.argv.includes('--hat')
		? 'hat'
		: 'kick';

console.log(`${which}\n`);
console.log('track                        detected  shipped   invented    dropped  levels');
let totalDetected = 0;
let totalShipped = 0;
let totalInvented = 0;
let totalDropped = 0;
const levelSpread: number[] = [];

for (const id of ids) {
	const audio = await decodeAudio(`${CACHE}${id}.m4a`);
	const loud = measureLoudness(audio.mono, audio.sampleRate);
	const mono = Float32Array.from(audio.mono);
	const gain = Math.pow(10, (-14 - loud.integrated) / 20);
	if (Number.isFinite(gain)) {
		const g = Math.min(gain, 40);
		for (let i = 0; i < mono.length; i++) mono[i] *= g;
	}

	const f = extractFeatures(mono, audio.sampleRate);
	const grid = detectBeats(f.odf, f.curves.fps, audio.duration, {});
	const ch = chromagram(mono, audio.sampleRate);
	const bf = beatSynchronous(f.spec, ch, f.curves, f.odf, grid.beats, audio.duration);
	const meter = detectMeter(bf);
	const bars = barSynchronous(bf, meter.beatsPerBar, meter.phase);
	const sim = similarityMatrix(bars);
	const bounds = segmentBars(sim, bars);
	const groups = groupSegments(sim, bars.count, bounds);

	const detected: DrumStream = detectDrums(f.spec, {
		beatPeriod: grid.beatPeriod,
		odf: f.odf
	})[which];
	const shipped = quantiseOnsets(detected, {
		beats: grid.beats,
		beatsPerBar: meter.beatsPerBar,
		downbeatPhase: meter.phase,
		barGroup: barGroups(bounds, groups.group, bars.count),
		duration: audio.duration
	});

	const tol = grid.beatPeriod / 8;
	const invented = shipped.invented.filter(Boolean).length;
	const dropped = detected.times.filter((t) => !near(t, shipped.times, tol)).length;
	const distinct = new Set(shipped.levels.map((l) => l.toFixed(2))).size;

	totalDetected += detected.times.length;
	totalShipped += shipped.times.length;
	totalInvented += invented;
	totalDropped += dropped;
	levelSpread.push(distinct);

	console.log(
		id.padEnd(28),
		String(detected.times.length).padStart(8),
		String(shipped.times.length).padStart(8),
		`${String(invented).padStart(7)} ${((100 * invented) / Math.max(1, shipped.times.length)).toFixed(0).padStart(3)}%`,
		`${String(dropped).padStart(6)} ${((100 * dropped) / Math.max(1, detected.times.length)).toFixed(0).padStart(3)}%`,
		String(distinct).padStart(6)
	);
}

console.log(
	`\ntotal  detected ${totalDetected}  shipped ${totalShipped}  invented ${totalInvented} (${((100 * totalInvented) / Math.max(1, totalShipped)).toFixed(1)}% of shipped)  dropped ${totalDropped} (${((100 * totalDropped) / Math.max(1, totalDetected)).toFixed(1)}% of detected)`
);
const sorted = [...levelSpread].sort((a, b) => a - b);
console.log(
	`distinct level values per track: min ${sorted[0]}, median ${sorted[sorted.length >> 1]}, max ${sorted[sorted.length - 1]}`
);
