import type { GenreFamily, LyricLine } from '@mv/core';
import type { Segment } from './arrange.ts';
import { mean } from './dsp/stats.ts';

/**
 * Which section vocabulary a track speaks.
 *
 * Club music has drops: passages defined by impact, set up and slammed into. Song music
 * has choruses: the same energy class arrived at by lift rather than by impact, and lit
 * as an anthem rather than an assault. The families whose records are built around the
 * drop keep the club vocabulary; everything else reads as songs.
 */
const CLUB_FAMILIES: ReadonlySet<GenreFamily> = new Set([
	'techno',
	'house',
	'edm',
	'trance',
	'bass',
	'ambient'
] as GenreFamily[]);

export function speaksClub(
	family: GenreFamily | null,
	fourOnFloorEvidence: boolean
): boolean {
	if (family) return CLUB_FAMILIES.has(family);
	// No metadata: a relentless four-on-the-floor kick is the one audio signature that
	// separates the two vocabularies without a genre tag. Defaulting the unknown to song
	// errs toward blooms over strobes, which is the survivable direction.
	return fourOnFloorEvidence;
}

/** Re-read club labels as song labels, in place. The grid and grouping are untouched. */
export function toSongVocabulary(segments: Segment[]): void {
	for (const s of segments) {
		if (s.kind === 'drop') s.kind = 'chorus';
		else if (s.kind === 'groove') s.kind = 'verse';
	}
}

export interface TimeSpan {
	start: number;
	end: number;
}

/**
 * Where the chorus is, according to the words.
 *
 * A chorus is the passage whose lines the track repeats: runs of two or more lines that
 * each occur again elsewhere. Line-level sync is enough - the value is the span, not the
 * word - and the estimate is deliberately coarse: it exists to settle which loud section
 * is THE chorus, not to place a boundary.
 */
export function chorusSpansFromLyrics(lyrics: readonly LyricLine[], duration: number): TimeSpan[] {
	if (lyrics.length < 8) return [];

	const fold = (s: string) =>
		s
			.normalize('NFKD')
			.replace(/[̀-ͯ]/g, '')
			.toLowerCase()
			.replace(/[^\p{L}\p{N}]+/gu, ' ')
			.trim();

	const counts = new Map<string, number>();
	const keys = lyrics.map((l) => fold(l.text));
	for (const k of keys) if (k) counts.set(k, (counts.get(k) ?? 0) + 1);

	const spans: TimeSpan[] = [];
	let runStart = -1;
	let runLines = 0;
	for (let i = 0; i <= lyrics.length; i++) {
		const repeated = i < lyrics.length && !!keys[i] && (counts.get(keys[i]) ?? 0) >= 2;
		if (repeated) {
			if (runStart < 0) runStart = i;
			runLines++;
			continue;
		}
		if (runStart >= 0 && runLines >= 2) {
			const start = lyrics[runStart].t;
			const last = lyrics[i - 1];
			const next = lyrics[i];
			// A line lasts until the next one starts, but never longer than a phrase: sync
			// gaps span instrumental breaks, and a chorus must not annex the solo after it.
			const end = Math.min(duration, next ? next.t : last.t + 4, last.t + 6);
			spans.push({ start, end });
		}
		runStart = -1;
		runLines = 0;
	}

	// Merge blocks the lyric formatting split: an instrumental turnaround inside a chorus
	// is still the chorus.
	const merged: TimeSpan[] = [];
	for (const s of spans.sort((a, b) => a.start - b.start)) {
		const prev = merged[merged.length - 1];
		if (prev && s.start - prev.end < 3) prev.end = Math.max(prev.end, s.end);
		else merged.push({ ...s });
	}
	return merged;
}

/** Share of [from, to) covered by the spans, 0..1. */
export function spanOverlap(spans: readonly TimeSpan[], from: number, to: number): number {
	if (to <= from) return 0;
	let covered = 0;
	for (const s of spans) {
		covered += Math.max(0, Math.min(to, s.end) - Math.max(from, s.start));
	}
	return Math.min(1, covered / (to - from));
}

/**
 * Let the words promote a loud verse to the chorus it evidently is.
 *
 * Promotion only: the energy evidence that made a section a chorus is stronger than the
 * absence of a lyric match, which on a sparsely synced track means nothing. A verse is
 * promoted when the repeated lines sit squarely on it and it is loud enough to be the
 * chorus it claims - the second condition keeps a repeated post-chorus tag from dragging
 * a quiet section up.
 */
export function promoteChorusesFromLyrics(
	segments: Segment[],
	segEnergy: readonly number[],
	barTime: (bar: number) => number,
	spans: readonly TimeSpan[]
): void {
	if (spans.length === 0) return;
	const loudest = Math.max(...segEnergy, 0.001);
	for (let i = 0; i < segments.length; i++) {
		const s = segments[i];
		if (s.kind !== 'verse') continue;
		const overlap = spanOverlap(spans, barTime(s.startBar), barTime(s.endBar));
		if (overlap >= 0.55 && segEnergy[i] >= loudest * 0.8) s.kind = 'chorus';
	}
}

/**
 * The other direction: a "chorus" whose bars carry none of the repeated lines, on a track
 * where the repeated lines clearly live somewhere else, is a loud verse - rock verses are
 * walls of guitar and the energy model cannot tell them from the hook. Demotion needs both
 * halves: near-zero overlap here AND a strongly overlapping chorus elsewhere, so a track
 * with instrumental chorus reprises or sparse sync data is left alone.
 */
export function demoteVersesFromLyrics(
	segments: Segment[],
	barTime: (bar: number) => number,
	spans: readonly TimeSpan[]
): void {
	if (spans.length < 2) return;
	const overlaps = segments.map((s) =>
		s.kind === 'chorus' ? spanOverlap(spans, barTime(s.startBar), barTime(s.endBar)) : 0
	);
	const anchored = overlaps.some((o) => o >= 0.5);
	if (!anchored) return;
	// A group with any sung member is chorus MATERIAL: an instrumental reprise of the hook
	// carries no lines and must not be demoted away from its own siblings.
	const sungGroups = new Set<number>();
	for (let i = 0; i < segments.length; i++) {
		if (segments[i].kind === 'chorus' && overlaps[i] >= 0.5) sungGroups.add(segments[i].group);
	}
	for (let i = 0; i < segments.length; i++) {
		if (segments[i].kind !== 'chorus' || overlaps[i] >= 0.12) continue;
		if (segments[i].group >= 0 && sungGroups.has(segments[i].group)) continue;
		segments[i].kind = 'verse';
	}
}

/** Kicks per beat across the loud half of the track: the four-on-the-floor signature. */
export function fourOnFloor(
	kicksPerBar: Int32Array,
	energy: Float32Array,
	beatsPerBar: number
): boolean {
	const count = Math.min(kicksPerBar.length, energy.length);
	if (count === 0) return false;
	const sorted = Float32Array.from(energy.subarray(0, count)).sort();
	const median = sorted[sorted.length >> 1];
	const loud: number[] = [];
	for (let b = 0; b < count; b++) if (energy[b] >= median) loud.push(kicksPerBar[b]);
	if (loud.length === 0) return false;
	return mean(Float32Array.from(loud)) / Math.max(1, beatsPerBar) >= 0.8;
}
