import { error, json } from '@sveltejs/kit';
import { DEFAULT_ROOM, buildGeometry, roomRegions } from '@mv/core';
import { hardware } from '$lib/server/hardware.ts';
import { isLocal } from '$lib/server/access.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => json(hardware.status);

/** Hosts are used as an argument to a UDP send, so anything shell-like is simply not one. */
const HOST = /^[A-Za-z0-9._-]{1,253}$/;

export const POST: RequestHandler = async (event) => {
	if (!isLocal(event)) error(403, 'the hardware belongs to the machine running the show');

	const body = (await event.request.json()) as {
		action: 'set' | 'probe';
		host?: string;
		region?: string;
	};

	if (body.action === 'set') {
		const host = (body.host ?? '').trim();
		if (host && !HOST.test(host)) error(400, 'that does not look like a host or an address');
		hardware.setHost(host);
		if (typeof body.region === 'string') {
			// Checked against the geometry rather than against a pattern, so an id that no longer
			// names a part of this room is refused here instead of silently lighting nothing.
			const known = roomRegions(buildGeometry(DEFAULT_ROOM)).some((r) => r.id === body.region);
			if (!known) error(400, 'that is not a part of this room');
			hardware.setRegion(body.region);
		}
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
