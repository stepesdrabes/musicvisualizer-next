import type { SectionKind } from '@mv/core';
import { SECTION_KINDS, nearestBarIn } from '@mv/core';

/**
 * A hand-drawn section map, adopted.
 *
 * The judge panel lets the owner draw the arrangement they hear - drag a boundary, split,
 * merge, pick a kind - and until now the analysis obeyed a map's GRID (see `gridedits.ts`)
 * while its own DP kept deciding the sections. Ponyboy is what that costs: the owner drew
 * two drop blocks and a mid-track valley, the analyser called the drops grooves, and the
 * room read flat at 2 stars against a map that says exactly what it wanted. On a mapped
 * track the listener's reading outranks the segmenter's, so here the map wins outright -
 * boundaries and kinds both.
 *
 * What it deliberately is NOT is a correction the analyser learns from. A map is an
 * override for one track: the DP, the labeller and the eval all keep running on the
 * unmapped library, and `bench/reanalyse.ts --no-hand-maps` reproduces the un-adopted
 * reading so a mapped track can still be SCORED against its own map.
 */

/** One drawn section: the vocabulary word and where the owner put its start, in seconds. */
export interface HandSection {
	readonly kind: string;
	readonly startTime: number;
	/** Placed between bar lines on purpose; the grid is cut to it rather than rounding it. */
	readonly offGrid?: boolean;
}

/**
 * What a map says, as one short string, so a cached analysis can be asked whether it has
 * heard THIS map. Milliseconds are rounded off: the map is read onto bar lines anyway, and a
 * fingerprint that moves when nothing audible does would re-analyse a track for a redraw
 * that lands on the same bars.
 */
export function handMapFingerprint(hand: readonly HandSection[]): string {
	return hand.map((s) => `${s.kind}@${Math.round(s.startTime * 100) / 100}`).join(',');
}

/**
 * Hand maps keep `kind` a plain string so a map outlives a vocabulary change; a word this
 * vocabulary does not know reads as the neutral middle of it.
 */
function coerceKind(kind: string): SectionKind {
	return (SECTION_KINDS as readonly string[]).includes(kind) ? (kind as SectionKind) : 'groove';
}

/**
 * A hand map read onto a bar grid: internal boundaries as bar indices, one kind per span.
 *
 * Times are the map's authoritative coordinate and bars are the engine's, so each boundary
 * lands on the NEAREST bar line. Sub-bar precision is not intent to be preserved: the
 * editor snaps drags to the beat grid, which lets a boundary sit mid-bar (Safir's verse
 * one beat past its own confirmed bar line, Blinding Lights' outro on a mid-bar beat), and
 * the engine addresses every cue by whole bars. Rounding is the only reading available, and
 * on Safir it lands back on the bar the room confirmed.
 *
 * The edges are forced to the track's own: sections must cover every bar with no gaps, and
 * a map's first boundary is a statement about the intro, not about where the track begins.
 * A span that rounds onto nothing is dropped, its bars going to the neighbour that absorbed
 * the boundary. Returns null when nothing survives that is worth adopting.
 */
export function handSectionBars(
	hand: readonly HandSection[],
	barTime: Float64Array,
	barCount: number
): { bounds: number[]; kinds: SectionKind[] } | null {
	if (hand.length < 2 || barCount < 2) return null;
	const drawn = [...hand].sort((a, b) => a.startTime - b.startTime);

	// The same rounding the preview uses, so what was previewed is what gets adopted: nearest
	// bar line, ties to the earlier bar. Core holds the single copy of that rule.
	const at = (t: number): number => nearestBarIn(barTime, t, barCount);

	const bounds: number[] = [0];
	const kinds: SectionKind[] = [coerceKind(drawn[0].kind)];
	for (let i = 1; i < drawn.length; i++) {
		const bar = at(drawn[i].startTime);
		if (bar >= barCount) break;
		const kind = coerceKind(drawn[i].kind);
		if (bar <= bounds[bounds.length - 1]) {
			// The span before this one rounded onto no bar at all. It has nothing to light, so
			// the section that follows it takes the boundary they both landed on.
			kinds[kinds.length - 1] = kind;
			continue;
		}
		bounds.push(bar);
		kinds.push(kind);
	}
	bounds.push(barCount);
	// One span end to end is not a map, it is a track with a label. Adopting it would hand
	// the engine a single-section arrangement on the strength of a boundary that rounded away.
	return kinds.length >= 2 ? { bounds, kinds } : null;
}
