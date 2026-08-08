import { spawn } from 'node:child_process';

export interface SearchResult {
	id: string;
	title: string;
	uploader: string;
	/** Seconds, or 0 when the flat listing did not carry one (rare, and live streams). */
	duration: number;
	thumbnail: string;
	webpageUrl: string;
}

const YT_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * The still every video has. The flat listing does carry a `thumbnails` array, but its URLs
 * are signed and expire, so a queue entry that outlives the search would show a broken image.
 */
function thumbFor(id: string): string {
	return `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
}

/**
 * One JSON object per line. A malformed line is skipped rather than fatal: yt-dlp will
 * happily return nine good results and one entry it could not fully resolve, and dropping
 * the whole search over that is worse than dropping the entry.
 */
export function parseSearchOutput(stdout: string): SearchResult[] {
	const out: SearchResult[] = [];
	for (const line of stdout.split('\n')) {
		if (!line.trim()) continue;
		let j: Record<string, unknown>;
		try {
			j = JSON.parse(line) as Record<string, unknown>;
		} catch {
			continue;
		}
		const id = String(j.id ?? '');
		if (!YT_ID.test(id)) continue;
		out.push({
			id,
			title: String(j.title ?? 'Unknown'),
			uploader: String(j.channel ?? j.uploader ?? ''),
			duration: Number(j.duration ?? 0) || 0,
			thumbnail: thumbFor(id),
			webpageUrl: `https://www.youtube.com/watch?v=${id}`
		});
	}
	return out;
}

/**
 * Search YouTube through yt-dlp.
 *
 * `--flat-playlist` is what makes this usable interactively: it reads the search page only,
 * so twenty results cost one request and about a second and a half, where resolving each
 * entry would cost one request per result. The query goes in as an argv element with no
 * shell, so it needs no escaping and cannot be turned into a command.
 */
export function searchYouTube(
	query: string,
	limit = 20,
	signal?: AbortSignal
): Promise<SearchResult[]> {
	const trimmed = query.trim();
	if (!trimmed) return Promise.resolve([]);
	const n = Math.max(1, Math.min(40, Math.floor(limit)));

	return new Promise((resolve, reject) => {
		const child = spawn(
			'yt-dlp',
			[`ytsearch${n}:${trimmed}`, '--flat-playlist', '--dump-json', '--no-warnings', '--quiet'],
			{ stdio: ['ignore', 'pipe', 'pipe'] }
		);

		let stdout = '';
		let stderr = '';
		child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
		child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));

		const abort = () => child.kill('SIGKILL');
		signal?.addEventListener('abort', abort, { once: true });

		child.on('error', (e) =>
			reject(new Error(`yt-dlp failed to start (is it installed?): ${e.message}`))
		);
		child.on('close', (code) => {
			signal?.removeEventListener('abort', abort);
			// A killed child is a superseded keystroke, not a failure worth surfacing.
			if (signal?.aborted) return resolve([]);
			if (code !== 0 && stdout.trim() === '') {
				reject(new Error(`yt-dlp exited ${code}: ${stderr.slice(-500)}`));
				return;
			}
			resolve(parseSearchOutput(stdout));
		});
	});
}
