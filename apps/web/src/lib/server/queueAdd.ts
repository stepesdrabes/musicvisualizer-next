import { readLibrary } from '@mv/analysis';
import type { NewItem } from '$lib/queueModel.ts';

/**
 * The one way a row enters the queue.
 *
 * The host, the guest page and the radio all add tracks, and the two that existed first had
 * each grown their own copy of this and already drifted apart. Autopilot would have been a
 * third.
 */

/**
 * Keep only what a request is allowed to say about a track.
 *
 * Built field by field rather than spread: `auto` marks a row the radio chose, and a body that
 * could set it would let anyone dress their own pick up as one. `authored` is left out for a
 * sharper reason - a row claiming to be authored starts `ready`, so nothing is ever fetched
 * for it, and the deck reaches a track with no audio and no show.
 */
export function fromRequest(item: NewItem, addedBy?: string): NewItem {
	return {
		source: item.source,
		trackId: item.trackId ?? null,
		title: item.title,
		uploader: item.uploader,
		thumbnail: item.thumbnail,
		duration: item.duration,
		addedBy
	};
}

/**
 * Fill in what the cache already knows.
 *
 * A track that is analysed and has a show is ready the moment it is queued, so nothing is
 * fetched for it. `authored` is set here and nowhere else, because it is what decides that.
 */
export async function enrichFromLibrary(items: NewItem[]): Promise<NewItem[]> {
	if (items.length === 0) return items;
	const library = await readLibrary();
	const byId = new Map(library.map((e) => [e.id, e]));

	return items.map((item) => {
		const hit = item.trackId ? byId.get(item.trackId) : undefined;
		const cached = hit?.analysed && hit.authored !== 'none' ? hit : undefined;
		return {
			...item,
			title: item.title ?? hit?.title,
			uploader: item.uploader ?? hit?.uploader,
			thumbnail: item.thumbnail ?? hit?.thumbnail,
			duration: item.duration ?? hit?.duration ?? 0,
			authored: cached?.authored ?? 'none'
		};
	});
}
