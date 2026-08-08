import { error, json } from '@sveltejs/kit';
import { readFile } from 'node:fs/promises';
import { analysisPath, isValidId, readMeta, showPath } from '@mv/analysis';
import type { Show, TrackAnalysis } from '@mv/core';
import type { RequestHandler } from './$types';

/**
 * Everything the player needs to light the room for one track, in one request.
 *
 * Split across three endpoints it was three round trips on every track change, and the show
 * arriving after the analysis meant a frame or two rendered against a grid it was not
 * addressed to.
 */
export const GET: RequestHandler = async ({ params }) => {
	if (!isValidId(params.id)) error(400, 'invalid track id');

	let analysis: TrackAnalysis;
	try {
		analysis = JSON.parse(await readFile(analysisPath(params.id), 'utf8')) as TrackAnalysis;
	} catch {
		error(404, 'that track has not been analysed yet');
	}

	let show: Show | null = null;
	try {
		const candidate = JSON.parse(await readFile(showPath(params.id), 'utf8')) as Show;
		// A show addressed to a grid that has since been re-analysed points at the wrong music.
		if (candidate.analysisHash === analysis.hash) show = candidate;
	} catch {
		// No show for this track yet.
	}

	return json({ analysis, show, meta: await readMeta(params.id) });
};
