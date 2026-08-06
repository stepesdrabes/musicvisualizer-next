/**
 * Snap drum onsets onto the beat grid, and fill in the ones the detector missed.
 *
 * A detector that finds four kicks in five is precise and still looks wrong in a room: the
 * flashes land on beats 1, 2 and 4 and the eye reads the gap, not the accuracy. On music
 * programmed in a DAW the kick that was missed was still played, exactly on the grid, so the
 * repair is not more sensitivity - loosening the thresholds counts the bassline instead - but
 * asking what pattern this passage plays and completing it.
 *
 * Nothing is invented in a bar where the instrument is silent. A fill only reaches bars that
 * already have that drum in them, so a breakdown stays a breakdown.
 */
export interface QuantiseOptions {
	beats: Float64Array;
	beatsPerBar: number;
	/** Subdivisions per beat. Four resolves a sixteenth, which is as fine as a kit is placed. */
	perBeat?: number;
	/** Fraction of a subdivision an onset may sit from the grid and still be called on it. */
	tolerance?: number;
	/** How much of a window's active bars must agree before a slot counts as the pattern. */
	agreement?: number;
	/** Bars considered together when looking for the pattern. */
	windowBars?: number;
	/** Track length. Completing a pattern must not invent hits past the end of the audio. */
	duration: number;
}

export function quantiseOnsets(times: readonly number[], opts: QuantiseOptions): number[] {
	const { beats, beatsPerBar } = opts;
	const perBeat = opts.perBeat ?? 4;
	const tolerance = opts.tolerance ?? 0.5;
	const agreement = opts.agreement ?? 0.5;
	const windowBars = opts.windowBars ?? 8;

	if (beats.length < 2 || times.length === 0) return [...times];

	const period = (beats[beats.length - 1] - beats[0]) / (beats.length - 1);
	const step = period / perBeat;
	const first = beats[0];
	const slotsPerBar = beatsPerBar * perBeat;
	const totalSlots = Math.ceil((beats[beats.length - 1] + period - first) / step);
	if (totalSlots <= 0) return [...times];

	const slotTime = (slot: number) => first + slot * step;

	// Every onset lands on its nearest subdivision, or is dropped if it is nowhere near one.
	// A hit that far off the grid is either a detector artefact or genuinely unquantised, and
	// in both cases it is not part of a pattern.
	const onSlot = new Uint8Array(totalSlots + slotsPerBar);
	for (const t of times) {
		const slot = Math.round((t - first) / step);
		if (slot < 0 || slot >= onSlot.length) continue;
		if (Math.abs(t - slotTime(slot)) > step * tolerance) continue;
		onSlot[slot] = 1;
	}

	const bars = Math.ceil(onSlot.length / slotsPerBar);
	const barActive = new Uint8Array(bars);
	for (let bar = 0; bar < bars; bar++) {
		for (let k = 0; k < slotsPerBar; k++) {
			if (onSlot[bar * slotsPerBar + k]) {
				barActive[bar] = 1;
				break;
			}
		}
	}

	const out = new Uint8Array(onSlot.length);
	out.set(onSlot);

	// The pattern is read from a window rather than from the whole track, so a groove that
	// changes its kick pattern halfway through gets both patterns rather than their average.
	for (let from = 0; from < bars; from += windowBars) {
		const to = Math.min(bars, from + windowBars);
		let active = 0;
		for (let bar = from; bar < to; bar++) active += barActive[bar];
		if (active < 2) continue;

		for (let k = 0; k < slotsPerBar; k++) {
			let fires = 0;
			for (let bar = from; bar < to; bar++) {
				if (barActive[bar] && onSlot[bar * slotsPerBar + k]) fires++;
			}
			if (fires / active < agreement) continue;
			for (let bar = from; bar < to; bar++) {
				if (barActive[bar]) out[bar * slotsPerBar + k] = 1;
			}
		}
	}

	const result: number[] = [];
	for (let slot = 0; slot < out.length; slot++) {
		if (!out[slot]) continue;
		const t = slotTime(slot);
		if (t < 0 || t > opts.duration) continue;
		result.push(t);
	}
	return result;
}
