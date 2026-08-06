import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeAudio } from '@mv/analysis';
import { extractFeatures } from '../packages/analysis/src/features.ts';
import { chromagram } from '../packages/analysis/src/chroma.ts';
import { detectBeats } from '../packages/analysis/src/beats.ts';
import { beatSynchronous } from '../packages/analysis/src/beatsync.ts';
import { detectMeter } from '../packages/analysis/src/downbeats.ts';
import { CORPUS_DIR, loadCorpus, type Reference } from './corpus.ts';
import { scoreBeats, tempoAccuracy } from './metrics.ts';

/**
 * One shard of the corpus, evaluated and written to stdout as NDJSON.
 *
 * A separate process per shard rather than worker threads: the analysis allocates hundreds of
 * megabytes per track and a process boundary is what stops one long track's peak from being
 * every shard's peak.
 */

const CACHE_DIR = join(CORPUS_DIR, '.feat');

interface CachedCurves {
	fps: number;
	duration: number;
	odf: Float32Array;
}

/**
 * The conditioned onset curve, cached to disk. Tempo and beat sweeps read nothing else, and
 * recomputing it costs a second a track, which is fifteen minutes across the corpus.
 */
function cachedCurves(ref: Reference, compute: () => CachedCurves): CachedCurves {
	mkdirSync(CACHE_DIR, { recursive: true });
	const path = join(CACHE_DIR, `${ref.key.replace('/', '_')}.f32`);
	if (existsSync(path)) {
		const buf = readFileSync(path);
		const head = new Float64Array(buf.buffer, buf.byteOffset, 2);
		const odf = new Float32Array(
			buf.buffer.slice(buf.byteOffset + 16, buf.byteOffset + buf.byteLength)
		);
		return { fps: head[0], duration: head[1], odf };
	}
	const v = compute();
	const out = Buffer.alloc(16 + v.odf.byteLength);
	out.writeDoubleLE(v.fps, 0);
	out.writeDoubleLE(v.duration, 8);
	Buffer.from(v.odf.buffer, v.odf.byteOffset, v.odf.byteLength).copy(out, 16);
	writeFileSync(path, out);
	return v;
}

/** Beats where the meter says a bar begins. */
function downbeatsOf(beats: Float64Array, beatsPerBar: number, phase: number): number[] {
	const out: number[] = [];
	for (let i = phase; i < beats.length; i += beatsPerBar) out.push(beats[i]);
	return out;
}

export interface TrackResult {
	key: string;
	dataset: string;
	bpm: number;
	refBpm: number;
	acc1: boolean;
	acc2: boolean;
	constant: boolean;
	confidence: number;
	beatsPerBar: number;
	refBeatsPerBar: number;
	meterOk: boolean | null;
	beatF: number | null;
	cmlT: number | null;
	amlT: number | null;
	downbeatF: number | null;
	ms: number;
}

async function evaluate(ref: Reference, full: boolean): Promise<TrackResult> {
	const t0 = performance.now();

	let curves: CachedCurves;
	let meterOk: boolean | null = null;
	let beatsPerBar = 0;
	let downbeatF: number | null = null;
	let grid: ReturnType<typeof detectBeats>;

	if (full) {
		const audio = await decodeAudio(ref.audio);
		const features = extractFeatures(audio.mono, audio.sampleRate);
		curves = { fps: features.curves.fps, duration: audio.duration, odf: features.odf };
		cachedCurves(ref, () => curves);
		grid = detectBeats(curves.odf, curves.fps, curves.duration, {});

		const chroma = chromagram(audio.mono, audio.sampleRate);
		const bf = beatSynchronous(
			features.spec,
			chroma,
			features.curves,
			features.odf,
			grid.beats,
			audio.duration
		);
		const meter = detectMeter(bf);
		beatsPerBar = meter.beatsPerBar;
		if (ref.beatsPerBar > 0) meterOk = meter.beatsPerBar === ref.beatsPerBar;
		if (ref.downbeats.length > 0) {
			downbeatF = scoreBeats(
				ref.downbeats,
				downbeatsOf(grid.beats, meter.beatsPerBar, meter.phase)
			).f;
		}
	} else {
		curves = cachedCurves(ref, () => {
			throw new Error(`no cached curves for ${ref.key}; run once without --fast`);
		});
		grid = detectBeats(curves.odf, curves.fps, curves.duration, {});
	}

	const tempo = tempoAccuracy(ref.bpm, grid.bpm);
	const beatScores =
		ref.beats.length > 0 ? scoreBeats(ref.beats, Array.from(grid.beats)) : null;

	return {
		key: ref.key,
		dataset: ref.dataset,
		bpm: grid.bpm,
		refBpm: ref.bpm,
		acc1: tempo.acc1,
		acc2: tempo.acc2,
		constant: grid.constant,
		confidence: grid.confidence,
		beatsPerBar,
		refBeatsPerBar: ref.beatsPerBar,
		meterOk,
		beatF: beatScores?.f ?? null,
		cmlT: beatScores?.cmlT ?? null,
		amlT: beatScores?.amlT ?? null,
		downbeatF,
		ms: performance.now() - t0
	};
}

const shard = Number(process.argv[2]);
const shards = Number(process.argv[3]);
const full = process.argv[4] !== 'fast';
const dataset = process.argv[5] === 'all' ? undefined : (process.argv[5] as 'gtzan' | 'giantsteps');

const corpus = loadCorpus(dataset).filter((_, i) => i % shards === shard);
for (const ref of corpus) {
	try {
		process.stdout.write(`${JSON.stringify(await evaluate(ref, full))}\n`);
	} catch (e) {
		process.stdout.write(
			`${JSON.stringify({ key: ref.key, dataset: ref.dataset, error: String(e) })}\n`
		);
	}
}
