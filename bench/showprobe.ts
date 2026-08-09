import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
	BUILT_IN_EFFECTS,
	DEFAULT_ROOM,
	buildGeometry,
	compileGenerated,
	type Show,
	type TrackAnalysis
} from '@mv/core';
import { formatReading, measureShow } from '@mv/author-engine';

/**
 * What `preview_show` hands the authoring agent, for a track already in the cache.
 *
 * The same function the tool calls, so what is read here is what the model reads.
 *
 *   node bench/showprobe.ts [trackId] [--fps 30]
 */
const CACHE = process.env.MV_CACHE_DIR ?? join(import.meta.dirname, '..', 'cache');
const argv = process.argv.slice(2);
const fpsFlag = argv.indexOf('--fps');
const fps = fpsFlag >= 0 ? Number(argv[fpsFlag + 1]) : 60;

const ids = [
	...new Set(
		readdirSync(CACHE)
			.filter((f) => f.endsWith('.show.json'))
			.map((f) => f.replace('.show.json', ''))
	)
].sort();

const chosen = argv[0] && !argv[0].startsWith('--') ? [argv[0]] : ids;
const geometry = buildGeometry(DEFAULT_ROOM);

for (const id of chosen) {
	const analysis = JSON.parse(
		readFileSync(join(CACHE, `${id}.analysis.json`), 'utf8')
	) as TrackAnalysis;
	const show = JSON.parse(readFileSync(join(CACHE, `${id}.show.json`), 'utf8')) as Show;

	const effects = new Map(BUILT_IN_EFFECTS.map((e) => [e.id, e]));
	for (const gen of show.generatedEffects ?? []) {
		const compiled = compileGenerated(gen, geometry);
		if (compiled.def) effects.set(gen.id, compiled.def);
	}

	const started = Date.now();
	const reading = measureShow(show, analysis, effects, geometry, { fps });
	const took = Date.now() - started;

	console.log(`\n=== ${show.title} (${id}) · ${analysis.duration.toFixed(0)}s · ${took} ms ===`);
	console.log(formatReading(reading));
}
