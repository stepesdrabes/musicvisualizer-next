import { error, json } from '@sveltejs/kit';
import { readFile } from 'node:fs/promises';
import type { TrackAnalysis } from '@mv/core';
import { analysisPath, isValidId, readContext, readMeta } from '@mv/analysis';
import { composeShow } from '@mv/author-engine';
import { isLocal } from '$lib/server/access.ts';
import { readJudgements, type JudgedSection } from '$lib/server/judge.ts';
import { applyHandSections } from '$lib/server/previewArrangement.ts';
import type { RequestHandler } from './$types';

/**
 * The show a hand-drawn section map would produce, composed on the fly.
 *
 * Nothing touches disk: the cached analysis and show stay exactly as they were, so the
 * preview is a listen rather than a decision. The seed is the engine's own default, taken
 * from the analysis hash, so previewing twice plays the same show twice.
 *
 * The map comes from the REQUEST when the caller has one, which is what makes this useful
 * now that a saved map is adopted by the next analysis anyway: what the owner needs to hear
 * is the edit under their hands, before saving and long before a re-analysis. The saved map
 * is the fallback, for a preview asked for while nothing is being edited.
 */
export const POST: RequestHandler = async (event) => {
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

	const body = (await event.request.json().catch(() => ({}))) as { sections?: JudgedSection[] };
	const sections =
		body.sections?.length && body.sections.length >= 2
			? body.sections
			: (await readJudgements()).find((j) => j.trackId === id)?.sections;
	if (!sections?.length) error(404, 'no hand-drawn section map for this track');

	const preview = applyHandSections(analysis, sections);
	// Refused for the same reasons the analyser refuses a map: nothing here can be adopted,
	// so previewing it would show an arrangement the room will never play.
	if (!preview) error(422, 'that map does not resolve to two sections on this grid');
	const artHue = (await readMeta(id))?.artHue;
	const context = await readContext(id);
	// The re-sectioned analysis travels WITH its show. The sections are what the effects were
	// chosen against and what the timeline, the scrubber and the inspector all read, so a
	// preview that hands back only the show is a new set of cues displayed against the old
	// arrangement - which is what the room saw, and what made the preview look inert.
	return json({ show: composeShow(preview, { artHue, context }), analysis: preview });
};
