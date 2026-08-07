import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { decodeAudio } from '@mv/analysis';
import { extractFeatures } from '../packages/analysis/src/features.ts';
import { chromagram } from '../packages/analysis/src/chroma.ts';
import { detectBeats } from '../packages/analysis/src/beats.ts';
import { beatSynchronous, type BeatFeatures } from '../packages/analysis/src/beatsync.ts';
import { detectMeter } from '../packages/analysis/src/downbeats.ts';
import { measureLoudness } from '../packages/analysis/src/loudness.ts';
import { detectDrums } from '../packages/analysis/src/drums.ts';
import { quantiseOnsets } from '../packages/analysis/src/quantise.ts';
import { barSynchronous, type BarFeatures } from '../packages/analysis/src/structure.ts';
import { bandLevels } from '../packages/analysis/src/arrange.ts';
import { loadStructureCorpus, type StructureDataset } from './structure-corpus.ts';
import type { Segment } from './segment-metrics.ts';

/**
 * Freeze everything upstream of the segmenter so a structure sweep costs seconds, not minutes.
 *
 * A full SALAMI pass is 7.5 minutes and almost all of it is decode, spectrogram and beat
 * tracking, none of which any change to `structure.ts` or `arrange.ts` can touch. The bar
 * boundaries are fixed by the beat grid and the meter, so per-bar band energies are frozen
 * alongside the beat-synchronous rows rather than the spectrogram they came from, which is
 * two orders of magnitude smaller on disk.
 *
 *   node bench/struct-cache.ts [--dataset salami] [--shards 6]
 */

export const CACHE_DIR = join(import.meta.dirname, 'corpus', '.struct');

export interface StructCache {
	key: string;
	dataset: string;
	duration: number;
	beatsPerBar: number;
	phase: number;
	bf: BeatFeatures;
	/** barCount * NUM_BANDS, dB. */
	bandsDb: Float32Array;
	shortTerm: Float32Array;
	shortTermFps: number;
	kicks: Int32Array;
	snares: Int32Array;
	segments: Segment[][];
}

interface Header {
	key: string;
	dataset: string;
	duration: number;
	beatsPerBar: number;
	phase: number;
	count: number;
	bands: number;
	barCount: number;
	shortTermFps: number;
	shortTermLength: number;
	segments: Segment[][];
}

const F32 = ['spectral', 'chroma', 'flux', 'low', 'mid', 'high', 'rms', 'bass'] as const;

export function writeCache(c: StructCache): void {
	mkdirSync(CACHE_DIR, { recursive: true });
	const safe = c.key.replace(/[^a-z0-9]+/gi, '_');
	const header: Header = {
		key: c.key,
		dataset: c.dataset,
		duration: c.duration,
		beatsPerBar: c.beatsPerBar,
		phase: c.phase,
		count: c.bf.count,
		bands: c.bf.bands,
		barCount: c.kicks.length,
		shortTermFps: c.shortTermFps,
		shortTermLength: c.shortTerm.length,
		segments: c.segments
	};
	const parts: ArrayBufferView[] = [c.bf.time];
	for (const k of F32) parts.push(c.bf[k]);
	parts.push(c.bandsDb, c.shortTerm, c.kicks, c.snares);
	const total = parts.reduce((n, p) => n + p.byteLength, 0);
	const blob = Buffer.allocUnsafe(total);
	let at = 0;
	for (const p of parts) {
		Buffer.from(p.buffer, p.byteOffset, p.byteLength).copy(blob, at);
		at += p.byteLength;
	}
	writeFileSync(join(CACHE_DIR, `${safe}.json`), JSON.stringify(header));
	writeFileSync(join(CACHE_DIR, `${safe}.bin`), blob);
}

export function readCache(key: string): StructCache {
	const safe = key.replace(/[^a-z0-9]+/gi, '_');
	const header: Header = JSON.parse(readFileSync(join(CACHE_DIR, `${safe}.json`), 'utf8'));
	const blob = readFileSync(join(CACHE_DIR, `${safe}.bin`));
	let at = blob.byteOffset;
	const take = <T>(
		Ctor: { BYTES_PER_ELEMENT: number; new (b: ArrayBuffer, o: number, n: number): T },
		n: number
	): T => {
		const v = new Ctor(blob.buffer as ArrayBuffer, at, n);
		at += n * Ctor.BYTES_PER_ELEMENT;
		return v;
	};
	const time = take(Float64Array, header.count + 1);
	const bf = { count: header.count, bands: header.bands, time } as unknown as BeatFeatures;
	for (const k of F32) {
		(bf as unknown as Record<string, Float32Array>)[k] = take(
			Float32Array,
			k === 'spectral' ? header.count * header.bands : k === 'chroma' ? header.count * 12 : header.count
		);
	}
	const bandsDb = take(Float32Array, header.barCount * 4);
	const shortTerm = take(Float32Array, header.shortTermLength);
	const kicks = take(Int32Array, header.barCount);
	const snares = take(Int32Array, header.barCount);
	return {
		key: header.key,
		dataset: header.dataset,
		duration: header.duration,
		beatsPerBar: header.beatsPerBar,
		phase: header.phase,
		bf,
		bandsDb,
		shortTerm,
		shortTermFps: header.shortTermFps,
		kicks,
		snares,
		segments: header.segments
	};
}

