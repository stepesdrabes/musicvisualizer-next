import { loadCorpus } from '/Users/prace/musicvisualizer-next/bench/corpus.ts';
import { decodeAudio } from '@mv/analysis';
import { extractFeatures } from '/Users/prace/musicvisualizer-next/packages/analysis/src/features.ts';
import { chromagram, PITCH_CLASSES } from '/Users/prace/musicvisualizer-next/packages/analysis/src/chroma.ts';
import { detectBeats } from '/Users/prace/musicvisualizer-next/packages/analysis/src/beats.ts';
import { beatSynchronous, rowDistance } from '/Users/prace/musicvisualizer-next/packages/analysis/src/beatsync.ts';
import { detectMeter } from '/Users/prace/musicvisualizer-next/packages/analysis/src/downbeats.ts';
import { mean, stdev } from '/Users/prace/musicvisualizer-next/packages/analysis/src/dsp/stats.ts';
import { scoreBeats } from '/Users/prace/musicvisualizer-next/bench/metrics.ts';

const z = (a: Float32Array) => { const m = mean(a), s = stdev(a) || 1; const o = new Float32Array(a.length); for (let i = 0; i < a.length; i++) o[i] = (a[i] - m) / s; return o; };
/** Mean of a beat-level curve at each position within the bar. */
const profile = (c: Float32Array, bpb: number) => {
	const p = new Array(bpb).fill(0), n = new Array(bpb).fill(0);
	for (let i = 0; i < c.length; i++) { p[i % bpb] += c[i]; n[i % bpb]++; }
	return p.map((v, i) => v / Math.max(1, n[i]));
};

const shard = Number(process.argv[2] ?? 0), shards = Number(process.argv[3] ?? 1);
for (const ref of loadCorpus('gtzan').filter((_, i) => i % shards === shard)) {
	const a = await decodeAudio(ref.audio);
	const f = extractFeatures(a.mono, a.sampleRate);
	const g = detectBeats(f.odf, f.curves.fps, a.duration, {});
	const ch = chromagram(a.mono, a.sampleRate);
	const bf = beatSynchronous(f.spec, ch, f.curves, f.odf, g.beats, a.duration);
	const m = detectMeter(bf);
	const bpb = m.beatsPerBar, n = bf.count;
	if (n < 16 || bpb !== 4) continue;
	const fAt = (p: number) => { const db: number[] = []; for (let i = p; i < g.beats.length; i += bpb) db.push(g.beats[i]); return scoreBeats(ref.downbeats, db).f; };
	let truePhase = 0; for (let p = 1; p < bpb; p++) if (fAt(p) > fAt(truePhase)) truePhase = p;
	if (fAt(truePhase) < 0.5) continue;

	const harmonic = new Float32Array(n), bassJump = new Float32Array(n);
	for (let i = 1; i < n; i++) {
		harmonic[i] = rowDistance(bf.chroma, i - 1, i, PITCH_CLASSES);
		bassJump[i] = Math.abs(Math.log10((bf.bass[i] + 1e-6) / (bf.bass[i - 1] + 1e-6)));
	}
	console.log(JSON.stringify({
		key: ref.key, truePhase, detected: m.phase,
		harmonic: profile(z(harmonic), bpb), bassJump: profile(z(bassJump), bpb),
		flux: profile(z(bf.flux), bpb), low: profile(z(bf.low), bpb),
		mid: profile(z(bf.mid), bpb), high: profile(z(bf.high), bpb),
		rms: profile(z(bf.rms), bpb), bass: profile(z(bf.bass), bpb)
	}));
}
