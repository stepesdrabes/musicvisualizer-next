import { describe, expect, it } from 'vitest';
import type { LyricLine } from '@mv/core';
import type { Segment } from './arrange.ts';
import {
	chorusSpansFromLyrics,
	demoteVersesFromLyrics,
	hookBars,
	hookStarts,
	promoteChorusesFromLyrics,
	snapToHooks,
	spanOverlap,
	speaksClub,
	toSongVocabulary
} from './vocabulary.ts';

describe('speaksClub', () => {
	it('follows the genre family when the record corroborates it', () => {
		expect(speaksClub('techno', 1.0)).toBe(true);
		// Halftime bass sits near half the four-on-the-floor rate and keeps its drops.
		expect(speaksClub('bass', 0.5)).toBe(true);
		expect(speaksClub('pop', 1.0)).toBe(false);
		expect(speaksClub('rock', 1.0)).toBe(false);
	});

	it('refuses the club vocabulary when the floor never kicks, whatever the tag says', () => {
		// The judged failure: a piano ballad filed as house got six kickless "drops".
		expect(speaksClub('house', 0.0)).toBe(false);
		expect(speaksClub('ambient', 0.0)).toBe(false);
		expect(speaksClub('ambient', 0.55)).toBe(true);
	});

	it('falls back to the four-on-the-floor signature when unidentified', () => {
		expect(speaksClub(null, 0.85)).toBe(true);
		expect(speaksClub(null, 0.5)).toBe(false);
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

describe('hookBars', () => {
	const line = (t: number, text: string): LyricLine => ({ t, text });
	// Bars two seconds long; the repeated block starts at t=14 (bar 7) and t=44 (bar 22).
	const lyrics: LyricLine[] = [
		line(2, 'verse one'),
		line(6, 'verse two'),
		line(10, 'verse three'),
		line(14, 'hook alpha'),
		line(18, 'hook beta'),
		line(30, 'more verse'),
		line(34, 'other words'),
		line(38, 'still other words'),
		line(44, 'hook alpha'),
		line(48, 'hook beta')
	];
	const barTime = Float64Array.from({ length: 40 }, (_, b) => b * 2);

	it('flags the bar each repeated block starts in', () => {
		const hooks = hookBars(lyrics, 80, barTime, 39);
		const flagged = [...hooks].flatMap((v, b) => (v ? [b] : []));
		expect(flagged).toEqual([7, 22]);
	});

	it('rolls a back-quarter start into the next bar', () => {
		// Same blocks shifted to t=15.6: 80% into bar 7, sung into bar 8.
		const late = lyrics.map((l) => ({ ...l, t: l.t + 1.6 }));
		const hooks = hookBars(late, 80, barTime, 39);
		const flagged = [...hooks].flatMap((v, b) => (v ? [b] : []));
		expect(flagged).toEqual([8, 23]);
	});
});

describe('hookStarts', () => {
	const line = (t: number, text: string): LyricLine => ({ t, text });

	it('finds run starts and the cycle restart a merged run hides', () => {
		// The Safír shape: the opening chorus flows straight into the first real one, so
		// lines 0..7 are one unbroken repeated run and the second statement begins at
		// line 4, betrayed by "line b" coming round again.
		const lyrics: LyricLine[] = [
			line(0, 'restated opener'),
			line(4, 'line b'),
			line(8, 'line c'),
			line(12, 'line d'),
			line(16, 'restated opener'),
			line(20, 'line b'),
			line(24, 'line c'),
			line(28, 'line d'),
			line(40, 'a verse of its own'),
			line(44, 'saying unrepeated things'),
			line(60, 'restated opener'),
			line(64, 'line b')
		];
		expect(hookStarts(lyrics)).toEqual([
			{ t: 0, restart: false },
			{ t: 16, restart: true },
			{ t: 60, restart: false }
		]);
	});

	it('does not call a line chanted twice a new block', () => {
		const lyrics: LyricLine[] = [
			line(0, 'hey'),
			line(2, 'hey'),
			line(4, 'hey'),
			line(6, 'hey'),
			line(20, 'verse alpha'),
			line(24, 'verse beta'),
			line(40, 'hey'),
			line(42, 'hey')
		];
		expect(hookStarts(lyrics)).toEqual([
			{ t: 0, restart: false },
			{ t: 40, restart: false }
		]);
	});
});

describe('snapToHooks', () => {
	// Two-second bars throughout; a hook time of 21.2 is bar 10 + 0.6.
	const barTime = Float64Array.from({ length: 61 }, (_, b) => b * 2);
	const entrance = (t: number) => ({ t, restart: false });
	const restart = (t: number) => ({ t, restart: true });

	it('pulls back a boundary the pickup slam dragged late', () => {
		// The Safír case: hook sung at bar 8.4, chorus truly at 9, boundary landed at 11.
		const segments: Segment[] = [
			{ startBar: 0, endBar: 11, kind: 'verse', group: 0 },
			{ startBar: 11, endBar: 24, kind: 'chorus', group: 1 }
		];
		const moves = snapToHooks(segments, [restart(16.8)], barTime, 60);
		expect(moves).toEqual([{ from: 11, to: 9 }]);
		expect(segments[0].endBar).toBe(9);
	});

	it('leaves a boundary anywhere inside the hook window alone', () => {
		// A pickup sung at bar 9.3 belongs to bar 9 or 10 and the phase cannot say which,
		// so a boundary on either is evidence, not error.
		for (const startBar of [9, 10]) {
			const segments: Segment[] = [
				{ startBar: 0, endBar: startBar, kind: 'verse', group: 0 },
				{ startBar, endBar: 24, kind: 'chorus', group: 1 }
			];
			expect(snapToHooks(segments, [entrance(18.6)], barTime, 60)).toEqual([]);
		}
	});

	it('moves one bar later only toward a restart, never toward an entrance', () => {
		// The Cikády case against the VYZEE case: a block returning mid-flow at bar 24.6
		// marks the drop the boundary undershot; a vocal ENTERING there could as easily
		// be lagging the drop that already happened.
		const segments = (): Segment[] => [
			{ startBar: 0, endBar: 23, kind: 'groove', group: 0 },
			{ startBar: 23, endBar: 40, kind: 'drop', group: 1 }
		];
		expect(snapToHooks(segments(), [entrance(49.2)], barTime, 60)).toEqual([]);
		const moved = segments();
		expect(snapToHooks(moved, [restart(49.2)], barTime, 60)).toEqual([{ from: 23, to: 24 }]);
		expect(moved[1].startBar).toBe(24);
	});

	it('refuses the pull-back when the boundary sits on a dominant arrival', () => {
		// The EARFQUAKE case: the singer leads the drop a cappella, so the hook window
		// sits two near-silent bars before the beat lands. The DP put the boundary on the
		// beat; the snap must not drag it onto the pickup.
		const arrivals = new Float32Array(61);
		arrivals[40] = 3.2;
		arrivals[38] = 0.2;
		const segments: Segment[] = [
			{ startBar: 0, endBar: 40, kind: 'build', group: 0 },
			{ startBar: 40, endBar: 52, kind: 'chorus', group: 1 }
		];
		// Hook sung at bar 37.2, window {37, 38}; without arrivals the old rule pulls
		// the boundary from the beat at 40 onto the pickup edge at 38.
		expect(snapToHooks(segments, [entrance(74.4)], barTime, 60, 2, arrivals)).toEqual([]);
		expect(segments[1].startBar).toBe(40);
		// And with an edge that arrives comparably, the snap still works.
		const weak = new Float32Array(61);
		weak[40] = 0.8;
		weak[38] = 0.7;
		const again: Segment[] = [
			{ startBar: 0, endBar: 40, kind: 'build', group: 0 },
			{ startBar: 40, endBar: 52, kind: 'chorus', group: 1 }
		];
		expect(snapToHooks(again, [entrance(74.4)], barTime, 60, 2, weak)).toEqual([
			{ from: 40, to: 38 }
		]);
	});

	it('absorbs a two-bar build leftward when the hook window sits inside it', () => {
		// The Safir shape, marked by the owner in two rounds: chorus at 43, hook window
		// {41, 42}, and the 2-bar build 41-43 holding the minimum-length refusal in place.
		const segments: Segment[] = [
			{ startBar: 33, endBar: 41, kind: 'breakdown', group: 2 },
			{ startBar: 41, endBar: 43, kind: 'build', group: -1 },
			{ startBar: 43, endBar: 67, kind: 'chorus', group: 1 }
		];
		const moves = snapToHooks(segments, [restart(83.2)], barTime, 60);
		expect(moves).toEqual([{ from: 43, to: 42 }]);
		expect(segments).toEqual([
			{ startBar: 33, endBar: 42, kind: 'breakdown', group: 2 },
			{ startBar: 42, endBar: 67, kind: 'chorus', group: 1 }
		]);
	});

	it('still refuses the shrink when the blocker is not a two-bar build', () => {
		const segments: Segment[] = [
			{ startBar: 33, endBar: 41, kind: 'breakdown', group: 2 },
			{ startBar: 41, endBar: 44, kind: 'build', group: -1 },
			{ startBar: 44, endBar: 67, kind: 'chorus', group: 1 }
		];
		expect(snapToHooks(segments, [restart(83.2)], barTime, 60)).toEqual([]);
		expect(segments).toHaveLength(3);
	});

	it('never delays a boundary by two bars onto a lagging club vocal', () => {
		// The VYZEE case: the drop hits at 13, the hook line only enters at bar 15.7.
		const segments: Segment[] = [
			{ startBar: 0, endBar: 13, kind: 'build', group: 0 },
			{ startBar: 13, endBar: 37, kind: 'drop', group: 1 }
		];
		expect(snapToHooks(segments, [restart(31.4)], barTime, 60)).toEqual([]);
	});

	it('discards refrain hooks cycling faster than a phrase', () => {
		// Hooks at bars 51, 53, 55, 57: a chant, not four sections. Too few survive the
		// spacing guard to put a window within reach of the chorus at 60.
		const segments: Segment[] = [
			{ startBar: 0, endBar: 60, kind: 'build', group: 0 },
			{ startBar: 60, endBar: 61, kind: 'chorus', group: 1 }
		];
		const chant = [102.2, 106.2, 110.2, 114.2].map(restart);
		expect(snapToHooks(segments, chant, barTime, 61)).toEqual([]);
	});

	it('never moves a boundary shared with a void', () => {
		const segments: Segment[] = [
			{ startBar: 0, endBar: 30, kind: 'groove', group: 0 },
			{ startBar: 30, endBar: 32, kind: 'void', group: -1 },
			{ startBar: 32, endBar: 40, kind: 'drop', group: 1 }
		];
		expect(snapToHooks(segments, [restart(60.4)], barTime, 60)).toEqual([]);
	});

	it('leaves verse and build starts to the energy evidence', () => {
		const segments: Segment[] = [
			{ startBar: 0, endBar: 8, kind: 'intro', group: 0 },
			{ startBar: 8, endBar: 16, kind: 'verse', group: 1 },
			{ startBar: 16, endBar: 20, kind: 'build', group: 2 }
		];
		expect(snapToHooks(segments, [entrance(12.4)], barTime, 60)).toEqual([]);
	});

	it('refuses a move that would squeeze a neighbour under two bars', () => {
		const segments: Segment[] = [
			{ startBar: 0, endBar: 3, kind: 'intro', group: 0 },
			{ startBar: 3, endBar: 11, kind: 'chorus', group: 1 }
		];
		// Hook at bar 0.5, window {0, 1}: reaching bar 1 would leave a one-bar intro.
		expect(snapToHooks(segments, [entrance(1.0)], barTime, 60)).toEqual([]);
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
