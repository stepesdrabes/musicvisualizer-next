// Reproduces the analyse.test.ts fixture exactly so its failures can be inspected.
import { analyzeTrack } from '@mv/analysis';
const SR = 44100;
interface Stage { bars:number;kick:number;bass:number;hat:number;pad:number;riser:boolean;silent?:boolean }
function synth(bpm:number, stages:Stage[]) {
	const beatPeriod=60/bpm, barLength=beatPeriod*4;
	const totalBars=stages.reduce((n,s)=>n+s.bars,0), duration=totalBars*barLength;
	const mono=new Float32Array(Math.ceil(duration*SR));
	let bar=0, rngState=12345;
	const rand=()=>{rngState=(Math.imul(rngState,1664525)+1013904223)>>>0;return rngState/4294967296-0.5;};
	for(const stage of stages){for(let b=0;b<stage.bars;b++,bar++){
		const barStart=bar*barLength; if(stage.silent) continue;
		for(let beat=0;beat<4;beat++){const t0=barStart+beat*beatPeriod,i0=Math.floor(t0*SR);
			if(stage.kick>0){const len=Math.floor(0.14*SR);for(let i=0;i<len&&i0+i<mono.length;i++)mono[i0+i]+=Math.sin(2*Math.PI*55*i/SR)*Math.exp(-i/SR*34)*stage.kick;}
			if(beat%2===1&&stage.kick>0){const len=Math.floor(0.08*SR);for(let i=0;i<len&&i0+i<mono.length;i++)mono[i0+i]+=rand()*Math.exp(-i/SR*52)*0.45*stage.kick;}
			if(stage.hat>0){const hi=Math.floor((t0+beatPeriod/2)*SR),len=Math.floor(0.03*SR);for(let i=0;i<len&&hi+i<mono.length;i++)mono[hi+i]+=rand()*Math.exp(-i/SR*150)*stage.hat;}}
		if(stage.bass>0)for(let e=0;e<8;e++){const i0=Math.floor((barStart+e*(beatPeriod/2))*SR),len=Math.floor(0.2*SR);
			for(let i=0;i<len&&i0+i<mono.length;i++)mono[i0+i]+=Math.sin(2*Math.PI*110*i/SR)*Math.exp(-i/SR*12)*stage.bass*0.5;}
		if(stage.pad>0){const i0=Math.floor(barStart*SR),len=Math.floor(barLength*SR);
			for(let i=0;i<len&&i0+i<mono.length;i++){const t=i/SR;mono[i0+i]+=(Math.sin(2*Math.PI*440*t)+Math.sin(2*Math.PI*660*t))*0.09*stage.pad;}}
		if(stage.riser){const i0=Math.floor(barStart*SR),len=Math.floor(barLength*SR),climb=b/Math.max(1,stage.bars-1);
			for(let i=0;i<len&&i0+i<mono.length;i++)mono[i0+i]+=rand()*0.30*(0.25+climb);}
	}}
	for(let i=0;i<mono.length;i++)mono[i]=Math.max(-1,Math.min(1,mono[i]));
	return {mono,duration};
}
const ARRANGEMENT:Stage[]=[
	{bars:4,kick:0,bass:0,hat:0,pad:0.6,riser:false},
	{bars:8,kick:0.9,bass:0.7,hat:0.2,pad:0.5,riser:false},
	{bars:6,kick:0,bass:0,hat:0.15,pad:0.8,riser:false},
	{bars:4,kick:0.5,bass:0,hat:0.3,pad:0.7,riser:true},
	{bars:1,kick:0,bass:0,hat:0,pad:0,riser:false,silent:true},
	{bars:8,kick:1.0,bass:0.9,hat:0.35,pad:0.6,riser:false},
	{bars:8,kick:0.9,bass:0.7,hat:0.25,pad:0.5,riser:false},
	{bars:4,kick:0,bass:0,hat:0.1,pad:0.4,riser:false}
];
const track=synth(128,ARRANGEMENT);
const a=analyzeTrack({mono:track.mono,sampleRate:SR,duration:track.duration,hash:'t',integratedLufs:-14,trackId:'file-000000000000',title:'x'});
console.log(`${a.tempo.bpm} bpm  ${a.bars.length} bars  anchor ${a.tempo.phraseAnchorBar}  dbPhase ${a.tempo.downbeatPhase}`);
console.log(`kicks ${a.onsets.kick.length} (true 112)`);
for(const s of a.sections) console.log(`  ${String(s.index).padStart(2)} ${s.kind.padEnd(10)} ${String(s.startBar).padStart(3)}-${String(s.endBar).padEnd(3)} ${String(s.lengthBars).padStart(2)}b mean ${String(s.meanEnergy).padStart(3)} rank ${s.energyRank}`);
