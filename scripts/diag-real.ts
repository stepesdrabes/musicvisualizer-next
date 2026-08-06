import { analyzeTrack, decodeAudio, extractFeatures, conditionNovelty, pickPeaks } from '@mv/analysis';

const path = process.argv[2] ?? 'cache/ZDw_x_REei0.m4a';
const hint = process.argv[3] ? Number(process.argv[3]) : undefined;

const dec = await decodeAudio(path);
const F = extractFeatures(dec.mono, dec.sampleRate);
const nov = conditionNovelty(F.novelty, F.featureRate);
const rough = pickPeaks(F.kickFlux, F.featureRate, 0.12, 0.34);
void nov;

const a = analyzeTrack({
	mono: dec.mono, sampleRate: dec.sampleRate, duration: dec.duration,
	hash: dec.hash, integratedLufs: dec.integratedLufs,
	trackId: 'ZDw_x_REei0', title: 'diag', bpmHint: hint
});

const t = a.tempo;
const beat = t.beatPeriod;
console.log(`${t.bpm} bpm (conf ${t.confidence})  bar ${(beat*4).toFixed(3)}s  ${a.bars.length} bars  downbeatPhase ${t.downbeatPhase}  anchor ${t.phraseAnchorBar}${hint?`  [hint ${hint}]`:''}`);
console.log(`kicks: rough ${rough.length} -> final ${a.onsets.kick.length} (${(a.onsets.kick.length/dec.duration).toFixed(2)}/s, ${(a.onsets.kick.length/(dec.duration/beat)).toFixed(2)}/beat)  snare ${a.onsets.snare.length}  hat ${a.onsets.hat.length}`);

const gaps: number[] = [];
for (let i=1;i<a.onsets.kick.length;i++) gaps.push(a.onsets.kick[i]-a.onsets.kick[i-1]);
const hist=new Map<number,number>();
for (const g of gaps){const k=Math.round(g*1000/40)*40; hist.set(k,(hist.get(k)??0)+1);}
console.log('kick gaps: '+[...hist.entries()].sort((x,y)=>y[1]-x[1]).slice(0,6).map(([k,v])=>`${k}ms:${v}`).join(' ')+`  | beat ${(beat*1000).toFixed(0)}ms eighth ${(beat*500).toFixed(0)}ms`);
console.log();
for (const s of a.sections) {
	console.log(`  ${String(s.index).padStart(2)} ${s.kind.padEnd(10)} bars ${String(s.startBar).padStart(3)}-${String(s.endBar).padEnd(3)} ${String(s.lengthBars).padStart(2)}b ${s.startTime.toFixed(1).padStart(6)}s mean ${String(s.meanEnergy).padStart(3)} rank ${s.energyRank}${s.energyRank===1?'  <-- PEAK':''}`);
}
const off = a.sections.filter(s=>s.kind!=='void'&&s.startBar>0&&(s.startBar-t.phraseAnchorBar)%4!==0).map(s=>s.startBar);
console.log(`\noff-phrase starts: [${off}]`);
console.log(`kinds: ${[...new Set(a.sections.map(s=>s.kind))].join(', ')}`);
