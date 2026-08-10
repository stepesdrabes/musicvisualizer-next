import { error, json } from '@sveltejs/kit';
import { readFile, writeFile } from 'node:fs/promises';
import { BUILT_IN_EFFECTS, type Show, type TrackAnalysis } from '@mv/core';
import { analysisPath, isValidId, readMeta, showPath } from '@mv/analysis';
import { composeShow, formatFindings, lintShow } from '@mv/author-engine';
import { isLocal } from '$lib/server/access.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	if (!isValidId(params.id)) error(400, 'invalid track id');
	try {
		return json(JSON.parse(await readFile(showPath(params.id), 'utf8')));
	} catch {
		error(404, 'no show authored yet');
	}
};

export const PUT: RequestHandler = async ({ params, request }) => {
	if (!isValidId(params.id)) error(400, 'invalid track id');
	const body = await request.text();
	if (!body) error(400, 'empty body');
	await writeFile(showPath(params.id), body);
	return new Response(null, { status: 204 });
};

/**
 * The next roll from the current one, rather than a random number.
 *
 * A track's rolls are then a sequence: the third reroll of a track is the third reroll of it
 * next week too, so a composition that looked good can be reached again by counting back to it.
 * Numerical Recipes' LCG, which is enough to decorrelate a seed and is the only job it has here.
 */
function nextSeed(from: number): number {
	return (Math.imul(from, 1664525) + 1013904223) >>> 0 || 1;
}

/**
 * Compose the track again, differently.
 *
 * The engine is deterministic and seeded from the analysis hash, which is right for a bug
 * reproducing and wrong for living with a room: the fiftieth play of a favourite track is the
 * same picture as the second. This is the same composer with a different roll.
 *
 * Persisted rather than held in memory, because the hardware renders its own copy from disk.
 * An unsaved reroll would change the preview and leave the strips playing the old show.
 */
export const POST: RequestHandler = async (event) => {
	const id = event.params.id;
	if (!isValidId(id)) error(400, 'invalid track id');
	if (!isLocal(event)) error(403, 'composing belongs to the machine running the show');

	let analysis: TrackAnalysis;
	try {
		analysis = JSON.parse(await readFile(analysisPath(id), 'utf8')) as TrackAnalysis;
	} catch {
		error(404, 'that track has not been analysed yet');
	}

	let current: Show | null = null;
	try {
		current = JSON.parse(await readFile(showPath(id), 'utf8')) as Show;
	} catch {
		// No show yet, so this is the first roll rather than the next one.
	}

	// Refuse rather than warn. Rerolling runs the engine, so on an agent's show it would spend
	// nothing and destroy something that cost real credits to make.
	if (current && current.authoredBy && current.authoredBy !== 'engine') {
		error(409, `${current.authoredBy} wrote this show; revising it is the way to change it`);
	}

	const artHue = (await readMeta(id))?.artHue;
	const show = composeShow(analysis, {
		artHue,
		seed: current?.seed ? nextSeed(current.seed) : undefined
	});

	const effects = new Map(BUILT_IN_EFFECTS.map((e) => [e.id, e]));
	const verdict = lintShow(show, { analysis, effects });
	if (!verdict.ok) error(500, `the composed show does not lint clean:\n${formatFindings(verdict)}`);

	await writeFile(showPath(id), JSON.stringify(show, null, '\t'));
	return json({ show });
};
