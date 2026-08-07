import { ARRANGEMENT, synthesise } from '../packages/analysis/src/fixture.ts';
import { analyzeTrack } from '../packages/analysis/src/analyze.ts';
import { extractFeatures } from '../packages/analysis/src/features.ts';
import { chromagram } from '../packages/analysis/src/chroma.ts';
import { detectBeats } from '../packages/analysis/src/beats.ts';
import { beatSynchronous } from '../packages/analysis/src/beatsync.ts';
import { detectMeter } from '../packages/analysis/src/downbeats.ts';
import { measureLoudness } from '../packages/analysis/src/loudness.ts';
import {
	barSynchronous,
	groupSegments,
	segmentBars,
	similarityMatrix
} from '../packages/analysis/src/structure.ts';

/** What the segmenter does to the synthetic arrangement, stage by stage. */
const fixture = synthesise();

let bar = 0;
console.log('stages:');
for (const [i, s] of ARRANGEMENT.entries()) {
	console.log(
		`  ${String(i).padStart(2)}  bars ${String(bar).padStart(3)}-${String(bar + s.bars).padStart(3)}  kick ${s.kick}  bass ${s.bass}  pad ${s.pad}${s.silent ? '  SILENT' : ''}${s.riser ? '  riser' : ''}`
	);
	bar += s.bars;
}

const loud = measureLoudness(fixture.mono, fixture.sampleRate);
const mono = Float32Array.from(fixture.mono);
const gain = Math.pow(10, (-14 - loud.integrated) / 20);
if (Number.isFinite(gain) && Math.abs(gain - 1) > 0.01) {
	const g = Math.min(gain, 40);
	for (let i = 0; i < mono.length; i++) mono[i] *= g;
}

const f = extractFeatures(mono, fixture.sampleRate);
const ch = chromagram(mono, fixture.sampleRate);
const grid = detectBeats(f.odf, f.curves.fps, fixture.duration, {});
const bf = beatSynchronous(f.spec, ch, f.curves, f.odf, grid.beats, fixture.duration);
const meter = detectMeter(bf);
const bars = barSynchronous(bf, meter.beatsPerBar, meter.phase);
const sim = similarityMatrix(bars);
const bounds = segmentBars(sim, bars);
const groups = groupSegments(sim, bars.count, bounds);

console.log(`\nbars ${bars.count}, meter ${meter.beatsPerBar}/${meter.phase}`);
console.log(`segmentBars -> ${bounds.slice(0, -1).map((b, i) => `${b}-${bounds[i + 1]}`).join(' ')}`);
console.log(`groups      -> [${groups.group.join(' ')}]`);

const db = (v: number) => (v > 1e-9 ? (20 * Math.log10(v)).toFixed(1) : '  -inf');
console.log('\nbar   rms      dB   floor   sim(b,b-1)');
for (let b = 0; b < bars.count; b++) {
	const prev = b > 0 ? sim[b * bars.count + (b - 1)].toFixed(3) : '  -  ';
	console.log(
		`${String(b).padStart(3)}  ${bars.rms[b].toExponential(2)}  ${db(bars.rms[b]).padStart(6)}  ${bars.floor[b].toExponential(2)}  ${prev}`
	);
}

const analysis = analyzeTrack({
	mono: fixture.mono,
	sampleRate: fixture.sampleRate,
	duration: fixture.duration,
	hash: 'test',
	trackId: 'file-000000000000',
	title: 'Synthetic Arrangement'
});
console.log(
	`\nsections -> ${analysis.sections.map((s) => `${s.kind}:${s.startBar}-${s.endBar}(g${s.group},r${s.energyRank})`).join(' ')}`
);
const drop = analysis.sections.find((s) => s.kind === 'drop');
if (drop) {
	const rows = analysis.bars.filter((b) => b.bar >= drop.startBar && b.bar < drop.endBar);
	console.log(
		`drop ${drop.startBar}-${drop.endBar}: kicks per bar [${rows.map((r) => r.kicks).join(' ')}] -> ${rows.filter((r) => r.kicks > 0).length}/${rows.length}`
	);
}
const peak = analysis.sections.find((s) => s.energyRank === 1)!;
console.log(`peak -> ${peak.kind}:${peak.startBar}-${peak.endBar}  (drop stage starts bar ${fixture.stageBars[5]})`);
