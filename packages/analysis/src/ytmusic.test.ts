import { describe, expect, it } from 'vitest';
import {
	clockToSeconds,
	demoteVariants,
	parseRadioRow,
	parseSearchRow,
	variantOf,
	type Song
} from './ytmusic.ts';

const linked = (text: string, pageType: string) => ({
	text,
	navigationEndpoint: {
		browseEndpoint: {
			browseId: 'MPREb_gUFJXU7XTjq',
			browseEndpointContextSupportedConfigs: {
				browseEndpointContextMusicConfig: { pageType }
			}
		}
	}
});

const artist = (name: string) => linked(name, 'MUSIC_PAGE_TYPE_ARTIST');
const album = (name: string) => linked(name, 'MUSIC_PAGE_TYPE_ALBUM');
const plain = (text: string) => ({ text });

const watchEndpoint = (videoId: string, musicVideoType = 'MUSIC_VIDEO_TYPE_ATV') => ({
	videoId,
	watchEndpointMusicSupportedConfigs: { watchEndpointMusicConfig: { musicVideoType } }
});

const column = (runs: unknown[]) => ({
	musicResponsiveListItemFlexColumnRenderer: { text: { runs } }
});

/** A song row as InnerTube writes one, down to where the id and the type tag actually sit. */
const searchRow = (
	over: {
		id?: string;
		title?: string;
		byline?: unknown[];
		musicVideoType?: string;
		menuVideoId?: string;
	} = {}
) => ({
	thumbnail: {
		musicThumbnailRenderer: {
			thumbnail: {
				thumbnails: [
					{ url: 'https://yt3.googleusercontent.com/abc=w60-h60-l90-rj', width: 60, height: 60 },
					{ url: 'https://yt3.googleusercontent.com/abc=w120-h120-l90-rj', width: 120, height: 120 }
				]
			}
		}
	},
	flexColumns: [
		column([
			{
				text: over.title ?? 'The Days',
				navigationEndpoint: {
					watchEndpoint: watchEndpoint(
						over.id ?? 'Oo9sekHsm3I',
						over.musicVideoType ?? 'MUSIC_VIDEO_TYPE_ATV'
					)
				}
			}
		]),
		column(over.byline ?? [artist('CHRYSTAL'), plain(' • '), album('The Days'), plain(' • '), plain('2:50')]),
		column([plain('13M plays')])
	],
	// The overflow menu points at other videos. Reading the first videoId in the subtree would
	// sometimes find one of these instead of the row's own.
	menu: {
		menuRenderer: {
			items: [
				{
					menuNavigationItemRenderer: {
						navigationEndpoint: { watchEndpoint: watchEndpoint(over.menuVideoId ?? 'ZZZZZZZZZZZ') }
					}
				}
			]
		}
	}
});

const radioRow = (over: { id?: string; musicVideoType?: string } = {}) => ({
	title: { runs: [plain('Dior (feat. Chrystal)')] },
	longBylineText: {
		runs: [artist('MK'), plain(' • '), album('Dior'), plain(' • '), plain('2025')]
	},
	lengthText: { runs: [plain('2:50')] },
	thumbnail: {
		thumbnails: [{ url: 'https://lh3.googleusercontent.com/xyz=w120-h120', width: 120, height: 120 }]
	},
	videoId: over.id ?? 'DIOR1234567',
	navigationEndpoint: {
		watchEndpoint: watchEndpoint(over.id ?? 'DIOR1234567', over.musicVideoType)
	}
});

const song = (over: Partial<Song> = {}): Song => ({
	id: 'Oo9sekHsm3I',
	title: 'The Days',
	artist: 'CHRYSTAL',
	album: 'The Days',
	duration: 170,
	thumbnail: '',
	...over
});

describe('clockToSeconds', () => {
	it('reads minutes and hours', () => {
		expect(clockToSeconds('2:50')).toBe(170);
		expect(clockToSeconds('1:02:11')).toBe(3731);
	});

	it('is 0 for anything that is not a running time', () => {
		expect(clockToSeconds('13M plays')).toBe(0);
		expect(clockToSeconds('2025')).toBe(0);
		expect(clockToSeconds('')).toBe(0);
	});
});

