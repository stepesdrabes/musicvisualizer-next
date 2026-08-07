import { decodeAudio } from '@mv/analysis';
import { extractFeatures } from '/Users/prace/musicvisualizer-next/packages/analysis/src/features.ts';
import { chromagram } from '/Users/prace/musicvisualizer-next/packages/analysis/src/chroma.ts';
import { detectBeats } from '/Users/prace/musicvisualizer-next/packages/analysis/src/beats.ts';
import { beatSynchronous } from '/Users/prace/musicvisualizer-next/packages/analysis/src/beatsync.ts';
import { detectMeter } from '/Users/prace/musicvisualizer-next/packages/analysis/src/downbeats.ts';
import { barSynchronous, groupSegments, segmentBars, similarityMatrix } from '/Users/prace/musicvisualizer-next/packages/analysis/src/structure.ts';
import { arrange } from '/Users/prace/musicvisualizer-next/packages/analysis/src/arrange.ts';
import { measureLoudness } from '/Users/prace/musicvisualizer-next/packages/analysis/src/loudness.ts';
import { detectDrums } from '/Users/prace/musicvisualizer-next/packages/analysis/src/drums.ts';
import { quantiseOnsets } from '/Users/prace/musicvisualizer-next/packages/analysis/src/quantise.ts';

for (const id of process.argv.slice(2)) {
	const path = `/Users/prace/musicvisualizer-next/cache/${id}.m4a`;
	const audio = await decodeAudio(path);
	const loud = measureLoudness(audio.mono, audio.sampleRate);
	const mono = Float32Array.from(audio.mono);
	const gain = Math.pow(10, (-14 - loud.integrated) / 20);
	if (Number.isFinite(gain)) { const g = Math.min(gain, 40); for (let i = 0; i < mono.length; i++) mono[i] *= g; }

	const f = extractFeatures(mono, audio.sampleRate);
	const ch = chromagram(mono, audio.sampleRate);
	const g = detectBeats(f.odf, f.curves.fps, audio.duration, {});
	const bf = beatSynchronous(f.spec, ch, f.curves, f.odf, g.beats, audio.duration);
	const m = detectMeter(bf);
	const bars = barSynchronous(bf, m.beatsPerBar, m.phase);
	const sim = similarityMatrix(bars);
	const bounds = segmentBars(sim, bars);
	const groups = groupSegments(sim, bars.count, bounds);

	const det = detectDrums(f.spec, { beatPeriod: g.beatPeriod, odf: f.odf });
	const q = (t: number[]) => quantiseOnsets(t, { beats: g.beats, beatsPerBar: m.beatsPerBar, duration: audio.duration });
	const kicks = new Int32Array(bars.count), snares = new Int32Array(bars.count);
	const count = (times: number[], out: Int32Array) => { for (const t of times) { for (let b = 0; b < bars.count; b++) if (t >= bars.time[b] && t < bars.time[b + 1]) { out[b]++; break; } } };
	count(q(det.kick).times, kicks); count(q(det.snare).times, snares);

	const plan = arrange(f.spec, bars, bounds, groups, loud.shortTerm, loud.shortTermFps, kicks, snares);

	console.log(`\n=== ${id} ===  ${bars.count} bars, meter ${m.beatsPerBar}`);
	console.log(`  1. segmentBars      -> ${bounds.length - 1} segments: ${bounds.slice(0, -1).map((b, i) => `${b}-${bounds[i + 1]}`).join(' ')}`);
	console.log(`  2. groupSegments    -> ${new Set(groups.group).size} distinct groups: [${groups.group.join(' ')}]`);
	console.log(`  3. arrange output   -> ${plan.segments.length} sections: ${plan.segments.map((s) => `${s.kind}:${s.startBar}-${s.endBar}`).join(' ')}`);
	const lost = (bounds.length - 1) - plan.segments.length;
	console.log(`  => ${lost} of ${bounds.length - 1} boundaries discarded (${(100 * lost / (bounds.length - 1)).toFixed(0)}%)`);
	const distinct = new Set(plan.segments.map((s) => s.group)).size;
	console.log(`  => ${distinct} distinct groups across ${plan.segments.length} sections (groupSegments found ${new Set(groups.group).size} over ${bounds.length - 1} segments)`);
	const longest = Math.max(...plan.segments.map((s) => s.endBar - s.startBar));
	console.log(`  => longest section ${longest} bars (${(100 * longest / bars.count).toFixed(0)}% of the track)`);
}
