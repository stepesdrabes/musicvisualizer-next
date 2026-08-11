import { error, json } from '@sveltejs/kit';
import { watchUrl } from '@mv/analysis';
import { isLocal } from '$lib/server/access.ts';
import { autopilot } from '$lib/server/autopilot.ts';
import type { RequestHandler } from './$types';

/**
 * What to play next, from YouTube Music's own reading of a track.
 *
 * Loopback only. Note the asymmetry with /api/search, which is deliberately open because the
 * guest page searches: this is a host surface, and opening it later is easy where closing it
 * later would take something away.
 */
const WATCH_ID = /^[A-Za-z0-9_-]{11}$/;

export const GET: RequestHandler = async (event) => {
	if (!isLocal(event)) error(403, 'the radio belongs to the machine running the show');

	const seed = event.url.searchParams.get('seed');
	const limit = Math.max(1, Math.min(30, Number(event.url.searchParams.get('limit') ?? 12)));
	// Validated out here: `error` throws, and inside the try it would be caught and reported as
	// an upstream failure rather than as the bad request it is.
	if (seed !== null && !WATCH_ID.test(seed)) error(400, 'not a track id');

	try {
		// A seed asks what follows one track; without one, the queue as a whole is the seed.
		const songs = seed ? await autopilot.around(seed, limit) : await autopilot.ahead(limit);
		return json({ results: songs.map((s) => ({ ...s, webpageUrl: watchUrl(s.id) })) });
	} catch (e) {
		error(502, (e as Error).message);
	}
};
