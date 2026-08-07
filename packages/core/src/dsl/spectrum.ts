import type { ShowFrame } from '../contracts/frame.ts';

/**
 * The spectrum, addressed by where a band sits rather than by its index.
 *
 * `u` runs 0 at the bottom of the analysed range to 1 at the top, interpolated between bands, so
 * an effect maps its own geometry onto the spectrum without knowing how many bands there are.
 * Mapping a strip's position straight onto `u` is the whole idiom.
 */
export function bandAt(f: ShowFrame, u: number): number {
	const s = f.spectrum;
	const n = s.length;
	if (n === 0) return 0;
	const x = (u <= 0 ? 0 : u >= 1 ? 1 : u) * (n - 1);
	const i = Math.floor(x);
	return i + 1 < n ? s[i] + (s[i + 1] - s[i]) * (x - i) : s[i];
}

/** Mean level over a slice of the spectrum, `from` and `to` in the same 0..1 as `bandAt`. */
export function bandBetween(f: ShowFrame, from: number, to: number): number {
	const s = f.spectrum;
	const n = s.length;
	if (n === 0) return 0;
	const lo = Math.max(0, Math.min(n - 1, Math.floor(from * n)));
	const hi = Math.max(lo + 1, Math.min(n, Math.ceil(to * n)));
	let acc = 0;
	for (let i = lo; i < hi; i++) acc += s[i];
	return acc / (hi - lo);
}

/** The loudest band right now, 0..1. What a meter's ceiling should be scaled against. */
export function spectrumPeak(f: ShowFrame): number {
	const s = f.spectrum;
	let peak = 0;
	for (let i = 0; i < s.length; i++) if (s[i] > peak) peak = s[i];
	return peak;
}

/**
 * Where the energy is sitting, 0 at the bottom of the range to 1 at the top.
 *
 * The spectral centroid, which is the one number that says "this passage is bright" without
 * saying how loud it is. Drive a hue walk or a position with it and the room follows the arrangement
 * opening up rather than following its level. Returns 0.5 on silence, because a centroid of
 * nothing has no meaning and snapping to an end of the range would read as a move.
 */
export function spectralTilt(f: ShowFrame): number {
	const s = f.spectrum;
	const n = s.length;
	if (n < 2) return 0.5;
	let weighted = 0;
	let total = 0;
	for (let i = 0; i < n; i++) {
		weighted += s[i] * i;
		total += s[i];
	}
	return total > 1e-6 ? weighted / total / (n - 1) : 0.5;
}

/**
 * How uneven the spectrum is, 0 when every band is level and 1 when one band has it all.
 *
 * What separates a single sustained note from a full arrangement at the same loudness, which is
 * most of what an intro needs to look like something rather than like a dimmer.
 */
export function spectrumFocus(f: ShowFrame): number {
	const s = f.spectrum;
	const n = s.length;
	if (n < 2) return 0;
	let total = 0;
	let peak = 0;
	for (let i = 0; i < n; i++) {
		total += s[i];
		if (s[i] > peak) peak = s[i];
	}
	if (peak < 1e-6) return 0;
	const flat = total / n / peak;
	return 1 - flat;
}
