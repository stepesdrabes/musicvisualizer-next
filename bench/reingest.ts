import { spawn } from 'node:child_process';
import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { availableParallelism } from 'node:os';
import { analysisPath, analyzeTrack, decodeAudio, showPath } from '@mv/analysis';
import { composeShow } from '@mv/author-engine';

/**
 * Re-analyse and re-compose every cached track, keeping its id.
 *
 * The app is the only entry point in the product, but a contract change invalidates every
 * cached blob at once and clicking through nineteen tracks to see whether a flash moved is not
 * a measurement. This does what the ingest route does from `decodeAudio` onward, and
 * deliberately not `ingest()` itself: that treats a path as a new local file and re-keys the
 * track by the hash of the path, which writes a duplicate under a different id.
 *
 *   node bench/reingest.ts [--shards 2]
 */
const CACHE = join(import.meta.dirname, '..', 'cache');
const AUDIO = /\.(m4a|webm|opus|mp3|wav)$/;
const argv = process.argv.slice(2);
const flag = (n: string) => {
	const i = argv.indexOf(`--${n}`);
	return i >= 0 ? argv[i + 1] : undefined;
};

const files = readdirSync(CACHE).filter((f) => AUDIO.test(f));
const shardAt = argv.indexOf('--shard');

if (shardAt >= 0) {
	const shard = Number(argv[shardAt + 1]);
	const shards = Number(argv[shardAt + 2]);

	// The model is loaded once per shard, not once per track: the graph is 79 MB and building a
	// session for each of nineteen tracks costs more than the inference does.
	let model: { run(mono: Float32Array): Promise<{ beats: number[]; downbeats: number[] }>; close(): Promise<void> } | null = null;
	try {
		const { BeatThis } = await import('../packages/analysis/src/beatthis.ts');
		model = await BeatThis.create();
	} catch (e) {
		process.stderr.write(`beat model unavailable, falling back: ${String(e).slice(0, 120)}\n`);
	}

	try {
		for (const [i, file] of files.entries()) {
			if (i % shards !== shard) continue;
			const id = file.replace(AUDIO, '');
			try {
				const decoded = await decodeAudio(join(CACHE, file));
				const tracked = model ? await model.run(decoded.mono) : null;
				const analysis = analyzeTrack({
					mono: decoded.mono,
					left: decoded.left,
					right: decoded.right,
					sampleRate: decoded.sampleRate,
					duration: decoded.duration,
					hash: decoded.hash,
					trackId: id,
					title: id,
					beats: tracked?.beats,
					downbeats: tracked?.downbeats
				});
				writeFileSync(analysisPath(id), JSON.stringify(analysis, null, '\t'));
				writeFileSync(showPath(id), JSON.stringify(composeShow(analysis), null, '\t'));
				process.stdout.write(
					`${id.padEnd(20)} ${String(analysis.sections.length).padStart(3)} sections  ${String(analysis.onsets.kick.times.length).padStart(5)} kicks\n`
				);
			} catch (e) {
				process.stdout.write(`${id.padEnd(20)} FAILED ${String(e).slice(0, 140)}\n`);
			}
		}
	} finally {
		await model?.close();
	}
} else {
	// The beat model saturates every core on its own, so two at a time is the ceiling that keeps
	// the machine responsive and the wall clock meaningful.
	const shards = Number(flag('shards') ?? Math.min(2, Math.max(1, availableParallelism() - 6)));
	console.error(`${files.length} tracks, ${shards} shards`);
	await Promise.all(
		Array.from(
			{ length: shards },
			(_, s) =>
				new Promise<void>((resolve, reject) => {
					const child = spawn(
						process.execPath,
						[import.meta.filename, '--shard', String(s), String(shards)],
						{ stdio: ['ignore', 'inherit', 'inherit'], env: process.env }
					);
					child.on('error', reject);
					child.on('close', (c) =>
						c === 0 ? resolve() : reject(new Error(`shard ${s} exited ${c}`))
					);
				})
		)
	);
}
