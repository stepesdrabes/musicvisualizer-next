import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ANALYSIS_VERSION } from '@mv/core';
import {
	CACHE_DIR,
	decodeAudio,
	readContext,
	analysisPath,
	contextPath,
	publishedLevel,
	refineGenreFromAudio
} from '@mv/analysis';
import { BeatThis } from '../packages/analysis/src/beatthis.ts';
import { Adtof } from '../packages/analysis/src/adtof.ts';
import { analyzeTrack } from '../packages/analysis/src/analyze.ts';

/**
 * Re-analyse every cached track in place, keeping ids and audio.
 *
 * Deliberately not ingest(): that treats a cache path as a new local file and re-keys the
 * track. The model is loaded once for the whole corpus, which is most of the per-track cost.
 */
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
/**
 * Skip tracks whose analysis already carries the current version, so an interrupted
 * corpus regeneration resumes where it stopped instead of starting over.
 */
const skipCurrent = process.argv.includes('--skip-current');

const metas = (await readdir(CACHE_DIR)).filter((f) => f.endsWith('.meta.json'));
const model = await BeatThis.create();
const drumModel = await Adtof.create();
let done = 0;

for (const f of metas) {
	const meta = JSON.parse(await readFile(join(CACHE_DIR, f), 'utf8')) as {
		id: string;
		title: string;
	};
	if (only && meta.id !== only) continue;
	if (skipCurrent) {
		try {
			const existing = JSON.parse(await readFile(analysisPath(meta.id), 'utf8')) as {
				version: number;
			};
			if (existing.version === ANALYSIS_VERSION) continue;
		} catch {
			// Nothing there yet; analyse it.
		}
	}
	const files = await readdir(CACHE_DIR);
	const audio = files.find((x) => x.startsWith(`${meta.id}.`) && !x.includes('.json') && !x.endsWith('.pcm'));
	if (!audio) continue;

	const at = `[${++done}]`;
	try {
		const decoded = await decodeAudio(join(CACHE_DIR, audio));
		const tracked = await model.run(decoded.mono);
		const drums = drumModel
			? await drumModel.run((await decodeAudio(join(CACHE_DIR, audio), 44100)).mono)
			: undefined;
		let context = (await readContext(meta.id)) ?? undefined;
		if (context && !context.sources.includes('effnet')) {
			const refined = await refineGenreFromAudio(context, decoded.mono, decoded.sampleRate);
			if (refined !== null) {
				context = refined === context ? { ...context, sources: [...context.sources, 'effnet'] } : refined;
				await writeFile(contextPath(meta.id), JSON.stringify(context, null, '\t'));
			}
		}

		let metricalLevel: number | undefined;
		if (context?.publishedBpm) {
			const level = publishedLevel(tracked.beats, context.publishedBpm, context.genreFamily);
			if (level !== null) metricalLevel = level;
		}

		const analysis = analyzeTrack({
			mono: decoded.mono,
			left: decoded.left,
			right: decoded.right,
			sampleRate: decoded.sampleRate,
			duration: decoded.duration,
			hash: decoded.hash,
			trackId: meta.id,
			title: meta.title,
			beats: tracked.beats,
			downbeats: tracked.downbeats,
			drums,
			metricalLevel,
			context
		});
		await writeFile(analysisPath(meta.id), JSON.stringify(analysis, null, '\t'));
		console.log(
			`${at} ${meta.title.slice(0, 50)} -> ${analysis.tempo.bpm} bpm` +
				`${metricalLevel ? ` (x${metricalLevel})` : ''}, ${analysis.sections.length} sections, ` +
				analysis.sections.map((s) => `${s.kind}@${s.startBar}`).join(' ')
		);
	} catch (e) {
		console.log(`${at} ${meta.title}: ${(e as Error).message.split('\n')[0]}`);
	}
}
await model.close();
await drumModel?.close();
console.log('reanalyse complete');