describe('parseSearchRow', () => {
	it('reads the track apart from the artist', () => {
		const hit = parseSearchRow(searchRow());
		expect(hit).not.toBeNull();
		expect(hit?.id).toBe('Oo9sekHsm3I');
		expect(hit?.title).toBe('The Days');
		expect(hit?.artist).toBe('CHRYSTAL');
		expect(hit?.album).toBe('The Days');
		expect(hit?.duration).toBe(170);
	});

	it('takes the id from the title run, not from the overflow menu', () => {
		expect(parseSearchRow(searchRow({ menuVideoId: 'OTHERVIDEO1' }))?.id).toBe('Oo9sekHsm3I');
	});

	it('drops anything that is not an art track, which is the clean-audio guarantee', () => {
		expect(parseSearchRow(searchRow({ musicVideoType: 'MUSIC_VIDEO_TYPE_OMV' }))).toBeNull();
		expect(parseSearchRow(searchRow({ musicVideoType: 'MUSIC_VIDEO_TYPE_UGC' }))).toBeNull();
	});

	it('rebuilds a credit split across several linked runs', () => {
		const byline = [
			artist('CHRYSTAL'),
			plain(' & '),
			artist('Mazza_l20'),
			plain(' • '),
			album('The Days'),
			plain(' • '),
			plain('2:10')
		];
		const hit = parseSearchRow(searchRow({ byline }));
		expect(hit?.artist).toBe('CHRYSTAL & Mazza_l20');
		expect(hit?.duration).toBe(130);
	});

	it('asks for cover art big enough to read a hue off', () => {
		expect(parseSearchRow(searchRow())?.thumbnail).toBe(
			'https://yt3.googleusercontent.com/abc=w544-h544-l90-rj'
		);
	});

	it('survives a row shaped differently from the one we expect', () => {
		expect(parseSearchRow({})).toBeNull();
		expect(parseSearchRow(null)).toBeNull();
		expect(parseSearchRow({ flexColumns: [] })).toBeNull();
	});
});

describe('parseRadioRow', () => {
	it('reads a queue row, whose duration sits apart from the byline', () => {
		const hit = parseRadioRow(radioRow());
		expect(hit?.id).toBe('DIOR1234567');
		expect(hit?.title).toBe('Dior (feat. Chrystal)');
		expect(hit?.artist).toBe('MK');
		expect(hit?.album).toBe('Dior');
		expect(hit?.duration).toBe(170);
	});

	it('does not mistake the release year for a running time', () => {
		expect(parseRadioRow(radioRow())?.duration).not.toBe(0);
	});

	it('drops anything that is not an art track', () => {
		expect(parseRadioRow(radioRow({ musicVideoType: 'MUSIC_VIDEO_TYPE_OMV' }))).toBeNull();
	});
});

describe('variantOf', () => {
	it('reads a bracketed qualifier', () => {
		expect(variantOf('Bohemian Rhapsody (Live)')).toBe('live');
		expect(variantOf('Creep (Acoustic)')).toBe('acoustic');
	});

	it('reads a trailing dash clause', () => {
		expect(variantOf('Bohemian Rhapsody - Live at Wembley')).toBe('live');
	});

	// Stemmed so that typing either spelling asks for the same thing.
	it('collapses a qualifier to its stem', () => {
		expect(variantOf('Creep (Remastered)')).toBe('remaster');
		expect(variantOf('The Days (NOTION Remix Slowed)')).toBe('slow');
		expect(variantOf('Levels (Sped Up)')).toBe('spedup');
	});

	it('does not read the body of a title, so a song may be called Cover Me', () => {
		expect(variantOf('Cover Me In Sunshine')).toBeNull();
		expect(variantOf('Live Forever')).toBeNull();
		expect(variantOf('The Days')).toBeNull();
	});
});

describe('demoteVariants', () => {
	it('puts the record above its live and slowed versions', () => {
		const out = demoteVariants(
			[
				song({ id: 'a', title: 'Bohemian Rhapsody (Live Aid)' }),
				song({ id: 'b', title: 'Bohemian Rhapsody' }),
				song({ id: 'c', title: 'Bohemian Rhapsody (Live)' })
			],
			'bohemian rhapsody'
		);
		expect(out.map((s) => s.id)).toEqual(['b', 'a', 'c']);
	});

	it('leaves them alone when they are what was asked for', () => {
		const out = demoteVariants(
			[song({ id: 'a', title: 'Bohemian Rhapsody (Live)' }), song({ id: 'b', title: 'Bohemian Rhapsody' })],
			'bohemian rhapsody live'
		);
		expect(out.map((s) => s.id)).toEqual(['a', 'b']);
	});

	it('keeps the order YouTube Music gave within each half', () => {
		const out = demoteVariants(
			[
				song({ id: 'a', title: 'One' }),
				song({ id: 'b', title: 'Two (Live)' }),
				song({ id: 'c', title: 'Three' }),
				song({ id: 'd', title: 'Four (Karaoke)' })
			],
			'anything'
		);
		expect(out.map((s) => s.id)).toEqual(['a', 'c', 'b', 'd']);
	});
});
