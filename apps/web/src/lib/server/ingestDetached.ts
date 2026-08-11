import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { ingest, workspaceRoot, type IngestOptions, type IngestResult } from '@mv/analysis';

/**
 * Ingest on a worker thread, so minutes of DSP cannot freeze the server.
 *
 * The pipeline is synchronous CPU work end to end, and on the main thread it blocked every
 * request, the queue stream and the hardware renderer while a track analysed. The worker is
 * the plain Node source file in dev and a rolldown-built copy named by MV_INGEST_WORKER in
 * the bundled app; with neither present the in-process call remains, which is the behaviour
 * the app always had.
 *
 * One ingest at a time, wherever it was asked from. The queue runner already serialises its
 * own work, but the re-read route arrives independently, and two beat models at once are
 * slower than the same two in sequence - and racing writers on one track's cache files.
 */
let inFlight: Promise<unknown> = Promise.resolve();

export function ingestDetached(source: string, opts: IngestOptions = {}): Promise<IngestResult> {
	const run = inFlight.then(() => ingestInWorker(source, opts));
	// The chain must survive a rejection or every later ingest inherits the first failure.
	inFlight = run.catch(() => {});
	return run;
}

function ingestInWorker(source: string, opts: IngestOptions): Promise<IngestResult> {
	const bundled = process.env.MV_INGEST_WORKER;
	const workerPath =
		bundled && existsSync(bundled)
			? bundled
			: join(workspaceRoot(), 'packages', 'analysis', 'src', 'ingestWorker.ts');
	if (!existsSync(workerPath)) return ingest(source, opts);

	return new Promise((resolve, reject) => {
		const worker = new Worker(workerPath, {
			workerData: {
				source,
				// Only the serialisable options cross the boundary; progress comes back as messages.
				opts: { force: opts.force, metricalLevel: opts.metricalLevel, artwork: opts.artwork }
			},
			// Workers inherit the parent's node flags by default, and flags meant for the
			// server (an inspector port, an eval input mode) break or collide in the child.
			execArgv: []
		});
		let sawMessage = false;
		let settled = false;
		const finish = (act: () => void) => {
			if (settled) return;
			settled = true;
			act();
			void worker.terminate();
		};
		worker.on('message', (m: { type: string; stage?: string; result?: IngestResult; message?: string }) => {
			sawMessage = true;
			if (m.type === 'progress' && m.stage) opts.onProgress?.(m.stage);
			else if (m.type === 'done' && m.result) finish(() => resolve(m.result as IngestResult));
			else if (m.type === 'error') finish(() => reject(new Error(m.message ?? 'ingest failed')));
		});
		// A worker that dies before its first message never started the pipeline - a build
		// whose worker file exists but cannot load, for instance - and the only wrong answer
		// there is failing every ingest forever. Fall back to in-process, once, exactly as if
		// the file had been missing. After the first message the pipeline is genuinely
		// running and a crash is a real error to surface.
		worker.on('error', (e) => {
			if (!sawMessage) finish(() => resolve(ingest(source, opts)));
			else finish(() => reject(e));
		});
		worker.on('exit', (code) => {
			if (settled) return;
			if (!sawMessage) finish(() => resolve(ingest(source, opts)));
			else finish(() => reject(new Error(`ingest worker exited with code ${code}`)));
		});
	});
}
