import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { CACHE_DIR } from './paths.ts';
import { createHash } from 'node:crypto';
import type { TrackAnalysis } from '@mv/core';
import { ANALYSIS_VERSION } from '@mv/core';
import { analyzeTrack } from './analyze.ts';
import { artworkHue } from './artwork.ts';
import { decodeAudio, downloadAudio, probe } from './decode.ts';

const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const LOCAL_ID = /^file-[a-f0-9]{12}$/;

export function isValidId(id: string): boolean {
	return YT_ID.test(id) || LOCAL_ID.test(id);
}

function assertId(id: string): void {
	if (!isValidId(id)) throw new Error(`Invalid track id: ${id}`);
}

export function analysisPath(id: string): string {
	assertId(id);
	return join(CACHE_DIR, `${id}.analysis.json`);
}

export function showPath(id: string): string {
	assertId(id);
	return join(CACHE_DIR, `${id}.show.json`);
}

function metaPath(id: string): string {
	assertId(id);
	return join(CACHE_DIR, `${id}.meta.json`);
}

/** Presentation metadata, kept out of TrackAnalysis, which is analysis only. */
export interface TrackMeta {
	id: string;
	title: string;
	uploader: string;
	thumbnail: string;
	webpageUrl: string;
	source: string;
	/**
	 * Dominant hue of the cover, degrees, or null when it has no colour worth taking. Cached
	 * here because it is a property of the artwork rather than of the audio, so re-analysing
	 * the track should not re-download the image.
	 */
	artHue?: number | null;
}

export async function readMeta(id: string): Promise<TrackMeta | null> {
	try {
		return JSON.parse(await readFile(metaPath(id), 'utf8')) as TrackMeta;
	} catch {
		return null;
	}
}

/** The cached audio for a track, whatever container yt-dlp settled on. */
export async function findAudioFile(id: string): Promise<string | null> {
	assertId(id);
	if (!existsSync(CACHE_DIR)) return null;
	const files = await readdir(CACHE_DIR);
	const hit = files.find((f) => f.startsWith(`${id}.`) && !f.includes('.json'));
	return hit ? join(CACHE_DIR, hit) : null;
}

export interface IngestResult {
	id: string;
	audioPath: string;
	analysis: TrackAnalysis;
	meta: TrackMeta;
	fromCache: boolean;
}

export interface IngestOptions {
	/** Re-analyse even when a current cached analysis exists. */
	force?: boolean;
	/**
	 * Re-read the beats at a different metrical level: 2 doubles, 0.5 halves, 1.5 reads three
	 * where the tracker read two. Implies `force`, since the cached grid is what is being
	 * disagreed with.
	 */
	metricalLevel?: number;
	onProgress?: (stage: string) => void;
}

/** A YouTube URL or a local audio file path. */
export async function ingest(source: string, opts: IngestOptions = {}): Promise<IngestResult> {
	const log = opts.onProgress ?? (() => {});
	await mkdir(CACHE_DIR, { recursive: true });

	let id: string;
	let title: string;
	let audioPath: string | null;
	let meta: TrackMeta;

	if (/^https?:\/\//.test(source)) {
		log('resolving');
		const probed = await probe(source);
		id = probed.id;
		title = probed.title;
		assertId(id);
		meta = {
			id,
			title,
			uploader: probed.uploader,
			thumbnail: probed.thumbnail,
			webpageUrl: probed.webpageUrl,
			source
		};
		audioPath = await findAudioFile(id);
		if (!audioPath) {
			log('downloading');
			await downloadAudio(source, join(CACHE_DIR, `${id}.%(ext)s`));
			audioPath = await findAudioFile(id);
			if (!audioPath) throw new Error('yt-dlp reported success but wrote no audio file');
		}
	} else {
		const original = resolve(source);
		if (!existsSync(original)) throw new Error(`No such file: ${original}`);
		const hash = createHash('sha256').update(original).digest('hex').slice(0, 12);
		id = `file-${hash}`;
		title = basename(original, extname(original));

		// Copy into the cache rather than referencing in place, so every artifact for a track
		// lives in one directory and the audio route can serve local files the same way it
		// serves downloads.
		audioPath = join(CACHE_DIR, `${id}${extname(original)}`);
		if (!existsSync(audioPath)) await copyFile(original, audioPath);

		meta = { id, title, uploader: 'local file', thumbnail: '', webpageUrl: '', source };
	}

	// Read from the previous meta rather than re-fetched: the image has not changed and the
	// network is the slowest thing in this function.
	const previous = await readMeta(id);
	meta.artHue =
		previous?.artHue !== undefined
			? previous.artHue
			: ((await artworkHue(meta.thumbnail)).hue ?? null);
	await writeFile(metaPath(id), JSON.stringify(meta, null, '\t'));

	const relevel = opts.metricalLevel !== undefined && Math.abs(opts.metricalLevel - 1) > 1e-6;
	if (!opts.force && !relevel) {
		try {
			const cached = JSON.parse(await readFile(analysisPath(id), 'utf8')) as TrackAnalysis;
			// A stale blob is silently wrong rather than obviously broken: same shape, different
			// meaning. Version mismatch has to discard it.
			if (cached.version === ANALYSIS_VERSION) {
				log('cached');
				return { id, audioPath, analysis: cached, meta, fromCache: true };
			}
		} catch {
			// No cache, or unreadable. Fall through and analyse.
		}
	}

	log('decoding');
	const decoded = await decodeAudio(audioPath);

	// The model finds the beats; everything after it is unchanged. If the weights are missing
	// or the graph fails, the in-repo tracker runs instead: a worse grid is a worse show, a
	// crash here is no show at all.
	let tracked: { beats: number[]; downbeats: number[] } | null = null;
	try {
		log('tracking beats');
		const { BeatThis } = await import('./beatthis.ts');
		const model = await BeatThis.create();
		try {
			tracked = await model.run(decoded.mono);
		} finally {
			await model.close();
		}
	} catch (e) {
		log(`beat model unavailable, falling back: ${e instanceof Error ? e.message : String(e)}`);
	}

	log('analysing');
	const analysis = analyzeTrack({
		mono: decoded.mono,
		left: decoded.left,
		right: decoded.right,
		sampleRate: decoded.sampleRate,
		duration: decoded.duration,
		hash: decoded.hash,
		trackId: id,
		title,
		beats: tracked?.beats,
		downbeats: tracked?.downbeats,
		metricalLevel: opts.metricalLevel
	});

	await writeFile(analysisPath(id), JSON.stringify(analysis, null, '\t'));
	return { id, audioPath, analysis, meta, fromCache: false };
}
