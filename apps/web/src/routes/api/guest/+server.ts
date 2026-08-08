import { error, json } from '@sveltejs/kit';
import { readLibrary } from '@mv/analysis';
import { canGuestRemove, type NewItem } from '$lib/queueModel.ts';
import { queue } from '$lib/server/queueStore.ts';
import { runner } from '$lib/server/ingestRunner.ts';
import { room } from '$lib/server/room.ts';
import type { RequestHandler } from './$types';

/**
 * What someone in the room can do from their own phone.
 *
 * Deliberately a different surface from /api/queue rather than the same one with a flag: the
 * host API can skip, reorder and clear, and the safest way to be sure a guest cannot reach
 * those is for the guest to be talking to something that does not implement them.
 */
interface Body {
	token?: string;
	name?: string;
	action: 'join' | 'add' | 'remove';
	item?: NewItem;
	key?: string;
}

/** Enough to tell two people apart on a screen, short enough to fit a queue row. */
const NAME_MAX = 24;

function cleanName(name: string | undefined): string {
	return (name ?? '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
}

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as Body;

	if (!(await room.accepts(body.token))) {
		error(403, 'that code is no longer valid; scan the QR again');
	}

	const name = cleanName(body.name);
	if (!name) error(400, 'a name is required');

	if (body.action === 'join') {
		return json({ ok: true, name });
	}

	if (body.action === 'add') {
		const item = body.item;
		if (!item?.source?.trim()) error(400, 'nothing to add');

		// Cached tracks start ready, exactly as they do for the host.
		const library = await readLibrary();
		const hit = item.trackId ? library.find((e) => e.id === item.trackId) : undefined;
		const enriched: NewItem = {
			...item,
			title: item.title ?? hit?.title,
			uploader: item.uploader ?? hit?.uploader,
			thumbnail: item.thumbnail ?? hit?.thumbnail,
			duration: item.duration ?? hit?.duration ?? 0,
			authored: hit?.analysed ? hit.authored : item.authored,
			addedBy: name
		};

		const state = await queue.add([enriched]);
		void runner.pump();
		return json(state);
	}

	if (body.action === 'remove') {
		if (!body.key) error(400, 'key required');
		const state = await queue.ready();
		if (!canGuestRemove(state, body.key, name)) {
			error(403, 'you can only take back something you added that is not playing yet');
		}
		return json(await queue.remove(body.key));
	}

	error(400, 'unknown action');
};
