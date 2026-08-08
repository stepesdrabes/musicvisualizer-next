import { error, json } from '@sveltejs/kit';
import { searchYouTube, type SearchResult } from '@mv/analysis';
import type { RequestHandler } from './$types';

/**
 * Search results, cached by query.
 *
 * Every keystroke past the debounce is a yt-dlp process and about a second and a half, and
 * backspacing over a word asks the same question again immediately. Bounded rather than
 * time-expiring: YouTube's ranking does not move fast enough for a stale answer inside one
 * session to matter, and a fixed ceiling cannot leak.
 */
const CACHE = new Map<string, SearchResult[]>();
const CACHE_MAX = 60;

function remember(key: string, results: SearchResult[]): void {
	CACHE.delete(key);
	CACHE.set(key, results);
	if (CACHE.size > CACHE_MAX) CACHE.delete(CACHE.keys().next().value!);
}

export const GET: RequestHandler = async ({ url, request }) => {
	const query = (url.searchParams.get('q') ?? '').trim();
	if (!query) return json({ results: [] });
	if (query.length > 200) error(400, 'query too long');

	const limit = Math.max(1, Math.min(40, Number(url.searchParams.get('limit') ?? 18)));
	const key = `${limit}:${query.toLowerCase()}`;

	const hit = CACHE.get(key);
	if (hit) return json({ results: hit, cached: true });

	try {
		const results = await searchYouTube(query, limit, request.signal);
		// An aborted search resolves empty; caching that would poison the query it was for.
		if (!request.signal.aborted && results.length > 0) remember(key, results);
		return json({ results });
	} catch (e) {
		error(502, (e as Error).message);
	}
};
