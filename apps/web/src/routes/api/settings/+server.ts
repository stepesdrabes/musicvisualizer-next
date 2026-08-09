import { error, json } from '@sveltejs/kit';
import { isLocal } from '$lib/server/access.ts';
import { settings } from '$lib/server/settings.ts';
import type { BackendId } from '@mv/author-ai';
import type { RequestHandler } from './$types';

/**
 * Loopback only, both ways.
 *
 * Reading says whether a key is stored and never what it is, but knowing the machine has one is
 * still a fact about the person running the night, and writing spends their money. This sits
 * behind the same boundary as the hardware and the queue.
 */
export const GET: RequestHandler = async (event) => {
	if (!isLocal(event)) error(403, 'settings belong to the machine running the show');
	return json(await settings.read());
};

export const PUT: RequestHandler = async (event) => {
	if (!isLocal(event)) error(403, 'settings belong to the machine running the show');

	const body = (await event.request.json()) as {
		deepseekApiKey?: string;
		authorBackend?: BackendId;
	};

	const patch: { deepseekApiKey?: string; authorBackend?: BackendId } = {};
	if (typeof body.deepseekApiKey === 'string') patch.deepseekApiKey = body.deepseekApiKey.trim();
	if (body.authorBackend === 'claude' || body.authorBackend === 'deepseek') {
		patch.authorBackend = body.authorBackend;
	}
	if (Object.keys(patch).length === 0) error(400, 'nothing to change');

	return json(await settings.update(patch));
};
