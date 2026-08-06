import { loadCorpus } from '/Users/prace/musicvisualizer-next/bench/corpus.ts';
import { decodeAudio } from '@mv/analysis';
import { extractFeatures } from '/Users/prace/musicvisualizer-next/packages/analysis/src/features.ts';
import { chromagram } from '/Users/prace/musicvisualizer-next/packages/analysis/src/chroma.ts';
import { detectBeats } from '/Users/prace/musicvisualizer-next/packages/analysis/src/beats.ts';
import { beatSynchronous } from '/Users/prace/musicvisualizer-next/packages/analysis/src/beatsync.ts';
import { detectMeter } from '/Users/prace/musicvisualizer-next/packages/analysis/src/downbeats.ts';
import { scoreBeats } from '/Users/prace/musicvisualizer-next/bench/metrics.ts';

const report = JSON.parse(await import('node:fs').then(f => f.readFileSync('bench/reports/baseline-gtzan.json','utf8')));
const targets = new Set(report.results.filter((r:any)=>r.beatF>0.8&&r.downbeatF<0.3).map((r:any)=>r.key));
const corpus = loadCorpus('gtzan').filter(r => targets.has(r.key));

let fixable = 0, meterWrong = 0;
for (const ref of corpus.slice(0, 22)) {
	const a = await decodeAudio(ref.audio);
	const f = extractFeatures(a.mono, a.sampleRate);
	const g = detectBeats(f.odf, f.curves.fps, a.duration, {});
	const ch = chromagram(a.mono, a.sampleRate);
	const bf = beatSynchronous(f.spec, ch, f.curves, f.odf, g.beats, a.duration);
	const m = detectMeter(bf);

	// Best achievable downbeat F over every phase, at the detected meter and at the true one.
	const best = (bpb: number) => {
		let bestF = 0, bestP = 0;
		for (let p = 0; p < bpb; p++) {
			const db: number[] = [];
			for (let i = p; i < g.beats.length; i += bpb) db.push(g.beats[i]);
			const s = scoreBeats(ref.downbeats, db).f;
			if (s > bestF) { bestF = s; bestP = p; }
		}
		return { bestF, bestP };
	};
	const atDetected = best(m.beatsPerBar);
	const atTrue = ref.beatsPerBar ? best(ref.beatsPerBar) : { bestF: 0, bestP: 0 };
	const got = (() => { const db: number[] = []; for (let i = m.phase; i < g.beats.length; i += m.beatsPerBar) db.push(g.beats[i]); return scoreBeats(ref.downbeats, db).f; })();

	if (atDetected.bestF > 0.6) fixable++;
	if (ref.beatsPerBar && m.beatsPerBar !== ref.beatsPerBar) meterWrong++;
	console.log(
		ref.key.replace('gtzan/','').padEnd(18),
		'meter', m.beatsPerBar, '(true', ref.beatsPerBar + ')',
		'phase', m.phase, '-> F', got.toFixed(2),
		'| best phase', atDetected.bestP, 'F', atDetected.bestF.toFixed(2),
		'| at true meter F', atTrue.bestF.toFixed(2),
		'| conf', m.confidence.toFixed(2)
	);
}
console.log(`\n${fixable}/22 would exceed F 0.6 with only the phase corrected (meter already right)`);
console.log(`${meterWrong}/22 have the wrong meter`);
