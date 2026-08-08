import { queue } from '$lib/server/queueStore.ts';
import { runner } from '$lib/server/ingestRunner.ts';
import type { QueueState } from '$lib/queueModel.ts';
import type { RequestHandler } from './$types';

/**
 * The queue, pushed.
 *
 * Every client that can see the queue can also change it - the desktop tab now, phones in
 * the room later - so polling would mean each of them lagging the others by up to an
 * interval. The stream also carries ingest progress, which changes several times a second
 * while a track downloads.
 */
export const GET: RequestHandler = async ({ request }) => {
	const encoder = new TextEncoder();

	const stream = new ReadableStream({
		async start(controller) {
			let closed = false;

			const send = (state: QueueState) => {
				if (closed) return;
				try {
					controller.enqueue(encoder.encode(`event: queue\ndata: ${JSON.stringify(state)}\n\n`));
				} catch {
					closed = true;
				}
			};

			const unsubscribe = queue.subscribe(send);

			// A proxy or a sleeping laptop can drop a stream with nothing in it for minutes.
			// A comment line is not an event, so it costs a client nothing to receive.
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
				try {
					controller.close();
				} catch {
					// Already gone.
				}
			};
			request.signal.addEventListener('abort', close);

			send(await queue.ready());
			void runner.pump();
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
