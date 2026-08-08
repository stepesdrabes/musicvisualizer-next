import { hardware } from '$lib/server/hardware.ts';
import type { HardwareStatus } from '$lib/hardware.ts';
import type { RequestHandler } from './$types';

/**
 * The board's state, pushed.
 *
 * Telemetry arrives once a second and the discovery probe answers on its own schedule, so
 * polling would either lag both or ask far more often than either changes. Subscribing is
 * also what starts the probe timer, so nothing is sent at a board nobody is looking at.
 */
export const GET: RequestHandler = async ({ request }) => {
	const encoder = new TextEncoder();

	const stream = new ReadableStream({
		start(controller) {
			let closed = false;

			const send = (status: HardwareStatus) => {
				if (closed) return;
				try {
					controller.enqueue(
						encoder.encode(`event: hardware\ndata: ${JSON.stringify(status)}\n\n`)
					);
				} catch {
					closed = true;
				}
			};

			const unsubscribe = hardware.subscribe(send);
			const unwatch = hardware.watch();

			const keepAlive = setInterval(() => {
				if (closed) return;
				try {
					controller.enqueue(encoder.encode(': keep-alive\n\n'));
				} catch {
					closed = true;
				}
			}, 20_000);

			const close = () => {
				if (closed) return;
				closed = true;
				clearInterval(keepAlive);
				unsubscribe();
				unwatch();
				try {
					controller.close();
				} catch {
					// Already gone.
				}
			};
			request.signal.addEventListener('abort', close);

			send(hardware.status);
		}
	});

	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream',
			'cache-control': 'no-cache, no-transform',
			connection: 'keep-alive'
		}
	});
};
