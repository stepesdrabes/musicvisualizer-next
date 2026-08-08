import type { LibraryEntry, SearchResult } from '$lib/types.ts';

export interface Candidate {
	/** Where it came from, which decides the badge and whether picking it costs a download. */
	origin: 'library' | 'youtube' | 'link';
	id: string;
	source: string;
	title: string;
	uploader: string;
	thumbnail: string;
	duration: number;
	authored: 'none' | 'engine' | 'claude';
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
		uploader: '',
		thumbnail: id ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : '',
		duration: 0,
		authored: 'none'
	};
}

export function libraryToCandidate(entry: LibraryEntry): Candidate {
	return {
		origin: 'library',
		id: entry.id,
		source: entry.webpageUrl || entry.source,
		title: entry.title,
		uploader: entry.uploader,
		thumbnail: entry.thumbnail,
		duration: entry.duration ?? 0,
		authored: entry.authored
	};
}

export function resultToCandidate(result: SearchResult): Candidate {
	return {
		origin: 'youtube',
		id: result.id,
		source: result.webpageUrl,
		title: result.title,
		uploader: result.uploader,
		thumbnail: result.thumbnail,
		duration: result.duration,
		authored: 'none'
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
