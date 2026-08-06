import { writeFile } from 'node:fs/promises';
import { BUILT_IN_EFFECTS, DEFAULT_ROOM, buildGeometry, compileGenerated } from '@mv/core';
import { ingest, showPath } from '@mv/analysis';
import { authorShow } from './author.ts';
import { formatFindings, lintShow } from './lint.ts';

const source = process.argv[2];
if (!source) {
	console.error('usage: npm run author -- <youtube-url|audio-file>');
	process.exit(1);
}

const geometry = buildGeometry(DEFAULT_ROOM);

console.error('Analysing...');
const { id, analysis, audioPath } = await ingest(source, {
	onProgress: (stage) => console.error(`  ${stage}...`)
});
console.error(
	`  ${analysis.title}: ${analysis.tempo.bpm} bpm, ${analysis.bars.length} bars, ${analysis.sections.length} sections`
);

console.error('\nAuthoring (this takes a few minutes)...');
const result = await authorShow(analysis, geometry, {
	audioPath,
	onEvent: (e) => {
		if (e.type === 'phase') console.error(`\n== ${e.label} ==`);
		else if (e.type === 'tool') console.error(`  -> ${e.name} ${e.detail}`);
		else if (e.type === 'result') console.error(`     ${e.ok ? '' : 'FAILED '}${e.summary}`);
		else if (e.type === 'analysis') console.error(`  ** grid corrected: ${e.reason}`);
		else if (e.type === 'thinking' && e.text.trim()) {
			console.error(`  ${e.text.replace(/\s+/g, ' ').trim().slice(0, 140)}`);
		}
	}
});

// Re-verify independently of the agent's own tool calls.
const effects = new Map(BUILT_IN_EFFECTS.map((e) => [e.id, e]));
for (const gen of result.show.generatedEffects) {
	const compiled = compileGenerated(gen, geometry);
	if (!compiled.def) {
		console.error(`\nFAILED: generated effect "${gen.id}" does not pass the gate:`);
		for (const f of compiled.failures) console.error(`  - ${f}`);
		process.exit(1);
	}
	effects.set(gen.id, compiled.def);
}

const verdict = lintShow(result.show, { analysis: result.analysis, effects });
console.error(`\n${formatFindings(verdict)}`);
if (!verdict.ok) {
	console.error('\nFAILED: the submitted show does not lint clean.');
	process.exit(1);
}

const path = showPath(id);
await writeFile(path, JSON.stringify(result.show, null, '\t'));

console.log(`\n--- brief ---\n${result.brief}`);
console.log(`\nWrote ${path}`);
console.log(
	`  ${result.show.cues.length} cues, ${result.show.hits.length} hits, ${result.show.generatedEffects.length} generated effect(s)`
);
