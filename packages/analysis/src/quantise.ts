/**
 * Repair a drum track against the beat grid, without moving the hits that were found.
 *
 * A detector that finds four kicks in five is precise and still looks wrong in a room: the
 * flashes land on beats 1, 2 and 4 and the eye reads the gap, not the accuracy. On music
 * programmed in a DAW the kick that was missed was still played, exactly on the grid, so the
 * repair is not more sensitivity - loosening the thresholds counts the bassline instead - but
 * asking what pattern this passage plays and completing it.
 *
 * Two things this deliberately does NOT do, both of which it used to:
 *
 * Detected hits keep their detected time. Snapping them to the nearest sixteenth moves them by
 * up to half a slot, which is 58 ms at 130 bpm, and a flash 58 ms off the drum reads as late
 * however accurate the underlying detection was. The grid decides whether a hit is real and
 * where a missing one goes; it does not get to correct one that was heard.
 *
 * Slot times come from the beat array, not from an averaged period. A single period laid from
 * beat zero is a straight line, and on a track that speeds up the music walks off it.
 */
export interface QuantiseOptions {
	beats: Float64Array;
	beatsPerBar: number;
	/** Which beat index mod beatsPerBar starts a bar, so invented hits land in real bars. */
	downbeatPhase?: number;
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

export interface QuantisedOnsets {
	times: number[];
	/** True where the hit was completed from the pattern rather than detected. */
	invented: boolean[];
}

/** Time of subdivision `slot`, interpolated inside the real beat it falls in. */
function slotTimeOf(beats: Float64Array, perBeat: number, slot: number): number {
	const beat = Math.floor(slot / perBeat);
	const frac = (slot - beat * perBeat) / perBeat;
	const last = beats.length - 1;
	if (beat >= last) {
		const span = last >= 1 ? beats[last] - beats[last - 1] : 0.5;
		return beats[last] + (beat - last + frac) * span;
	}
	if (beat < 0) {
		const span = last >= 1 ? beats[1] - beats[0] : 0.5;
		return beats[0] + (beat + frac) * span;
	}
	return beats[beat] + (beats[beat + 1] - beats[beat]) * frac;
}

export function quantiseOnsets(
	times: readonly number[],
	opts: QuantiseOptions
): QuantisedOnsets {
	const { beats, beatsPerBar } = opts;
	const perBeat = opts.perBeat ?? 4;
	const tolerance = opts.tolerance ?? 0.5;
	const agreement = opts.agreement ?? 0.5;
	const windowBars = opts.windowBars ?? 8;
	const downbeatPhase = opts.downbeatPhase ?? 0;

	if (beats.length < 2 || times.length === 0) {
		return { times: [...times], invented: times.map(() => false) };
	}

	const slotsPerBar = beatsPerBar * perBeat;
	// Slot 0 is the first downbeat, so a bar of slots is a real bar and a pattern read off it
	// is the pattern the drummer played rather than one rotated by a beat or two.
	const firstSlot = downbeatPhase * perBeat;
	const totalSlots = Math.max(0, (beats.length - 1 - downbeatPhase) * perBeat + slotsPerBar);
	if (totalSlots <= 0) return { times: [...times], invented: times.map(() => false) };

	const slotTime = (slot: number) => slotTimeOf(beats, perBeat, firstSlot + slot);

	// Each detection is assigned to a slot for the pattern vote, and its own time is kept.
	const detectedAt = new Map<number, number>();
	for (const t of times) {
		let lo = 0;
		let hi = totalSlots - 1;
		while (hi - lo > 1) {
			const mid = (lo + hi) >> 1;
			if (slotTime(mid) <= t) lo = mid;
			else hi = mid;
		}
		const slot = Math.abs(slotTime(lo) - t) <= Math.abs(slotTime(hi) - t) ? lo : hi;
		if (slot < 0 || slot >= totalSlots) continue;
		const span = Math.max(1e-6, slotTime(slot + 1) - slotTime(slot));
		// Genuinely unquantised, or a detector artefact. Either way it is not part of a pattern,
		// so it does not vote; it is still reported, because it was heard.
		if (Math.abs(t - slotTime(slot)) > span * tolerance) continue;
		const prev = detectedAt.get(slot);
		if (prev === undefined || Math.abs(t - slotTime(slot)) < Math.abs(prev - slotTime(slot))) {
			detectedAt.set(slot, t);
		}
	}

	const bars = Math.ceil(totalSlots / slotsPerBar);
	const barActive = new Uint8Array(bars);
	for (const slot of detectedAt.keys()) {
		const bar = Math.floor(slot / slotsPerBar);
		if (bar >= 0 && bar < bars) barActive[bar] = 1;
	}

	const filled = new Map<number, number>(detectedAt);
	const invented = new Set<number>();

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
				if (barActive[bar] && detectedAt.has(bar * slotsPerBar + k)) fires++;
			}
			if (fires / active < agreement) continue;
			for (let bar = from; bar < to; bar++) {
				if (!barActive[bar]) continue;
				const slot = bar * slotsPerBar + k;
				if (filled.has(slot) || slot >= totalSlots) continue;
				filled.set(slot, slotTime(slot));
				invented.add(slot);
			}
		}
	}

	const slots = [...filled.keys()].sort((a, b) => a - b);
	const outTimes: number[] = [];
	const outInvented: boolean[] = [];
	for (const slot of slots) {
		const t = filled.get(slot)!;
		if (t < 0 || t > opts.duration) continue;
		outTimes.push(t);
		outInvented.push(invented.has(slot));
	}

	// Detections that fell outside the slot grid entirely were never voted on, and would be
	// lost if only the map were read.
	for (const t of times) {
		if (t < 0 || t > opts.duration) continue;
		if (outTimes.some((x) => Math.abs(x - t) < 1e-9)) continue;
		let lo = 0;
		let hi = totalSlots - 1;
		while (hi - lo > 1) {
			const mid = (lo + hi) >> 1;
			if (slotTime(mid) <= t) lo = mid;
			else hi = mid;
		}
		const slot = Math.abs(slotTime(lo) - t) <= Math.abs(slotTime(hi) - t) ? lo : hi;
		const span = Math.max(1e-6, slotTime(slot + 1) - slotTime(slot));
		if (Math.abs(t - slotTime(slot)) <= span * tolerance) continue;
		outTimes.push(t);
		outInvented.push(false);
	}

	const order = outTimes.map((_, i) => i).sort((a, b) => outTimes[a] - outTimes[b]);
	return {
		times: order.map((i) => outTimes[i]),
		invented: order.map((i) => outInvented[i])
	};
}
