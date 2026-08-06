import { loadCorpus } from '/Users/prace/musicvisualizer-next/bench/corpus.ts';
import { decodeAudio } from '@mv/analysis';
import { extractFeatures } from '/Users/prace/musicvisualizer-next/packages/analysis/src/features.ts';
import { chromagram } from '/Users/prace/musicvisualizer-next/packages/analysis/src/chroma.ts';
import { detectBeats } from '/Users/prace/musicvisualizer-next/packages/analysis/src/beats.ts';
import { beatSynchronous } from '/Users/prace/musicvisualizer-next/packages/analysis/src/beatsync.ts';
import { detectMeter } from '/Users/prace/musicvisualizer-next/packages/analysis/src/downbeats.ts';
import { scoreBeats } from '/Users/prace/musicvisualizer-next/bench/metrics.ts';

const shard = Number(process.argv[2] ?? 0), shards = Number(process.argv[3] ?? 1);
const corpus = loadCorpus('gtzan').filter((_, i) => i % shards === shard);
for (const ref of corpus) {
	const a = await decodeAudio(ref.audio);
	const f = extractFeatures(a.mono, a.sampleRate);
	const g = detectBeats(f.odf, f.curves.fps, a.duration, {});
	const ch = chromagram(a.mono, a.sampleRate);
	const bf = beatSynchronous(f.spec, ch, f.curves, f.odf, g.beats, a.duration);
	const m = detectMeter(bf);
	const at = (bpb: number, p: number) => { const db: number[] = []; for (let i = p; i < g.beats.length; i += bpb) db.push(g.beats[i]); return scoreBeats(ref.downbeats, db).f; };
	const asIs = at(m.beatsPerBar, m.phase);
	let oraclePhase = 0; for (let p = 1; p < m.beatsPerBar; p++) if (at(m.beatsPerBar, p) > at(m.beatsPerBar, oraclePhase)) oraclePhase = p;
	let oracleBoth = 0; for (const bpb of [3, 4]) for (let p = 0; p < bpb; p++) oracleBoth = Math.max(oracleBoth, at(bpb, p));
	console.log(JSON.stringify({ key: ref.key, meter: m.beatsPerBar, trueMeter: ref.beatsPerBar, conf: m.confidence, asIs, oraclePhase: at(m.beatsPerBar, oraclePhase), oracleBoth }));
}
