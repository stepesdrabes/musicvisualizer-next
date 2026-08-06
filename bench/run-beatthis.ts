import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeAudio } from '@mv/analysis';
import { loadCorpus, type Dataset } from './corpus.ts';
import { scoreBeats, tempoAccuracy } from './metrics.ts';
import { BeatThis, meterFrom, tempoFrom } from './beatthis.ts';

/**
 * Score Beat This! against the same corpus and the same metrics as the in-repo analyser, so
 * the two numbers can be put side by side without an asterisk.
 *
 *   node bench/run-beatthis.ts                 every dataset
 *   node bench/run-beatthis.ts --dataset gtzan
 *   node bench/run-beatthis.ts --shard 0 3     one shard, NDJSON on stdout
 */

const argv = process.argv.slice(2);
const flagAt = argv.indexOf('--shard');
const dsAt = argv.indexOf('--dataset');
const dataset = (dsAt >= 0 ? argv[dsAt + 1] : 'all') as Dataset | 'all';

interface Row {
	key: string;
	dataset: string;
	beatF: number | null;
	cmlT: number | null;
	amlT: number | null;
	downbeatF: number | null;
	meter: number;
	refMeter: number;
	meterOk: boolean | null;
	bpm: number;
	refBpm: number;
	acc1: boolean;
	acc2: boolean;
	ms: number;
}

if (flagAt >= 0) {
	const shard = Number(argv[flagAt + 1]);
	const shards = Number(argv[flagAt + 2]);
	const model = await BeatThis.create();
	const corpus = loadCorpus(dataset === 'all' ? undefined : dataset).filter(
		(_, i) => i % shards === shard
	);
	for (const ref of corpus) {
		try {
			const t0 = performance.now();
			const audio = await decodeAudio(ref.audio);
			const r = await model.run(audio.mono);
			const bpm = tempoFrom(r.beats);
			const meter = meterFrom(r.beats, r.downbeats);
			const beats = ref.beats.length > 0 ? scoreBeats(ref.beats, r.beats) : null;
			const tempo = tempoAccuracy(ref.bpm, bpm);
			const row: Row = {
				key: ref.key,
				dataset: ref.dataset,
				beatF: beats?.f ?? null,
				cmlT: beats?.cmlT ?? null,
				amlT: beats?.amlT ?? null,
				downbeatF: ref.downbeats.length > 0 ? scoreBeats(ref.downbeats, r.downbeats).f : null,
				meter,
				refMeter: ref.beatsPerBar,
				meterOk: ref.beatsPerBar > 0 ? meter === ref.beatsPerBar : null,
				bpm,
				refBpm: ref.bpm,
				acc1: tempo.acc1,
				acc2: tempo.acc2,
				ms: performance.now() - t0
			};
			process.stdout.write(`${JSON.stringify(row)}\n`);
		} catch (e) {
			process.stdout.write(`${JSON.stringify({ key: ref.key, error: String(e) })}\n`);
		}
	}
} else {
	// onnxruntime is already multi-threaded inside a call, so oversubscribing the cores makes
	// every shard slower than running fewer, and makes the machine unusable meanwhile.
	const shardAt2 = argv.indexOf('--shards');
	const shards = shardAt2 >= 0 ? Number(argv[shardAt2 + 1]) : 2;
	const corpus = loadCorpus(dataset === 'all' ? undefined : dataset);
	console.error(`${corpus.length} tracks, ${shards} shards, beat-this`);
	const started = performance.now();
	let done = 0;

	const run = (s: number): Promise<Row[]> =>
		new Promise((resolve, reject) => {
			const child = spawn(
				process.execPath,
				[join(import.meta.dirname, 'run-beatthis.ts'), '--dataset', dataset, '--shard', String(s), String(shards)],
				{ stdio: ['ignore', 'pipe', 'inherit'] }
			);
			const out: Row[] = [];
			let buf = '';
			child.stdout.on('data', (c: Buffer) => {
				buf += c.toString();
				let nl: number;
				while ((nl = buf.indexOf('\n')) >= 0) {
					const line = buf.slice(0, nl);
					buf = buf.slice(nl + 1);
					if (!line.trim()) continue;
					const row = JSON.parse(line) as Row & { error?: string };
					if (row.error) console.error(`  ${row.key}: ${row.error.slice(0, 120)}`);
					else out.push(row);
					if (++done % 10 === 0) {
						const rate = done / ((performance.now() - started) / 1000);
						console.error(`  ${done}/${corpus.length}  ${rate.toFixed(2)}/s  eta ${((corpus.length - done) / rate).toFixed(0)}s`);
					}
				}
			});
			child.on('error', reject);
			child.on('close', (c) => (c === 0 ? resolve(out) : reject(new Error(`shard ${s} exited ${c}`))));
		});

	const results = (await Promise.all(Array.from({ length: shards }, (_, s) => run(s)))).flat();

	const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
	const pct = (xs: boolean[]) => (xs.length ? xs.filter(Boolean).length / xs.length : 0);
	const withBeats = results.filter((r) => r.beatF !== null);
	const withDb = results.filter((r) => r.downbeatF !== null);
	const withMeter = results.filter((r) => r.meterOk !== null);
	const gtzan = results.filter((r) => r.dataset === 'gtzan');
	const gs = results.filter((r) => r.dataset === 'giantsteps');

	const summary = {
		label: 'beat-this',
		tracks: results.length,
		acc1: pct(results.map((r) => r.acc1)),
		acc2: pct(results.map((r) => r.acc2)),
		acc1Gtzan: pct(gtzan.map((r) => r.acc1)),
		acc2Gtzan: pct(gtzan.map((r) => r.acc2)),
		acc1GiantSteps: pct(gs.map((r) => r.acc1)),
		acc2GiantSteps: pct(gs.map((r) => r.acc2)),
		beatF: mean(withBeats.map((r) => r.beatF!)),
		cmlT: mean(withBeats.map((r) => r.cmlT!)),
		amlT: mean(withBeats.map((r) => r.amlT!)),
		downbeatF: mean(withDb.map((r) => r.downbeatF!)),
		meter: pct(withMeter.map((r) => r.meterOk!)),
		secondsPerTrack: mean(results.map((r) => r.ms)) / 1000
	};

	const dir = join(import.meta.dirname, 'reports');
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, 'beat-this.json'), JSON.stringify({ summary, results }, null, '\t'));

	console.log('\n=== beat-this ===');
	for (const [k, v] of Object.entries(summary)) {
		if (typeof v !== 'number') continue;
		console.log(`${k.padEnd(20)} ${k === 'tracks' || k === 'secondsPerTrack' ? v.toFixed(2) : `${(v * 100).toFixed(1)}%`}`);
	}
}
