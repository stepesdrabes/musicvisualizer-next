import type { GenreFamily, LyricLine } from '@mv/core';
import type { Segment } from './arrange.ts';
import { mean } from './dsp/stats.ts';

/**
 * Where a repeated-line block BEGINS, as a per-bar flag: on a wall-to-wall vocal track
 * the coverage column never moves, and the hook starting is the boundary the audience
 * hears. A hook landing in the back quarter of a bar is sung INTO the next bar: lyric
 * sync carries tens-of-milliseconds jitter and singers anticipate the downbeat.
 */
export function hookBars(
	lyrics: readonly LyricLine[],
	duration: number,
	barTime: Float64Array,
	barCount: number
): Uint8Array {
	const hooks = new Uint8Array(barCount);
	for (const span of chorusSpansFromLyrics(lyrics, duration)) {
		let b = 0;
		while (b < barCount - 1 && barTime[b + 1] <= span.start) b++;
		const len = barTime[b + 1] - barTime[b];
		if (len > 0 && (span.start - barTime[b]) / len > 0.75 && b + 1 < barCount) b++;
		hooks[b] = 1;
	}
	return hooks;
}

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

/** One line's identity for repeat detection: case, accents and punctuation are delivery. */
function foldLine(s: string): string {
	return s
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim();
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

	const counts = new Map<string, number>();
	const keys = lyrics.map((l) => foldLine(l.text));
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

export interface HookStart {
	/** When the block's first line starts being sung, seconds. */
	t: number;
	/**
	 * True for a restart inside a continuing run. The distinction carries trust: a run
	 * START after unrepeated lines is a vocal ENTRANCE, which in club music routinely
	 * lags the instrumental drop it belongs to, while a restart happens mid-flow and
	 * cannot lag anything.
	 */
	restart: boolean;
}

/**
 * Where a repeated-line block starts being sung, seconds - the run starts that become the
 * chorus spans, PLUS the restarts hiding inside a run. When the opening chorus flows
 * straight into the first real one, every line from the first bar to the second verse is
 * "repeated" and the merged span buries the boundary the audience hears; but the block's
 * own lines coming round again betray it, sitting the same distance from the repeat as
 * the originals sat from the cycle's start.
 */
export function hookStarts(lyrics: readonly LyricLine[]): HookStart[] {
	if (lyrics.length < 8) return [];
	const keys = lyrics.map((l) => foldLine(l.text));
	const counts = new Map<string, number>();
	for (const k of keys) if (k) counts.set(k, (counts.get(k) ?? 0) + 1);

	const out: HookStart[] = [];
	let runStart = -1;
	const flush = (end: number) => {
		const from = runStart;
		runStart = -1;
		if (from < 0 || end - from < 2) return;
		out.push({ t: lyrics[from].t, restart: false });
		let cycleStart = from;
		const firstAt = new Map<string, number>();
		for (let j = from; j < end; j++) {
			const seen = firstAt.get(keys[j]);
			if (seen !== undefined && seen >= cycleStart) {
				const restart = j - (seen - cycleStart);
				// A one-line cycle is a line chanted twice, not a block starting over. The
				// key still advances, or a long chant reads its third line as a restart.
				if (restart > cycleStart && restart - cycleStart >= 2) {
					out.push({ t: lyrics[restart].t, restart: true });
					cycleStart = restart;
					firstAt.clear();
					for (let k = restart; k <= j; k++) firstAt.set(keys[k], k);
					continue;
				}
			}
			firstAt.set(keys[j], j);
		}
	};
	for (let i = 0; i <= lyrics.length; i++) {
		const repeated = i < lyrics.length && !!keys[i] && (counts.get(keys[i]) ?? 0) >= 2;
		if (repeated) {
			if (runStart < 0) runStart = i;
			continue;
		}
		flush(i);
	}
	return out;
}

export interface HookSnapMove {
	from: number;
	to: number;
}

/**
 * Hooks that recur within a phrase are a refrain cycling inside its section, not section
 * starts, and a snap fed them drags real boundaries onto chant lines.
 */
const HOOK_MIN_GAP_BARS = 4;
/** How far a boundary may be pulled BACK onto a hook window. The judged failure class. */
const SNAP_REACH_EARLIER = 2;

/**
 * Align chorus-class startBars with the hook windows the sung lyrics prove, in place.
 *
 * A hook line starting at bar b + frac belongs to bar b or to the downbeat it is sung
 * into at b+1 - measured across the judged library, verified-correct boundaries sit on
 * either side of their hook with the in-bar phase unable to split them (a 0.27 pickup
 * lands on the next bar where a 0.31 lands on its own). So the hook claims a two-bar
 * WINDOW, a boundary already inside any window is evidence and stays, and only a
 * boundary outside every window moves, onto the nearest window edge:
 *
 * - up to two bars EARLIER: the diagnosed failure has an instrumental pickup slamming a
 *   bar or two before the sung chorus and taking the boundary with it;
 * - at most one bar LATER, and only toward a RESTART hook: a run start is a vocal
 *   entrance, which in club music routinely lags the instrumental drop it belongs to,
 *   and must not delay the biggest cue of the night onto its own lag. A restart happens
 *   mid-flow and cannot lag anything.
 *
 * The refiner's hook term still tips one-bar cases against weak incumbents; this pass
 * exists for the boundary that is beyond its reach or facing a strong wrong incumbent.
 * Runs after the vocabulary settles which segments are chorus-class; the caller
 * re-places events afterwards, or cues keep firing at the bars the boundaries left.
 */
export function snapToHooks(
	segments: Segment[],
	starts: readonly HookStart[],
	barTime: Float64Array,
	barCount: number,
	minSegmentBars = 2
): HookSnapMove[] {
	const moves: HookSnapMove[] = [];
	if (starts.length === 0 || barCount < 2) return moves;

	const windows: { bar: number; restart: boolean }[] = [];
	let lastBar = -Infinity;
	for (const h of [...starts].sort((a, b) => a.t - b.t)) {
		let b = 0;
		while (b < barCount - 1 && barTime[b + 1] <= h.t) b++;
		if (b - lastBar < HOOK_MIN_GAP_BARS) continue;
		lastBar = b;
		windows.push({ bar: b, restart: h.restart });
	}

	const inWindow = (bar: number) => windows.some((w) => bar === w.bar || bar === w.bar + 1);

	for (let i = 1; i < segments.length; i++) {
		const s = segments[i];
		if (s.kind !== 'drop' && s.kind !== 'chorus') continue;
		const prev = segments[i - 1];
		if (prev.kind === 'void') continue;
		const from = s.startBar;
		if (inWindow(from)) continue;

		let to = -1;
		let dist = Infinity;
		for (const w of windows) {
			// The nearest edge of this window, from outside it.
			const edge = from < w.bar ? w.bar : w.bar + 1;
			const d = Math.abs(edge - from);
			if (d >= dist) continue;
			if (edge < from && from - edge > SNAP_REACH_EARLIER) continue;
			if (edge > from && (edge - from > 1 || !w.restart)) continue;
			if (edge - prev.startBar < minSegmentBars) continue;
			if (s.endBar - edge < minSegmentBars) continue;
			to = edge;
			dist = d;
		}
		if (to < 0) continue;
		moves.push({ from, to });
		s.startBar = to;
		prev.endBar = to;
	}
	return moves;
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
