import { error, json } from '@sveltejs/kit';
import { hardware } from '$lib/server/hardware.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => json(hardware.status);

/** Hosts are used as an argument to a UDP send, so anything shell-like is simply not one. */
const HOST = /^[A-Za-z0-9._-]{1,253}$/;

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as { action: 'set' | 'probe'; host?: string };

	if (body.action === 'set') {
		const host = (body.host ?? '').trim();
		if (host && !HOST.test(host)) error(400, 'that does not look like a host or an address');
		hardware.setHost(host);
		return json(hardware.status);
	}

	if (body.action === 'probe') {
		const host = (body.host ?? '').trim();
		if (host && !HOST.test(host)) error(400, 'that does not look like a host or an address');
		const identity = await hardware.probe(host || undefined);
		return json({ identity, status: hardware.status });
	}

	error(400, 'unknown action');
};
