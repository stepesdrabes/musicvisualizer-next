import { SLOT } from '../contracts/palette.ts';

export function clamp(v: number, lo = 0, hi = 1): number {
	return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

/** Positive fractional part, so negative inputs wrap instead of mirroring. */
export function frac(v: number): number {
	return v - Math.floor(v);
}

export function smoothstep(edge0: number, edge1: number, v: number): number {
	const t = clamp((v - edge0) / (edge1 - edge0));
	return t * t * (3 - 2 * t);
}

/**
 * Spread a 0..1 sweep across the lit part of the palette, base through accent and back.
 *
 * What an effect reaches for when it wants variety rather than one colour, and the answer to
 * why six effects were calling `hsv2rgb` with hues of their own: the spectrum is the only
 * continuous colour space an effect has unless something hands it one, and the show's own hues
 * are that space. Sampling the whole ring would not do, because `deep` and `accentDeep` are
 * near-black by design and a sweep through them flickers dark twice a cycle.
 *
 * Ping-pongs rather than wraps, so a rotating look has no seam where accent jumps back to base.
 */
export function paletteArc(u: number): number {
	const t = frac(u) * 2;
	return SLOT.base + (t <= 1 ? t : 2 - t) * (SLOT.accent - SLOT.base);
}

/** Frame-rate independent exponential coefficient for a time constant. */
export function alphaFor(dt: number, tau: number): number {
	return tau <= 0 ? 1 : 1 - Math.exp(-dt / tau);
}

/**
 * Asymmetric one-pole follower: fast attack, slow release.
 *
 * Rules of thumb: kick 0/0.12-0.25, bass 0.010/0.15-0.25, mid 0.018/0.20-0.35,
 * air 0.010/0.08-0.15, energy 0.05/0.40-0.80. Release around 0.6 * beatPeriod.
 */
export function envelope(
	current: number,
	target: number,
	dt: number,
	tauAttack: number,
	tauRelease: number
): number {
	const tau = target > current ? tauAttack : tauRelease;
	return current + (target - current) * alphaFor(dt, tau);
}

/** Shortest-arc interpolation on a 0..1 circle. */
export function lerpAngle01(a: number, b: number, t: number): number {
	let d = b - a;
	d -= Math.floor(d + 0.5);
	return frac(a + d * t);
}
