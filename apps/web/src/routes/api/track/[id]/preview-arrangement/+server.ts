import { error, json } from '@sveltejs/kit';
import { readFile } from 'node:fs/promises';
import type { TrackAnalysis } from '@mv/core';
import { analysisPath, isValidId, readContext, readMeta } from '@mv/analysis';
import { composeShow } from '@mv/author-engine';
import { isLocal } from '$lib/server/access.ts';
import { readJudgements } from '$lib/server/judge.ts';
import { applyHandSections } from '$lib/server/previewArrangement.ts';
import type { RequestHandler } from './$types';

/**
 * The show the owner's hand-drawn section map would produce, composed on the fly.
 *
 * Nothing touches disk: the cached analysis and show stay exactly as they were, so the
 * preview is a listen rather than a decision. The seed is the engine's own default, taken
 * from the analysis hash, so previewing twice plays the same show twice.
 */
export const GET: RequestHandler = async (event) => {
	const id = event.params.id;
	if (!isValidId(id)) error(400, 'invalid track id');
	// Loopback only, like the judgements the map lives in: previewing the owner's verdict
	// belongs to the person running the night.
	if (!isLocal(event)) error(403, 'forbidden');

	let analysis: TrackAnalysis;
	try {
		analysis = JSON.parse(await readFile(analysisPath(id), 'utf8')) as TrackAnalysis;
	} catch {
		error(404, 'that track has not been analysed yet');
	}

	const judgement = (await readJudgements()).find((j) => j.trackId === id);
	if (!judgement?.sections?.length) error(404, 'no hand-drawn section map for this track');

	const preview = applyHandSections(analysis, judgement.sections);
	const artHue = (await readMeta(id))?.artHue;
	const context = await readContext(id);
	return json({ show: composeShow(preview, { artHue, context }) });
};
