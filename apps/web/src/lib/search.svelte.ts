import type { Authored, LibraryEntry, SearchResult } from '$lib/types.ts';

export interface Candidate {
	/** Where it came from, which decides the badge and whether picking it costs a download. */
	origin: 'library' | 'song' | 'radio' | 'link';
	id: string;
	source: string;
	title: string;
	artist: string;
	/** Only worth drawing when it is not just the title again, which a single's is. */
	album: string | null;
	thumbnail: string;
	duration: number;
	authored: Authored;
	/** Already analysed in the cache, so picking it costs no download. */
	cached: boolean;
	/** The lighting family, once something has listened to it. */
	genre: string | null;
}

/** Cached tracks by id, so a search result can say whether it is one without a second request. */
export function indexLibrary(entries: LibraryEntry[]): Map<string, LibraryEntry> {
	return new Map(entries.map((e) => [e.id, e]));
}

const URL_LIKE = /^(https?:\/\/|\/|~\/|[A-Za-z]:\\)/;
const YT_ID = /^[A-Za-z0-9_-]{11}$/;

/** A pasted link or a filesystem path, which needs no searching at all. */
export function asDirectLink(query: string): Candidate | null {
	const q = query.trim();
	if (!q || !URL_LIKE.test(q)) return null;

	// A YouTube link carries its id in the query string or the path, and knowing it up front
	// means the row can show the real thumbnail before anything is fetched.
	let id = '';
	try {
		const url = new URL(q);
		const v = url.searchParams.get('v');
		if (v && YT_ID.test(v)) id = v;
		else if (url.hostname.endsWith('youtu.be')) {
			const seg = url.pathname.slice(1);
			if (YT_ID.test(seg)) id = seg;
		}
	} catch {
		// A local path, which is a perfectly good source and simply is not a URL.
	}

	return {
		origin: 'link',
		id: id || q,
		source: q,
		title: q,
		artist: '',
		album: null,
		thumbnail: id ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : '',
		duration: 0,
		authored: 'none',
		cached: false,
		genre: null
	};
}

export function libraryToCandidate(entry: LibraryEntry): Candidate {
	return {
		origin: 'library',
		id: entry.id,
		source: entry.webpageUrl || entry.source,
		title: entry.title,
		// Tracks ingested from YouTube Music carry the act here; older ones carry the channel
		// that uploaded them, which is the best the rip ever knew.
		artist: entry.uploader,
		album: null,
		thumbnail: entry.thumbnail,
		duration: entry.duration ?? 0,
		authored: entry.authored,
		cached: entry.analysed,
		genre: entry.genreFamily
	};
}

/** The same row, offered because of what is queued rather than because it was searched for. */
export function suggestionToCandidate(
	result: SearchResult,
	known?: Map<string, LibraryEntry>
): Candidate {
	return { ...resultToCandidate(result, known), origin: 'radio' };
}

/**
 * A search hit, told whether it is already in the cache.
 *
 * The catalogue does not know what this machine has played, and a track that is already
 * downloaded and analysed is a different proposition from one that costs a minute of work, so
 * the row has to say which it is.
 */
export function resultToCandidate(
	result: SearchResult,
	known?: Map<string, LibraryEntry>
): Candidate {
	const hit = known?.get(result.id);
	return {
		origin: 'song',
		id: result.id,
		source: result.webpageUrl,
		title: result.title,
		artist: result.artist,
		album: result.album,
		thumbnail: result.thumbnail,
		duration: result.duration,
		authored: hit?.authored ?? 'none',
		cached: hit?.analysed ?? false,
		genre: hit?.genreFamily ?? null
	};
}

/**
 * Rank cached tracks against a query.
 *
 * Substring rather than fuzzy: the library is a few dozen tracks the user chose themselves,
 * so they are typing something they remember rather than groping for it, and a fuzzy matcher
 * at this size mostly produces surprises. A title hit outranks an artist hit, and a prefix
 * outranks a hit in the middle, which is enough to put the obvious answer first.
 */
export function filterLibrary(entries: LibraryEntry[], query: string, limit = 6): LibraryEntry[] {
	const q = query.trim().toLowerCase();
	if (!q) return entries.slice(0, limit);

	const scored: { entry: LibraryEntry; score: number }[] = [];
	for (const entry of entries) {
		const title = entry.title.toLowerCase();
		const uploader = entry.uploader.toLowerCase();
		let score = -1;
		if (title.startsWith(q)) score = 4;
		else if (title.includes(q)) score = 3;
		else if (uploader.startsWith(q)) score = 2;
		else if (uploader.includes(q)) score = 1;
		if (score >= 0) scored.push({ entry, score });
	}

	return scored
		.sort((a, b) => b.score - a.score || b.entry.updatedAt - a.entry.updatedAt)
		.slice(0, limit)
		.map((s) => s.entry);
}
