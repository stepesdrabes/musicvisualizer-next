import { open, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { GenreFamily } from '@mv/core';
import { ANALYSIS_VERSION, SHOW_VERSION } from '@mv/core';
import { CACHE_DIR } from './paths.ts';
import type { TrackMeta } from './ingest.ts';

/**
 * Recover a field from the head of an analysis without parsing it.
 *
 * The analyses are around 400 kB each, so this reads the first couple of kilobytes:
 * `version` and `duration` are both written within the first few lines, whatever the key
 * order, and that is enough to know whether a blob is current without opening it.
 */
async function headOfAnalysis(
	path: string
): Promise<{ duration: number | null; version: number | null }> {
	let handle;
	try {
		handle = await open(path, 'r');
		const buffer = Buffer.alloc(2048);
		const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
		const head = buffer.subarray(0, bytesRead).toString('utf8');
		const num = (key: string) => {
			const match = new RegExp(`"${key}"\\s*:\\s*([0-9.]+)`).exec(head);
			const value = match ? Number(match[1]) : Number.NaN;
			return Number.isFinite(value) && value > 0 ? value : null;
		};
		return { duration: num('duration'), version: num('version') };
	} catch {
		return { duration: null, version: null };
	} finally {
		await handle?.close();
	}
}

export interface LibraryEntry extends TrackMeta {
	/** An analysis exists, so this track loads without touching the network. */
	analysed: boolean;
	/**
	 * The cached artifacts are the versions this build writes, so the track may play as-is.
	 * False means a queue row must go through prepare again - a stale analysis is silently
	 * wrong rather than obviously broken, and a stale engine show never hears an engine fix.
	 * A model-authored show is exempt from the show half: it is kept across versions on
	 * purpose, being the one artifact money was spent on.
	 */
	current: boolean;
	authored: 'none' | 'engine' | 'claude' | 'deepseek';
	/** The lighting family, once something has listened to the track. Null until enriched. */
	genreFamily: GenreFamily | null;
	/** When the track was last ingested or authored, for ordering by recency. */
	updatedAt: number;
}

/**
 * The family the enrichment settled on.
 *
 * From the context rather than the analysis: the analysis is around 400 kB and does not carry
 * a genre at all, while the context is a few kB and is the only place it lives.
 */
async function readGenre(path: string): Promise<GenreFamily | null> {
	try {
		const raw = await readFile(path, 'utf8');
		return (JSON.parse(raw) as { genreFamily?: GenreFamily | null }).genreFamily ?? null;
	} catch {
		return null;
	}
}

interface ShowStamp {
	authored: 'engine' | 'claude' | 'deepseek';
	version: number;
	updatedAt: number;
}

/**
 * Which of the two authors wrote a show, and which model if it was the agent.
 *
 * Shows carry `authoredBy` from this version on; anything written before it is judged by
 * whether it has effects of its own, which only the agent produces. That fallback cannot name
 * a backend, so it answers `claude`: DeepSeek postdates every show old enough to need it.
 */
async function readShowStamp(path: string): Promise<ShowStamp | null> {
	try {
		const [raw, info] = await Promise.all([readFile(path, 'utf8'), stat(path)]);
		const show = JSON.parse(raw) as {
			authoredBy?: 'engine' | 'claude' | 'deepseek';
			generatedEffects?: unknown[];
			version?: number;
		};
		const authored =
			show.authoredBy ?? ((show.generatedEffects?.length ?? 0) > 0 ? 'claude' : 'engine');
		return { authored, version: show.version ?? 0, updatedAt: info.mtimeMs };
	} catch {
		return null;
	}
}

/**
 * Everything already in the cache, newest first.
 *
 * Reads the meta files and stats the rest. The analyses are around 400 kB each and the only
 * thing this panel wants from them is a duration, which now lives in the meta.
 */
export async function readLibrary(): Promise<LibraryEntry[]> {
	if (!existsSync(CACHE_DIR)) return [];
	const files = await readdir(CACHE_DIR);
	const ids = files.filter((f) => f.endsWith('.meta.json')).map((f) => f.slice(0, -'.meta.json'.length));

	const entries = await Promise.all(
		ids.map(async (id): Promise<LibraryEntry | null> => {
			let meta: TrackMeta;
			let metaStat: Awaited<ReturnType<typeof stat>>;
			try {
				const path = join(CACHE_DIR, `${id}.meta.json`);
				const [raw, info] = await Promise.all([readFile(path, 'utf8'), stat(path)]);
				meta = JSON.parse(raw) as TrackMeta;
				metaStat = info;
			} catch {
				return null;
			}

			const analysisFile = join(CACHE_DIR, `${id}.analysis.json`);
			const analysed = existsSync(analysisFile);
			const head = analysed
				? await headOfAnalysis(analysisFile)
				: { duration: null, version: null };

			// Written back rather than recovered on every listing, so the repair happens once per
			// track and the next read is as cheap as any other.
			if (!meta.duration && head.duration !== null) {
				meta = { ...meta, duration: head.duration };
				await writeFile(
					join(CACHE_DIR, `${id}.meta.json`),
					JSON.stringify(meta, null, '\t')
				).catch(() => {
					// A read-only cache still lists correctly; it just repairs itself each time.
				});
			}

			const [show, genreFamily] = await Promise.all([
				readShowStamp(join(CACHE_DIR, `${id}.show.json`)),
				readGenre(join(CACHE_DIR, `${id}.context.json`))
			]);
			return {
				...meta,
				analysed,
				current:
					head.version === ANALYSIS_VERSION &&
					show !== null &&
					(show.version === SHOW_VERSION || show.authored !== 'engine'),
				authored: show?.authored ?? 'none',
				genreFamily,
				updatedAt: Math.max(metaStat.mtimeMs, show?.updatedAt ?? 0)
			};
		})
	);

	return entries
		.filter((e): e is LibraryEntry => e !== null)
		.sort((a, b) => b.updatedAt - a.updatedAt);
}
