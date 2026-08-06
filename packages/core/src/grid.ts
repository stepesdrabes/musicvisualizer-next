import type { TempoGrid } from './contracts/analysis.ts';

/**
 * Structural changes land on a 4-bar multiple, whatever `barsPerPhrase` says. Sections are
 * detected on this grid and the linter holds cues to it, so both must agree on the maths.
 */
export const PHRASE_BARS = 4;

export function barTimeAt(tempo: TempoGrid, bar: number): number {
	return tempo.firstBeat + (tempo.downbeatPhase + bar * tempo.beatsPerBar) * tempo.beatPeriod;
}

/** How far past the last phrase boundary this bar sits, 0 when it is on one. */
export function phraseOffset(bar: number, anchorBar: number): number {
	return (((bar - anchorBar) % PHRASE_BARS) + PHRASE_BARS) % PHRASE_BARS;
}

export function onPhraseGrid(bar: number, anchorBar: number): boolean {
	return phraseOffset(bar, anchorBar) === 0;
}

/** Nearest bar on the phrase grid, preferring the earlier one on a tie. */
export function nearestPhraseBar(bar: number, anchorBar: number): number {
	const down = bar - phraseOffset(bar, anchorBar);
	const up = down + PHRASE_BARS;
	return bar - down <= up - bar ? down : up;
}
