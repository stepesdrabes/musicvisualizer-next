import { error, json } from '@sveltejs/kit';
import { OFFSET_MAX_MS, OFFSET_MIN_MS } from '$lib/hardware.ts';
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
		outputOffsetMs?: number;
	};

	const patch: {
		deepseekApiKey?: string;
		authorBackend?: BackendId;
		outputOffsetMs?: number;
	} = {};
	if (typeof body.deepseekApiKey === 'string') patch.deepseekApiKey = body.deepseekApiKey.trim();
	if (body.authorBackend === 'claude' || body.authorBackend === 'deepseek') {
		patch.authorBackend = body.authorBackend;
	}
	// Clamped rather than rejected: the field is a slider, and the bound is what the trim is for
	// rather than a validity rule worth failing a request over.
	if (typeof body.outputOffsetMs === 'number' && Number.isFinite(body.outputOffsetMs)) {
		patch.outputOffsetMs = Math.max(OFFSET_MIN_MS, Math.min(OFFSET_MAX_MS, body.outputOffsetMs));
	}
	if (Object.keys(patch).length === 0) error(400, 'nothing to change');

	return json(await settings.update(patch));
};
