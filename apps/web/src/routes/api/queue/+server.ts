import { error, json } from '@sveltejs/kit';
import { readLibrary } from '@mv/analysis';
import type { NewItem, QueueState } from '$lib/queueModel.ts';
import { isLocal } from '$lib/server/access.ts';
import { queue } from '$lib/server/queueStore.ts';
import { runner } from '$lib/server/ingestRunner.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => json(await queue.ready());

interface Body {
	action: 'add' | 'remove' | 'move' | 'playNext' | 'jump' | 'next' | 'prev' | 'clear' | 'retry';
	items?: NewItem[];
	key?: string;
	to?: number;
	keepCurrent?: boolean;
}

/** A row added from a track already in the cache starts ready, so nothing is fetched for it. */
async function withCacheState(items: NewItem[]): Promise<NewItem[]> {
	if (items.length === 0) return items;
	const library = await readLibrary();
	const byId = new Map(library.map((e) => [e.id, e]));
	return items.map((item) => {
		const hit = item.trackId ? byId.get(item.trackId) : undefined;
		if (!hit?.analysed || hit.authored === 'none') return item;
		return {
			...item,
			title: item.title ?? hit.title,
			uploader: item.uploader ?? hit.uploader,
			thumbnail: item.thumbnail ?? hit.thumbnail,
			duration: item.duration ?? hit.duration ?? 0,
			authored: hit.authored
		};
	});
}

export const POST: RequestHandler = async (event) => {
	// Guests reach the queue through /api/guest, which can only add and take back their own.
	if (!isLocal(event)) error(403, 'use the guest page to add to this queue');

	const body = (await event.request.json()) as Body;
	let state: QueueState;

	switch (body.action) {
		case 'add': {
			const items = (body.items ?? []).filter((i) => i.source?.trim());
			if (items.length === 0) error(400, 'nothing to add');
			state = await queue.add(await withCacheState(items));
			break;
		}
		case 'remove':
			if (!body.key) error(400, 'key required');
			state = await queue.remove(body.key);
			break;
		case 'move':
			if (!body.key || body.to === undefined) error(400, 'key and to required');
			state = await queue.move(body.key, body.to);
			break;
		case 'playNext':
			if (!body.key) error(400, 'key required');
			state = await queue.playNext(body.key);
			break;
		case 'jump':
			if (!body.key) error(400, 'key required');
			state = await queue.jump(body.key);
			break;
		case 'next':
			state = await queue.step(1);
			break;
		case 'prev':
			state = await queue.step(-1);
			break;
		case 'clear':
			state = await queue.clear(body.keepCurrent ?? true);
			break;
		case 'retry':
			if (!body.key) error(400, 'key required');
			await runner.retry(body.key);
			state = queue.snapshot;
			break;
		default:
			error(400, 'unknown action');
	}

	// Whatever just changed may have changed what is worth preparing. The runner decides.
	void runner.pump();
	return json(state);
};
