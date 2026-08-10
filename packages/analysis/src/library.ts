import { open, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { CACHE_DIR } from './paths.ts';
import type { TrackMeta } from './ingest.ts';

/**
 * Recover a run time from an analysis without parsing it.
 *
 * Tracks analysed before the meta carried a duration would otherwise show none until they
 * were ingested again. The analyses are around 400 kB each, so this reads the head of the
 * file: `duration` is written within the first few lines, and a couple of kilobytes is
 * enough to find it whatever the key order.
 */
async function durationFromAnalysis(path: string): Promise<number | null> {
	let handle;
	try {
		handle = await open(path, 'r');
		const buffer = Buffer.alloc(2048);
		const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
		const match = /"duration"\s*:\s*([0-9.]+)/.exec(buffer.subarray(0, bytesRead).toString('utf8'));
		const value = match ? Number(match[1]) : Number.NaN;
		return Number.isFinite(value) && value > 0 ? value : null;
	} catch {
		return null;
	} finally {
		await handle?.close();
	}
}

export interface LibraryEntry extends TrackMeta {
	/** An analysis exists, so this track loads without touching the network. */
	analysed: boolean;
	authored: 'none' | 'engine' | 'claude' | 'deepseek';
	/** When the track was last ingested or authored, for ordering by recency. */
	updatedAt: number;
}

interface ShowStamp {
	authored: 'engine' | 'claude' | 'deepseek';
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
		};
		const authored =
			show.authoredBy ?? ((show.generatedEffects?.length ?? 0) > 0 ? 'claude' : 'engine');
		return { authored, updatedAt: info.mtimeMs };
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

			// Written back rather than recovered on every listing, so the repair happens once per
			// track and the next read is as cheap as any other.
			if (!meta.duration && analysed) {
				const duration = await durationFromAnalysis(analysisFile);
				if (duration !== null) {
					meta = { ...meta, duration };
					await writeFile(
						join(CACHE_DIR, `${id}.meta.json`),
						JSON.stringify(meta, null, '\t')
					).catch(() => {
						// A read-only cache still lists correctly; it just repairs itself each time.
					});
				}
			}

			const show = await readShowStamp(join(CACHE_DIR, `${id}.show.json`));
			return {
				...meta,
				analysed,
				authored: show?.authored ?? 'none',
				updatedAt: Math.max(metaStat.mtimeMs, show?.updatedAt ?? 0)
			};
		})
	);

	return entries
		.filter((e): e is LibraryEntry => e !== null)
		.sort((a, b) => b.updatedAt - a.updatedAt);
}
