import { describe, expect, it } from 'vitest';
import type { LyricLine } from '@mv/core';
import type { Segment } from './arrange.ts';
import {
	chorusSpansFromLyrics,
	demoteVersesFromLyrics,
	promoteChorusesFromLyrics,
	spanOverlap,
	speaksClub,
	toSongVocabulary
} from './vocabulary.ts';

describe('speaksClub', () => {
	it('follows the genre family when there is one', () => {
		expect(speaksClub('techno', false)).toBe(true);
		expect(speaksClub('bass', false)).toBe(true);
		expect(speaksClub('pop', true)).toBe(false);
		expect(speaksClub('rock', true)).toBe(false);
	});

	it('falls back to the four-on-the-floor signature when unidentified', () => {
		expect(speaksClub(null, true)).toBe(true);
		expect(speaksClub(null, false)).toBe(false);
	});
});

describe('toSongVocabulary', () => {
	it('re-reads club labels and leaves the rest alone', () => {
		const segments: Segment[] = [
			{ startBar: 0, endBar: 8, kind: 'intro', group: 0 },
			{ startBar: 8, endBar: 16, kind: 'groove', group: 1 },
			{ startBar: 16, endBar: 24, kind: 'drop', group: 2 },
			{ startBar: 24, endBar: 28, kind: 'build', group: 3 }
		];
		toSongVocabulary(segments);
		expect(segments.map((s) => s.kind)).toEqual(['intro', 'verse', 'chorus', 'build']);
	});
});

describe('chorus from lyrics', () => {
	const line = (t: number, text: string): LyricLine => ({ t, text });
	// Two verses of unique lines around two identical chorus blocks.
	const lyrics: LyricLine[] = [
		line(2, 'first verse line one'),
		line(6, 'first verse line two'),
		line(10, 'unique thought here'),
		line(14, 'hook line alpha'),
		line(18, 'hook line beta'),
		line(22, 'hook line gamma'),
		line(30, 'second verse says other things'),
		line(34, 'and keeps saying them'),
		line(38, 'still nothing repeated'),
		line(44, 'hook line alpha'),
		line(48, 'hook line beta'),
		line(52, 'hook line gamma')
	];

	it('finds the repeated blocks', () => {
		const spans = chorusSpansFromLyrics(lyrics, 60);
		expect(spans.length).toBe(2);
		expect(spans[0].start).toBe(14);
		expect(spans[1].start).toBe(44);
	});

	it('promotes the loud verse the words sit on', () => {
		const spans = chorusSpansFromLyrics(lyrics, 60);
		const segments: Segment[] = [
			{ startBar: 0, endBar: 7, kind: 'verse', group: 0 },
			{ startBar: 7, endBar: 13, kind: 'verse', group: 1 },
			{ startBar: 13, endBar: 20, kind: 'verse', group: 0 },
			{ startBar: 20, endBar: 28, kind: 'verse', group: 1 }
		];
		// Two-second bars: block one covers bars 7-11, block two bars 22-27.
		promoteChorusesFromLyrics(segments, [0.6, 0.9, 0.6, 0.88], (bar) => bar * 2, spans);
		expect(segments.map((s) => s.kind)).toEqual(['verse', 'chorus', 'verse', 'chorus']);
	});
});

describe('demoteVersesFromLyrics', () => {
	const spans = [
		{ start: 20, end: 40 },
		{ start: 80, end: 100 }
	];

	it('demotes the loud verse that carries none of the hook', () => {
		const segments: Segment[] = [
			{ startBar: 0, endBar: 10, kind: 'chorus', group: 2 },
			{ startBar: 10, endBar: 20, kind: 'chorus', group: 1 },
			{ startBar: 40, endBar: 50, kind: 'chorus', group: 0 }
		];
		// Two-second bars: segments 1 and 2 sit on the hook blocks, segment 0 carries nothing.
		demoteVersesFromLyrics(segments, (bar) => bar * 2, spans);
		expect(segments.map((s) => s.kind)).toEqual(['verse', 'chorus', 'chorus']);
	});

	it('keeps the instrumental reprise its sung siblings vouch for', () => {
		const segments: Segment[] = [
			{ startBar: 0, endBar: 10, kind: 'chorus', group: 0 },
			{ startBar: 10, endBar: 20, kind: 'chorus', group: 1 },
			{ startBar: 40, endBar: 50, kind: 'chorus', group: 0 }
		];
		// Segment 0 repeats segment 2's audio (same group) but carries no lines - a final
		// instrumental chorus, not a verse.
		demoteVersesFromLyrics(segments, (bar) => bar * 2, spans);
		expect(segments.map((s) => s.kind)).toEqual(['chorus', 'chorus', 'chorus']);
	});

	it('leaves everything alone when no chorus anchors the lyric blocks', () => {
		const segments: Segment[] = [{ startBar: 0, endBar: 5, kind: 'chorus', group: 0 }];
		demoteVersesFromLyrics(segments, (bar) => bar * 2, spans);
		expect(segments[0].kind).toBe('chorus');
	});
});

describe('spanOverlap', () => {
	it('measures coverage', () => {
		const spans = [{ start: 10, end: 20 }];
		expect(spanOverlap(spans, 10, 20)).toBe(1);
		expect(spanOverlap(spans, 15, 25)).toBe(0.5);
		expect(spanOverlap(spans, 30, 40)).toBe(0);
	});
});
