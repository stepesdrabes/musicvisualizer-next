import { ingest } from './ingest.ts';

const source = process.argv[2];
if (!source) {
	console.error('usage: npm run analyse -- <youtube-url|audio-file> [--force]');
	process.exit(1);
}

const force = process.argv.includes('--force');

const { id, analysis, fromCache } = await ingest(source, {
	force,
	onProgress: (stage) => console.error(`  ${stage}...`)
});

const t = analysis.tempo;
console.log(`\n${analysis.title}`);
console.log(`  id ${id}${fromCache ? ' (cached)' : ''}  hash ${analysis.hash}`);
console.log(
	`  ${t.bpm} bpm (confidence ${t.confidence.toFixed(2)})  ${analysis.duration.toFixed(1)}s  ${
		analysis.bars.length
	} bars  ${analysis.integratedLufs} LUFS`
);
console.log(`  downbeatPhase ${t.downbeatPhase}  phraseAnchorBar ${t.phraseAnchorBar}\n`);

for (const s of analysis.sections) {
	console.log(
		`  ${String(s.index).padStart(2)} ${s.kind.padEnd(10)} bars ${String(s.startBar).padStart(3)}-${String(
			s.endBar
		).padStart(3)}  ${String(s.lengthBars).padStart(2)} bars  mean ${String(s.meanEnergy).padStart(
			3
		)}  rank ${s.energyRank}`
	);
}

console.log(
	`\n  onsets: ${analysis.onsets.kick.length} kick, ${analysis.onsets.snare.length} snare, ${analysis.onsets.hat.length} hat`
);
console.log(`  moments: ${analysis.moments.length}`);
