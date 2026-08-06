import { makePalette } from '../color/palette.ts';
import { describe, expect, it } from 'vitest';
import { quantize } from '../output.ts';
import { DEFAULT_ROOM, buildGeometry } from '../geometry.ts';
import { BUILT_IN_EFFECTS } from './index.ts';
import { runGate, scriptFrames } from './gate.ts';

const g = buildGeometry(DEFAULT_ROOM);

describe.each(BUILT_IN_EFFECTS.map((d) => [d.id, d] as const))('%s', (_id, def) => {
	const result = runGate(def, g);

	it('passes the admission gate', () => {
		expect(result.failures).toEqual([]);
	});

	it('declares taste metadata the linter can use', () => {
		expect(def.taste.sections.length).toBeGreaterThan(0);
		expect(def.taste.energy).toBeGreaterThanOrEqual(1);
		expect(def.taste.energy).toBeLessThanOrEqual(5);
		expect(def.taste.maxBars).toBeGreaterThanOrEqual(def.taste.minBars);
	});

	it('exposes an intensity param unless it is pure darkness', () => {
		if (def.id === 'blackout') return;
		expect(def.params.some((p) => p.key === 'intensity')).toBe(true);
	});
});

it('every effect emits light', () => {
	const dark = BUILT_IN_EFFECTS.filter((d) => !runGate(d, g).producesLight).map((d) => d.id);
	expect(dark).toEqual([]);
});

it('blackout reads as darkness next to the wash it replaces', () => {
	const mean = (id: string) => {
		const def = BUILT_IN_EFFECTS.find((d) => d.id === id)!;
		const effect = def.create(g);
		const out = new Float32Array(g.count * 3);
		const frames = scriptFrames();
		const p: Record<string, number> = {};
		for (const spec of def.params) p[spec.key] = spec.default;
		const ctx = {
			g,
			f: frames[0],
			p,
			palette: makePalette({ base: 320, accent: 185 }),
			hueShift: 0,
			motion: 1
		};
		let sum = 0;
		for (const f of frames.slice(0, 600)) {
			ctx.f = f;
			effect.render(out, ctx);
			for (let i = 0; i < out.length; i++) sum += out[i];
		}
		return sum / (600 * out.length);
	};

	expect(mean('blackout')).toBeLessThan(mean('wash') * 0.05);
});

it('ids are unique', () => {
	const ids = BUILT_IN_EFFECTS.map((d) => d.id);
	expect(new Set(ids).size).toBe(ids.length);
});

describe('output stage', () => {
	it('drives an LED for the eye, not for a monitor', () => {
		// The exponent is gamma, not 1/gamma. An LED is linear in PWM duty and the eye is not,
		// so half-brightness is about 22 per cent duty. Encoding the sRGB way round drives it at
		// 73 per cent and every show comes out pale.
		const buf = Float32Array.from([1, 0.5, 0.25, 0, 0, 0]);
		const out = new Uint8Array(6);
		quantize(buf, out, 2.2);
		expect(out[0]).toBe(255);
		expect(out[1]).toBeGreaterThan(50);
		expect(out[1]).toBeLessThan(62);
		expect(out[2]).toBeGreaterThan(8);
		expect(out[2]).toBeLessThan(16);
		expect(out[3]).toBe(0);
	});

	it('never shimmers a full-scale pixel below 255', () => {
		const buf = new Float32Array(24).fill(1);
		const out = new Uint8Array(24);
		quantize(buf, out, 2.2);
		for (const byte of out) expect(byte).toBe(255);
	});

	it('keeps deep shades reachable rather than crushing them to black', () => {
		// The reason for 2.2 over Adafruit's 2.8, which puts everything under 0.1 on zero.
		const buf = Float32Array.from([0.1, 0.15, 0.2]);
		const out = new Uint8Array(3);
		quantize(buf, out, 2.2);
		for (const byte of out) expect(byte).toBeGreaterThan(0);
	});
});
