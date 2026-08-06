import { error, json } from '@sveltejs/kit';
import { ingest } from '@mv/analysis';
import type { RequestHandler } from './$types';

/** Resolve, download if needed, and analyse. Idempotent: a cached analysis returns instantly. */
export const POST: RequestHandler = async ({ request }) => {
	const { source } = (await request.json()) as { source?: string };
	if (!source?.trim()) error(400, 'source required');

	try {
		const result = await ingest(source.trim());
		return json({
			id: result.id,
			analysis: result.analysis,
			meta: result.meta,
			fromCache: result.fromCache
		});
	} catch (e) {
		// yt-dlp and ffmpeg messages are the useful part; pass them through rather than hiding
		// them behind a generic 500.
		error(502, (e as Error).message);
	}
};
