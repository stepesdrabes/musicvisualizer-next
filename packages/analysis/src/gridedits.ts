/**
 * Half-bar grid edits, listener-supplied.
 *
 * Safir proved the class: the record inserts two beats twice, the owner's marks sit on
 * two different phases of the same uniform grid, and meterConfidence 0.52 was the
 * pipeline noticing without being able to say what it saw. The grid absorbs each edit
 * as one SHORT bar ending at the cut, so every mark lands on a bar line and pre-arrival
 * gestures keep their true length - never a long bar, which stretches whatever gesture
 * lands in it (the staged strobe led its slam by six real beats).
 *
 * The cuts come from the listener - a hand-drawn section map's off-grid boundaries, or
 * moments heard directly. An automatic plateau detector over per-bar onset phases was
 * built, measured against the one track with verified edits, and killed the same
 * evening: a backbeat is symmetric under a half-bar shift, so the broadband vote
 * carries no signal (the phase-0 truth region of Safir voted 0/0/5/2), and the
 * detector's one real act was hallucinating an edit on a praised sentinel. The
 * postmortem lives in the round record; an automatic form may return only with an
 * asymmetric voter, behind the same instruments that killed this one.
 */

/**
 * Bar starts for a grid honouring listener-supplied cuts: each cut is a beat index that
 * must become a bar line, and the walk absorbs the offset as one short bar ENDING at
 * the cut. Any offset 1..beatsPerBar-1 is absorbed, because a hand-drawn map is allowed
 * to know things a detector does not; a cut already on the walking grid changes nothing.
 */
export function barStartsAtCuts(
	beatCount: number,
	beatsPerBar: number,
	phase: number,
	cutBeats: readonly number[]
): number[] {
	const cuts = [...cutBeats].sort((a, b) => a - b);
	const starts: number[] = [phase];
	let beat = phase;
	let next = 0;
	while (true) {
		while (next < cuts.length && cuts[next] <= beat) next++;
		const toCut = next < cuts.length ? cuts[next] - beat : Infinity;
		const span = toCut >= 1 && toCut < beatsPerBar ? toCut : beatsPerBar;
		if (beat + span > beatCount) break;
		beat += span;
		starts.push(beat);
	}
	return starts;
}

/**
 * Grid cuts implied by a hand-drawn section map: every boundary whose beat residue
 * against the uniform grid differs from the previous boundary's marks a place where the
 * record inserted beats, and the cut sits at that boundary. A map drawn over a correct
 * uniform grid carries residue 0 everywhere and implies nothing; Safir's map carries
 * 0, 2, 2, 0 and implies exactly the two cuts the owner confirmed by ear.
 */
export function deriveGridCuts(
	boundaryTimes: readonly number[],
	beatTimes: Float64Array,
	beatsPerBar: number,
	phase: number
): number[] {
	const beatAt = (t: number): number => {
		let best = 0;
		for (let i = 1; i < beatTimes.length; i++) {
			if (Math.abs(beatTimes[i] - t) < Math.abs(beatTimes[best] - t)) best = i;
		}
		return best;
	};
	const cuts: number[] = [];
	let prev = 0;
	for (const t of boundaryTimes) {
		const beat = beatAt(t);
		// A boundary that does not actually sit on a beat is a drag artefact, not evidence.
		if (Math.abs(beatTimes[beat] - t) > 0.35) continue;
		const residue = (((beat - phase) % beatsPerBar) + beatsPerBar) % beatsPerBar;
		if (residue !== prev) {
			cuts.push(beatTimes[beat]);
			prev = residue;
		}
	}
	return cuts;
}
