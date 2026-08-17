import type { TempoGrid } from './contracts/analysis.ts';

/**
 * Structural changes land on a 4-bar multiple, whatever `barsPerPhrase` says. Sections are
 * detected on this grid and the linter holds cues to it, so both must agree on the maths.
 */
export const PHRASE_BARS = 4;

/**
 * A whole phrase, which is what `f.phraseStart` fires on and what `tempo.barsPerPhrase` ships.
 *
 * Twice `PHRASE_BARS`, and the two are not interchangeable. The anchor is fitted to the 4-bar
 * grid because that is where changes land, and then resolved to whichever of the two phases mod
 * 8 agrees with it: an anchor fitted only mod 4 leaves the mod-8 phase a coin toss, and half
 * the section starts then fire on the answering bar of the phrase instead of the asking one.
 */
export const BARS_PER_PHRASE = 8;

/**
 * When a bar starts, in seconds.
 *
 * Read from `tempo.barTimes` rather than reconstructed from a period, because a constant
 * period is only ever a fit: a track that moves by two per cent accumulates whole beats of
 * error across four minutes, and every cue in the back half then fires against a metronome the
 * song is not playing to. Outside the table the last known period is extended, which is the
 * only sane answer for a cue past the end of the audio.
 */
export function barTimeAt(tempo: TempoGrid, bar: number): number {
	const times = tempo.barTimes;
	if (!times || times.length === 0) {
		return tempo.firstBeat + (tempo.downbeatPhase + bar * tempo.beatsPerBar) * tempo.beatPeriod;
	}

	const last = times.length - 1;
	if (bar <= 0) {
		// Extrapolating backwards keeps bar -1 a bar earlier than bar 0 rather than equal to it,
		// which matters because a fade is addressed relative to the bar it completes on.
		const span = last >= 1 ? times[1] - times[0] : tempo.beatPeriod * tempo.beatsPerBar;
		return times[0] + bar * span;
	}
	if (bar >= last) {
		const span = last >= 1 ? times[last] - times[last - 1] : tempo.beatPeriod * tempo.beatsPerBar;
		return times[last] + (bar - last) * span;
	}

	const i = Math.floor(bar);
	const frac = bar - i;
	return frac === 0 ? times[i] : times[i] + (times[i + 1] - times[i]) * frac;
}

/** How long the bar containing `bar` lasts, seconds. */
export function barDurationAt(tempo: TempoGrid, bar: number): number {
	const times = tempo.barTimes;
	const fallback = tempo.beatPeriod * tempo.beatsPerBar;
	if (!times || times.length < 2) return fallback;
	const i = Math.max(0, Math.min(times.length - 2, Math.floor(bar)));
	const span = times[i + 1] - times[i];
	return span > 1e-6 ? span : fallback;
}

/**
 * The inverse of `barTimeAt`: which bar, and how far through it, a moment falls on.
 *
 * Fractional, so a caller gets the bar phase from the same arithmetic that produced the bar
 * index and the two cannot disagree. Hand-rolling this against a constant period is what put
 * the scrubber, the player and the agent's tools on three different clocks.
 */
export function barAtTime(tempo: TempoGrid, t: number): number {
	const times = tempo.barTimes;
	if (!times || times.length === 0) {
		const beats = (t - tempo.firstBeat) / tempo.beatPeriod;
		return (beats - tempo.downbeatPhase) / tempo.beatsPerBar;
	}

	const last = times.length - 1;
	if (t <= times[0]) {
		const span = last >= 1 ? times[1] - times[0] : tempo.beatPeriod * tempo.beatsPerBar;
		return span > 1e-6 ? (t - times[0]) / span : 0;
	}
	if (t >= times[last]) {
		const span = last >= 1 ? times[last] - times[last - 1] : tempo.beatPeriod * tempo.beatsPerBar;
		return span > 1e-6 ? last + (t - times[last]) / span : last;
	}

	let lo = 0;
	let hi = last;
	while (hi - lo > 1) {
		const mid = (lo + hi) >> 1;
		if (times[mid] <= t) lo = mid;
		else hi = mid;
	}
	const span = times[lo + 1] - times[lo];
	return span > 1e-6 ? lo + (t - times[lo]) / span : lo;
}

/**
 * The bar a hand-placed moment belongs to: nearest bar line, ties to the EARLIER bar.
 *
 * One function because a hand map is read twice - once by the preview and once by the
 * analysis that adopts it - and the two must land on the same bar or the room plays an
 * arrangement the preview never showed. They did not: one rounded a fractional bar with
 * `Math.round` (ties up) while the other walked the bar table keeping the first nearest
 * (ties down), and a boundary drawn on beat 3 of a 4/4 bar sits at EXACTLY bar + 0.5 by
 * construction, so the editor produced that tie constantly. On one judged track the two
 * consumers put the same drawn boundary four seconds apart.
 *
 * Ties go to the earlier bar because that is what the adoption already did, and the adopted
 * table is what the room has been playing and what the owner has confirmed by ear.
 */
export function nearestBar(tempo: TempoGrid, t: number): number {
	return tieToEarlier(barAtTime(tempo, t));
}

/**
 * The same rule for a caller holding only the bar table - the analysis while it is still
 * building one, which has no `TempoGrid` to hand yet.
 */
export function nearestBarIn(barTimes: ArrayLike<number>, t: number, barCount: number): number {
	const last = Math.max(0, Math.min(barCount, barTimes.length - 1));
	if (last < 1 || t <= barTimes[0]) return 0;
	if (t >= barTimes[last]) return last;
	let lo = 0;
	let hi = last;
	while (hi - lo > 1) {
		const mid = (lo + hi) >> 1;
		if (barTimes[mid] <= t) lo = mid;
		else hi = mid;
	}
	const span = barTimes[lo + 1] - barTimes[lo];
	return span > 1e-6 ? tieToEarlier(lo + (t - barTimes[lo]) / span) : lo;
}

function tieToEarlier(bars: number): number {
	const floor = Math.floor(bars);
	return bars - floor > 0.5 ? floor + 1 : floor;
}

/**
 * How long a hit lasts, in seconds, read off the bar table.
 *
 * The one place this arithmetic lives, because the planner and the linter have to agree on it
 * exactly. They did not: the planner sized a strobe against the bar it was measured at and then
 * placed it a bar earlier, so on a track that drifts by a per cent the two disagreed and the
 * linter rejected a show the engine had just written. A rejected show is a dark room.
 */
export function hitSeconds(
	tempo: TempoGrid,
	bar: number,
	beat: number,
	beats: number
): number {
	const perBar = Math.max(1, tempo.beatsPerBar);
	const from = bar + beat / perBar;
	return barTimeAt(tempo, from + beats / perBar) - barTimeAt(tempo, from);
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

