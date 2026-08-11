import { parentPort, workerData } from 'node:worker_threads';
import { ingest, type IngestOptions } from './ingest.ts';

/**
 * The whole ingest pipeline on a worker thread.
 *
 * Everything in it - decode, the beat model, the analysis DSP - is synchronous CPU work,
 * and on the server's main thread it froze every request, the queue stream and the hardware
 * renderer for the length of an analysis (in the era this repo briefly ran vocal
 * separation, minutes of it). The thread boundary is drawn around the entire ingest rather
 * than the model calls, because the JS between them is most of the blockage.
 *
 * Run as a plain Node worker: from the source tree in dev, and from the rolldown-built
 * copy the desktop bundle ships and names via MV_INGEST_WORKER.
 */
const { source, opts } = workerData as { source: string; opts: IngestOptions };

try {
	const result = await ingest(source, {
		...opts,
		onProgress: (stage) => parentPort?.postMessage({ type: 'progress', stage })
	});
	parentPort?.postMessage({ type: 'done', result });
} catch (e) {
	parentPort?.postMessage({
		type: 'error',
		message: e instanceof Error ? e.message : String(e)
	});
}
