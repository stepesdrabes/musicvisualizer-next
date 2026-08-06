import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { TrackAnalysis } from '@mv/core';
import { ANALYSIS_VERSION } from '@mv/core';
import { analyzeTrack } from './analyze.ts';
import { decodeAudio, downloadAudio, probe } from './decode.ts';

/**
 * Anchored to the workspace root, not to cwd. The dev server runs from apps/web, so a
 * cwd-relative cache would put its artifacts somewhere else and re-download everything.
 */
function workspaceRoot(): string {
	let dir = import.meta.dirname;
	for (let i = 0; i < 8; i++) {
		try {
			const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
				workspaces?: unknown;
			};
			if (pkg.workspaces) return dir;
		} catch {
			// Keep walking.
		}
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return process.cwd();
}

export const CACHE_DIR = process.env.MV_CACHE_DIR
	? resolve(process.env.MV_CACHE_DIR)
	: join(workspaceRoot(), 'cache');

// Guards every path built from an id, so a crafted id cannot escape the cache directory.
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

	await writeFile(metaPath(id), JSON.stringify(meta, null, '\t'));

	if (!opts.force) {
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

	log('analysing');
	const analysis = analyzeTrack({
		mono: decoded.mono,
		left: decoded.left,
		right: decoded.right,
		sampleRate: decoded.sampleRate,
		duration: decoded.duration,
		hash: decoded.hash,
		trackId: id,
		title
	});

	await writeFile(analysisPath(id), JSON.stringify(analysis, null, '\t'));
	return { id, audioPath, analysis, meta, fromCache: false };
}
