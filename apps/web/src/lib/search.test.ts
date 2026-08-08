import { describe, expect, it } from 'vitest';
import { asDirectLink, filterLibrary } from './search.svelte.ts';
import type { LibraryEntry } from './types.ts';

function entry(over: Partial<LibraryEntry>): LibraryEntry {
	return {
		id: 'UtF6Jej8yb4',
		title: 'Avicii - The Nights',
		uploader: 'Avicii',
		thumbnail: '',
		webpageUrl: '',
		source: '',
		analysed: true,
		authored: 'engine',
		updatedAt: 0,
		...over
	};
}

describe('asDirectLink', () => {
	it('pulls the id out of a watch URL, so the row can show art before anything is fetched', () => {
		const link = asDirectLink('https://www.youtube.com/watch?v=UtF6Jej8yb4');
		expect(link?.id).toBe('UtF6Jej8yb4');
		expect(link?.thumbnail).toContain('UtF6Jej8yb4');
	});

	it('reads a short youtu.be link', () => {
		expect(asDirectLink('https://youtu.be/UtF6Jej8yb4')?.id).toBe('UtF6Jej8yb4');
	});

	it('keeps a URL whose id it cannot find, because yt-dlp may still resolve it', () => {
		const link = asDirectLink('https://soundcloud.com/artist/track');
		expect(link).not.toBeNull();
		expect(link?.thumbnail).toBe('');
		expect(link?.source).toBe('https://soundcloud.com/artist/track');
	});

	it('accepts filesystem paths, which are a valid source', () => {
		expect(asDirectLink('/Users/x/song.wav')?.source).toBe('/Users/x/song.wav');
		expect(asDirectLink('~/song.wav')).not.toBeNull();
	});

	it('is null for ordinary search text', () => {
		expect(asDirectLink('daft punk one more time')).toBeNull();
		expect(asDirectLink('   ')).toBeNull();
	});
});

describe('filterLibrary', () => {
	const library = [
		entry({ id: 'a', title: 'The Nights', uploader: 'Avicii', updatedAt: 3 }),
		entry({ id: 'b', title: 'Firework', uploader: 'Katy Perry', updatedAt: 2 }),
		entry({ id: 'c', title: 'Night Call', uploader: 'Kavinsky', updatedAt: 1 })
	];

	it('ranks a title prefix above a title substring', () => {
		const hits = filterLibrary(library, 'night');
		expect(hits.map((h) => h.id)).toEqual(['c', 'a']);
	});

	it('matches the artist too, but below the title', () => {
		expect(filterLibrary(library, 'katy').map((h) => h.id)).toEqual(['b']);
	});

	it('returns the most recent entries when there is nothing to match on', () => {
		expect(filterLibrary(library, '', 2).map((h) => h.id)).toEqual(['a', 'b']);
	});

	it('honours the limit', () => {
		expect(filterLibrary(library, 'i', 1)).toHaveLength(1);
	});

	it('is empty when nothing matches', () => {
		expect(filterLibrary(library, 'zzz')).toEqual([]);
	});
});