export function cachedBars(c: StructCache): BarFeatures {
	return barSynchronous(c.bf, c.beatsPerBar, c.phase);
}

export function cacheIndex(): { key: string; dataset: string }[] {
	const path = join(CACHE_DIR, 'index.json');
	return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : [];
}

if (import.meta.filename === process.argv[1]) {
	const argv = process.argv.slice(2);
	const flag = (n: string) => {
		const i = argv.indexOf(`--${n}`);
		return i >= 0 ? argv[i + 1] : undefined;
	};
	const dataset = (flag('dataset') ?? 'salami') as StructureDataset;
	const shardAt = argv.indexOf('--shard');

	if (shardAt >= 0) {
		const shard = Number(argv[shardAt + 1]);
		const shards = Number(argv[shardAt + 2]);
		const corpus = loadStructureCorpus(dataset).filter((_, i) => i % shards === shard);
		for (const ref of corpus) {
			try {
				const audio = await decodeAudio(ref.audio);
				const loud = measureLoudness(audio.mono, audio.sampleRate);
				const mono = Float32Array.from(audio.mono);
				const gain = Math.pow(10, (-14 - loud.integrated) / 20);
				if (Number.isFinite(gain) && Math.abs(gain - 1) > 0.01) {
					const g = Math.min(gain, 40);
					for (let i = 0; i < mono.length; i++) mono[i] *= g;
				}
				const f = extractFeatures(mono, audio.sampleRate);
				const ch = chromagram(mono, audio.sampleRate);
				const grid = detectBeats(f.odf, f.curves.fps, audio.duration, {});
				const bf = beatSynchronous(f.spec, ch, f.curves, f.odf, grid.beats, audio.duration);
				const meter = detectMeter(bf);
				const bars = barSynchronous(bf, meter.beatsPerBar, meter.phase);

				const det = detectDrums(f.spec, { beatPeriod: grid.beatPeriod, odf: f.odf });
				const q = (t: number[]) =>
					quantiseOnsets(t, {
						beats: grid.beats,
						beatsPerBar: meter.beatsPerBar,
						downbeatPhase: meter.phase,
						duration: audio.duration
					}).times;
				const perBar = (times: readonly number[]) => {
					const out = new Int32Array(bars.count);
					for (const t of times) {
						for (let b = 0; b < bars.count; b++) {
							if (t >= bars.time[b] && t < bars.time[b + 1]) {
								out[b]++;
								break;
							}
						}
					}
					return out;
				};

				writeCache({
					key: ref.key,
					dataset: ref.dataset,
					duration: audio.duration,
					beatsPerBar: meter.beatsPerBar,
					phase: meter.phase,
					bf,
					bandsDb: bandLevels(f.spec, bars.time, bars.count),
					shortTerm: loud.shortTerm,
					shortTermFps: loud.shortTermFps,
					kicks: perBar(q(det.kick)),
					snares: perBar(q(det.snare)),
					segments: ref.segments
				});
				process.stdout.write(`${JSON.stringify({ key: ref.key, dataset: ref.dataset })}\n`);
			} catch (e) {
				process.stderr.write(`skip ${ref.key}: ${String(e).slice(0, 120)}\n`);
			}
		}
	} else {
		const shards = Number(flag('shards') ?? 6);
		const corpus = loadStructureCorpus(dataset);
		console.error(`${corpus.length} tracks, ${shards} shards, caching structure inputs`);
		const started = performance.now();
		let done = 0;
		const index: { key: string; dataset: string }[] = [];

		const run = (s: number) =>
			new Promise<void>((resolve, reject) => {
				const child = spawn(
					process.execPath,
					[import.meta.filename, '--dataset', dataset, '--shard', String(s), String(shards)],
					{ stdio: ['ignore', 'pipe', 'inherit'] }
				);
				let buf = '';
				child.stdout.on('data', (c: Buffer) => {
					buf += c.toString();
					let nl: number;
					while ((nl = buf.indexOf('\n')) >= 0) {
						const line = buf.slice(0, nl);
						buf = buf.slice(nl + 1);
						if (!line.trim()) continue;
						index.push(JSON.parse(line));
						if (++done % 25 === 0) {
							const rate = done / ((performance.now() - started) / 1000);
							console.error(`  ${done}/${corpus.length}  eta ${((corpus.length - done) / rate).toFixed(0)}s`);
						}
					}
				});
				child.on('error', reject);
				child.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`shard ${s} exited ${c}`))));
			});

		await Promise.all(Array.from({ length: shards }, (_, s) => run(s)));
		index.sort((a, b) => a.key.localeCompare(b.key));
		writeFileSync(join(CACHE_DIR, 'index.json'), JSON.stringify(index));
		console.error(`cached ${index.length} tracks in ${((performance.now() - started) / 1000).toFixed(0)}s`);
	}
}
