import { error, json } from '@sveltejs/kit';
import { readFile, writeFile } from 'node:fs/promises';
import { BUILT_IN_EFFECTS } from '@mv/core';
import { ingest, showPath } from '@mv/analysis';
import { composeShow, lintShow } from '@mv/author-engine';
import type { Show } from '@mv/core';
import type { RequestHandler } from './$types';

/**
 * Resolve, download if needed, analyse, and light the room.
 *
 * The engine show is composed here rather than on request because it costs under a
 * millisecond and there is no reason for the room to sit dark while somebody decides whether
 * to spend a model on it. An existing show for the same grid is left alone: it may be one
 * Claude has already revised, and overwriting that would throw the work away.
 */
export const POST: RequestHandler = async ({ request }) => {
	const { source } = (await request.json()) as { source?: string };
	if (!source?.trim()) error(400, 'source required');

	try {
		const result = await ingest(source.trim());

		let show: Show | null = null;
		try {
			const existing = JSON.parse(await readFile(showPath(result.id), 'utf8')) as Show;
			if (existing.analysisHash === result.analysis.hash) show = existing;
		} catch {
			// No show yet, or one written against a grid that has since been re-analysed.
		}

		if (!show) {
			show = composeShow(result.analysis);
			const verdict = lintShow(show, {
				analysis: result.analysis,
				effects: new Map(BUILT_IN_EFFECTS.map((e) => [e.id, e]))
			});
			// A show the linter rejects would be rejected on load too; better to say so here.
			if (!verdict.ok) show = null;
			else await writeFile(showPath(result.id), JSON.stringify(show, null, '\t'));
		}

		return json({
			id: result.id,
			analysis: result.analysis,
			meta: result.meta,
			show,
			fromCache: result.fromCache
		});
	} catch (e) {
		// yt-dlp and ffmpeg messages are the useful part; pass them through rather than hiding
		// them behind a generic 500.
		error(502, (e as Error).message);
	}
};
