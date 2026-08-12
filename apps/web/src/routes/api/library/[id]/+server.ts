import { error, json } from '@sveltejs/kit';
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { CACHE_DIR, isValidId } from '@mv/analysis';
import { currentItem } from '$lib/queueModel.ts';
import { queue } from '$lib/server/queueStore.ts';
import { isLocal } from '$lib/server/access.ts';
import type { RequestHandler } from './$types';

/**
 * Throw a track out of the cache.
 *
 * Loopback only, like everything that spends money or drives hardware: this one throws away a
 * download and an analysis that cost minutes of somebody's evening, and a guest with a phone is
 * not the person who should be able to.
 */
export const DELETE: RequestHandler = async (event) => {
	if (!isLocal(event)) error(403, 'the cache belongs to the machine running the show');

	const id = event.params.id;
	if (!isValidId(id)) error(400, 'valid track id required');

	// The queue is the authority on what is about to be needed, and it holds ids that were
	// resolved rather than filenames, so this is the check rather than a lock on disk.
	const state = await queue.ready();
	if (currentItem(state)?.trackId === id) error(409, 'that track is playing');
	if (state.items.some((i) => i.trackId === id)) error(409, 'that track is in the queue');

	// Everything the ingest wrote for it: audio in whatever container it arrived in, plus the
	// analysis, show, meta and context beside it. Matched by prefix rather than by listing the
	// suffixes, so a file the pipeline learns to write later is not left behind.
	const files = await readdir(CACHE_DIR);
	const mine = files.filter((f) => f === id || f.startsWith(`${id}.`));
	await Promise.all(mine.map((f) => rm(join(CACHE_DIR, f), { force: true })));

	return json({ id, removed: mine.length });
};
