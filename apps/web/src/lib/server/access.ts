import type { RequestEvent } from '@sveltejs/kit';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * Whether a request came from the machine running the show.
 *
 * The server binds every interface so phones in the room can reach the guest pages, which
 * means the host API is reachable from the network too. Being on the same WiFi is not the
 * same as being the person running the night, so full control - skipping, reordering,
 * clearing, hardware, authoring - is limited to loopback, and everyone else goes through the
 * guest API with a token and a much smaller set of verbs.
 *
 * This is a boundary, not a defence in depth: anyone who can reach loopback on this machine
 * is already sitting at it.
 */
export function isLocal(event: RequestEvent): boolean {
	try {
		return LOOPBACK.has(event.getClientAddress());
	} catch {
		// No address is available for a prerender or a synthetic request; treat it as remote.
		return false;
	}
}
