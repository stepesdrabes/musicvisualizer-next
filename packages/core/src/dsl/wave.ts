import { clamp, frac } from './math.ts';

/** 0..1 triangle. */
export function triwave(v: number): number {
	const t = frac(v);
	return t < 0.5 ? t * 2 : 2 - t * 2;
}

/** 0..1 sine, phase 0 at the trough. */
export function sinewave(v: number): number {
	return 0.5 - 0.5 * Math.cos(frac(v) * Math.PI * 2);
}

/** Hard leading edge then exponential tail. The shape of a hit. */
export function pulse(phase: number, falloff = 6): number {
	const t = frac(phase);
	return Math.exp(-t * falloff);
}

const PERM = new Uint8Array(512);
{
	const p = new Uint8Array(256);
	for (let i = 0; i < 256; i++) p[i] = i;
	// Fixed shuffle: the noise field must be identical across runs and machines.
	let s = 1013904223;
	for (let i = 255; i > 0; i--) {
		s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
		const j = s % (i + 1);
		const tmp = p[i];
		p[i] = p[j];
		p[j] = tmp;
	}
	for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
}

function fade(t: number): number {
	return t * t * t * (t * (t * 6 - 15) + 10);
}

function grad(hash: number, x: number, y: number, z: number): number {
	const h = hash & 15;
	const u = h < 8 ? x : y;
	const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
	return (h & 1 ? -u : u) + (h & 2 ? -v : v);
}

/** Improved Perlin, mapped to 0..1 and range-expanded so it actually reaches the ends. */
export function noise3(x: number, y: number, z: number): number {
	const X = Math.floor(x) & 255;
	const Y = Math.floor(y) & 255;
	const Z = Math.floor(z) & 255;
	const xf = x - Math.floor(x);
	const yf = y - Math.floor(y);
	const zf = z - Math.floor(z);
	const u = fade(xf);
	const v = fade(yf);
	const w = fade(zf);

	const A = PERM[X] + Y;
	const AA = PERM[A] + Z;
	const AB = PERM[A + 1] + Z;
	const B = PERM[X + 1] + Y;
	const BA = PERM[B] + Z;
	const BB = PERM[B + 1] + Z;

	const x1 = grad(PERM[AA], xf, yf, zf);
	const x2 = grad(PERM[BA], xf - 1, yf, zf);
	const x3 = grad(PERM[AB], xf, yf - 1, zf);
	const x4 = grad(PERM[BB], xf - 1, yf - 1, zf);
	const x5 = grad(PERM[AA + 1], xf, yf, zf - 1);
	const x6 = grad(PERM[BA + 1], xf - 1, yf, zf - 1);
	const x7 = grad(PERM[AB + 1], xf, yf - 1, zf - 1);
	const x8 = grad(PERM[BB + 1], xf - 1, yf - 1, zf - 1);

	const y1 = x1 + u * (x2 - x1);
	const y2 = x3 + u * (x4 - x3);
	const y3 = x5 + u * (x6 - x5);
	const y4 = x7 + u * (x8 - x7);

	const z1 = y1 + v * (y2 - y1);
	const z2 = y3 + v * (y4 - y3);

	return clamp(0.5 + (z1 + w * (z2 - z1)) * 0.72);
}
