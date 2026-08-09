import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	BUILT_IN_EFFECTS,
	DEFAULT_ROOM,
	buildGeometry,
	compileGenerated,
	type Show,
	type TrackAnalysis
} from '@mv/core';
import { composeShow, formatFindings, formatReading, lintShow, measureShow } from '@mv/author-engine';
import { CLAUDE, deepseek, reviseShow, type AuthorEvent } from '@mv/author-ai';

/**
 * Run the authoring agent against a track already in the cache, and measure what came back.
 *
 * The app is the only way to USE this; the point here is to compare two runs against each other
 * on the same track, which the app cannot do because it writes over the show each time.
 *
 *   node bench/authorlab.ts <trackId> [--backend claude|deepseek] [--out label] [--quiet]
 *
 * Nothing is written into `cache/`: the show lands in `bench/authored/` so the app's copy is
 * left alone and two backends can be held side by side.
 */
const CACHE = process.env.MV_CACHE_DIR ?? join(import.meta.dirname, '..', 'cache');
const OUT = join(import.meta.dirname, 'authored');

const argv = process.argv.slice(2);
const flag = (name: string, fallback = '') => {
	const i = argv.indexOf(`--${name}`);
	return i >= 0 ? argv[i + 1] : fallback;
};
const quiet = argv.includes('--quiet');
const trackId = argv[0];
if (!trackId || trackId.startsWith('--')) {
	const ids = [
		...new Set(
			readdirSync(CACHE)
				.filter((f) => f.endsWith('.analysis.json'))
				.map((f) => f.replace('.analysis.json', ''))
		)
	];
	console.error('usage: node bench/authorlab.ts <trackId> [--backend deepseek] [--out label]');
	console.error(`cached: ${ids.slice(0, 20).join(' ')}`);
	process.exit(1);
}

const backend = flag('backend', 'claude');
const label = flag('out', backend);
const analysis = JSON.parse(
	readFileSync(join(CACHE, `${trackId}.analysis.json`), 'utf8')
) as TrackAnalysis;
const audio = ['m4a', 'webm', 'opus', 'mp3', 'wav']
	.map((e) => join(CACHE, `${trackId}.${e}`))
	.find((p) => {
		try {
			readFileSync(p, { flag: 'r' });
			return true;
		} catch {
			return false;
		}
	});

const geometry = buildGeometry(DEFAULT_ROOM);
const draft = composeShow(analysis);

const counts = new Map<string, number>();
const started = Date.now();
const onEvent = (e: AuthorEvent) => {
	if (e.type === 'tool') counts.set(e.name, (counts.get(e.name) ?? 0) + 1);
	if (quiet) return;
	const at = `${((Date.now() - started) / 1000).toFixed(0)}s`.padStart(5);
	if (e.type === 'phase') console.error(`\n${at}  == ${e.label} ==`);
	else if (e.type === 'tool') console.error(`${at}  -> ${e.name} ${e.detail}`);
	else if (e.type === 'result') console.error(`${at}     ${e.ok ? '  ' : ' !'} ${e.summary}`);
	else if (e.type === 'brief') console.error(`${at}  brief:\n${e.brief}`);
	else if (e.type === 'analysis') console.error(`${at}  regridded: ${e.reason}`);
};

const provider =
	backend === 'deepseek'
		? deepseek(process.env.DEEPSEEK_API_KEY ?? '')
		: CLAUDE;
if (backend === 'deepseek' && !process.env.DEEPSEEK_API_KEY) {
	throw new Error('DEEPSEEK_API_KEY is not set');
}

const result = await reviseShow(analysis, geometry, draft, { provider, audioPath: audio, onEvent });

const effects = new Map(BUILT_IN_EFFECTS.map((e) => [e.id, e]));
const rejected: string[] = [];
for (const gen of result.show.generatedEffects) {
	const compiled = compileGenerated(gen, geometry);
	if (compiled.def) effects.set(gen.id, compiled.def);
	else rejected.push(`${gen.id}: ${compiled.failures.join('; ')}`);
}

const verdict = lintShow(result.show, { analysis: result.analysis, effects });
const reading = measureShow(result.show, result.analysis, effects, geometry);

writeFileSync(join(OUT, `${trackId}.${label}.show.json`), JSON.stringify(result.show, null, '\t'));

console.log(`\n=== ${result.show.title} · ${backend} · ${((Date.now() - started) / 1000).toFixed(0)}s ===`);
console.log(`brief (${result.brief.length} chars):\n${result.brief}\n`);
console.log(
	`${result.show.cues.length} cues · ${result.show.hits.length} hits · ${result.show.generatedEffects.length} generated effects`
);
console.log(`draft had ${draft.cues.length} cues and ${draft.hits.length} hits`);
if (rejected.length > 0) console.log(`REJECTED effects: ${rejected.join(' | ')}`);
console.log(`\n${formatFindings(verdict)}`);
console.log(`\n${formatReading(reading)}`);
console.log(`\ntool calls: ${[...counts].map(([k, v]) => `${k} ${v}`).join(', ')}`);

const draftReading = measureShow(draft, analysis, new Map(BUILT_IN_EFFECTS.map((e) => [e.id, e])), geometry);
console.log(
	`\nagainst the engine's draft: contrast ${draftReading.contrast.toFixed(2)}x -> ${reading.contrast.toFixed(
		2
	)}x, dark bars ${draftReading.darkBars.length} -> ${reading.darkBars.length}, hits ${
		draftReading.hits.filter((h) => h.fired).length
	}/${draftReading.hits.length} -> ${reading.hits.filter((h) => h.fired).length}/${reading.hits.length}`
);

const shows = [
	`${label}: ${JSON.stringify(result.show).length} bytes`,
	...(result.log.length > 0 ? [`log:\n  ${result.log.join('\n  ')}`] : [])
];
console.log(`\n${shows.join('\n')}`);
