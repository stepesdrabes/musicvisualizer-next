import { json } from '@sveltejs/kit';
import { isLocal } from '$lib/server/access.ts';
import {
	clearJudgement,
	readJudgements,
	writeJudgement,
	type Judgement
} from '$lib/server/judge.ts';
import type { RequestHandler } from './$types';

/**
 * The judge panel's store. Loopback only, like everything else that is the owner's act:
 * a phone in the room may add songs, but the verdicts steering the next round of engine
 * work are the person running the night's.
 */
export const GET: RequestHandler = async (event) => {
	if (!isLocal(event)) return new Response('forbidden', { status: 403 });
	return json({ judgements: await readJudgements() });
};

export const POST: RequestHandler = async (event) => {
	if (!isLocal(event)) return new Response('forbidden', { status: 403 });
	const body = (await event.request.json()) as {
		judgement?: Judgement;
		trackId?: string;
		clear?: boolean;
	};

	if (body.clear && body.trackId) {
		await clearJudgement(body.trackId);
		return json({ ok: true });
	}
	if (!body.judgement?.trackId) return new Response('trackId required', { status: 400 });
	await writeJudgement(body.judgement);
	return json({ ok: true });
};
