import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { availableParallelism } from 'node:os';
import { loadCorpus } from './corpus.ts';
import type { TrackResult } from './worker.ts';

/**
 * Score the analyser against the annotated corpus.
 *
 * Usage:
 *   node bench/run.ts                    every dataset, every metric
 *   node bench/run.ts --fast             tempo and beats only, from cached onset curves
 *   node bench/run.ts --dataset gtzan    one dataset
 *   node bench/run.ts --label before     tag the saved report, so two runs can be diffed
 *   node bench/run.ts --diff before      print the delta against a saved report
 */

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
	const i = argv.indexOf(`--${name}`);
	return i >= 0 ? argv[i + 1] : undefined;
};
const has = (name: string) => argv.includes(`--${name}`);

const fast = has('fast');
const dataset = flag('dataset') ?? 'all';
const label = flag('label') ?? 'latest';
const diffAgainst = flag('diff');

const REPORT_DIR = join(import.meta.dirname, 'reports');

const corpus = loadCorpus(dataset === 'all' ? undefined : (dataset as 'gtzan' | 'giantsteps'));
if (corpus.length === 0) {
	console.error('empty corpus: run bench/fetch.sh first');
	process.exit(1);
}

const shards = Math.max(1, Math.min(availableParallelism() - 1, 8));
console.error(
	`${corpus.length} tracks, ${shards} shards, mode=${fast ? 'fast' : 'full'}, dataset=${dataset}`
);

const started = performance.now();
let done = 0;

const results = await Promise.all(
	Array.from({ length: shards }, (_, s) => runShard(s))
).then((r) => r.flat());

function runShard(s: number): Promise<TrackResult[]> {
	return new Promise((resolve, reject) => {
		const child = spawn(
			process.execPath,
			[join(import.meta.dirname, 'worker.ts'), String(s), String(shards), fast ? 'fast' : 'full', dataset],
			{ stdio: ['ignore', 'pipe', 'inherit'] }
		);
		const out: TrackResult[] = [];
		let buffer = '';
		child.stdout.on('data', (chunk: Buffer) => {
			buffer += chunk.toString();
			let nl: number;
			while ((nl = buffer.indexOf('\n')) >= 0) {
				const line = buffer.slice(0, nl);
				buffer = buffer.slice(nl + 1);
				if (!line.trim()) continue;
				const parsed = JSON.parse(line) as TrackResult & { error?: string };
				if (parsed.error) console.error(`  ${parsed.key}: ${parsed.error}`);
				else out.push(parsed);
				done++;
				if (done % 25 === 0) {
					const rate = done / ((performance.now() - started) / 1000);
					const eta = (corpus.length - done) / rate;
					console.error(`  ${done}/${corpus.length}  ${rate.toFixed(1)}/s  eta ${eta.toFixed(0)}s`);
				}
			}
		});
		child.on('error', reject);
		child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`shard ${s} exited ${code}`))));
	});
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (xs: boolean[]) => (xs.length ? xs.filter(Boolean).length / xs.length : 0);

interface Summary {
	label: string;
	when: string;
	tracks: number;
	acc1: number;
	acc2: number;
	acc1Gtzan: number;
	acc2Gtzan: number;
	acc1GiantSteps: number;
	acc2GiantSteps: number;
	beatF: number;
	cmlT: number;
	amlT: number;
	downbeatF: number;
	meter: number;
	nonConstant: number;
	meanConfidence: number;
	secondsPerTrack: number;
}

const gtzan = results.filter((r) => r.dataset === 'gtzan');
const gs = results.filter((r) => r.dataset === 'giantsteps');
const withBeats = results.filter((r) => r.beatF !== null);
const withDownbeats = results.filter((r) => r.downbeatF !== null);
const withMeter = results.filter((r) => r.meterOk !== null);

const summary: Summary = {
	label,
	when: new Date().toISOString(),
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
	downbeatF: mean(withDownbeats.map((r) => r.downbeatF!)),
	meter: pct(withMeter.map((r) => r.meterOk!)),
	nonConstant: pct(results.map((r) => !r.constant)),
	meanConfidence: mean(results.map((r) => r.confidence)),
	secondsPerTrack: mean(results.map((r) => r.ms)) / 1000
};

mkdirSync(REPORT_DIR, { recursive: true });
writeFileSync(
	join(REPORT_DIR, `${label}.json`),
	JSON.stringify({ summary, results: results.sort((a, b) => a.key.localeCompare(b.key)) }, null, '\t')
);

type MetricKey = keyof Omit<Summary, 'label' | 'when' | 'tracks' | 'secondsPerTrack'>;

const rows: [MetricKey, string, string][] = [
	['acc1', 'tempo Acc1 (all)', `${results.length} tracks`],
	['acc2', 'tempo Acc2 (all)', ''],
	['acc1Gtzan', 'tempo Acc1 (gtzan)', `${gtzan.length}`],
	['acc2Gtzan', 'tempo Acc2 (gtzan)', ''],
	['acc1GiantSteps', 'tempo Acc1 (giantsteps)', `${gs.length}`],
	['acc2GiantSteps', 'tempo Acc2 (giantsteps)', ''],
	['beatF', 'beat F', `${withBeats.length}`],
	['cmlT', 'beat CMLt', ''],
	['amlT', 'beat AMLt', ''],
	['downbeatF', 'downbeat F', `${withDownbeats.length}`],
	['meter', 'meter correct', `${withMeter.length}`],
	['nonConstant', 'reported non-constant', ''],
	['meanConfidence', 'mean confidence', '']
];

console.log(`\n=== ${label} ===`);
for (const [key, name, note] of rows) {
	console.log(`${name.padEnd(26)} ${(summary[key] * 100).toFixed(1).padStart(6)}%  ${note}`);
}
console.log(`${'wall clock per track'.padEnd(26)} ${summary.secondsPerTrack.toFixed(2).padStart(6)}s`);

if (diffAgainst) {
	const before = JSON.parse(
		readFileSync(join(REPORT_DIR, `${diffAgainst}.json`), 'utf8')
	) as { summary: Summary };
	console.log(`\n=== delta vs ${diffAgainst} ===`);
	for (const [key, name] of rows) {
		const was = before.summary[key];
		if (typeof was !== 'number') continue;
		const d = (summary[key] - was) * 100;
		console.log(`${name.padEnd(26)} ${d >= 0 ? '+' : ''}${d.toFixed(1)}pp`);
	}
}
