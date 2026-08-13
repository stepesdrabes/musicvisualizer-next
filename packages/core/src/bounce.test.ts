import { describe, expect, it } from 'vitest';
import { createShowFrame } from './contracts/frame.ts';
import { SLOT } from './contracts/palette.ts';
import { makePalette, sample } from './color/palette.ts';
import { BounceLamp } from './bounce.ts';

const PALETTE = makePalette({ base: 320, accent: 185 });
const DT = 1 / 60;

/** A room at a uniform level, which is what the lamp reduces. */
function room(level: number, pixels = 720): Float32Array {
	return new Float32Array(pixels * 3).fill(level);
}

function run(frames: number, level: number, kick = 0): Uint8Array {
	const lamp = new BounceLamp();
	const out = new Uint8Array(3);
	const f = createShowFrame();
	const lit = room(level);
	const tint = sample(PALETTE, SLOT.accent, 1, [0, 0, 0]);
	for (let i = 0; i < frames; i++) {
		f.kickEnv = kick;
		lamp.render(lit, f, tint, DT, out);
	}
	return out;
}

const brightness = (b: Uint8Array) => Math.max(b[0], b[1], b[2]);

describe('the bounce lamp', () => {
	it('is dark when the room is', () => {
		expect([...run(120, 0)]).toEqual([0, 0, 0]);
	});

	it('holds a floor rather than going out under a quiet passage', () => {
		expect(brightness(run(240, 0.05))).toBeGreaterThan(0);
	});

	it('is brighter in a drop than in an intro', () => {
		expect(brightness(run(240, 0.9))).toBeGreaterThan(brightness(run(240, 0.28)));
	});

	it('answers a kick on the frame it arrives on', () => {
		const lamp = new BounceLamp();
		const out = new Uint8Array(3);
		const f = createShowFrame();
		const lit = room(0.4);
		const tint = sample(PALETTE, SLOT.accent, 1, [0, 0, 0]);

		for (let i = 0; i < 240; i++) lamp.render(lit, f, tint, DT, out);
		const settled = brightness(out);

		f.kickEnv = 1;
		lamp.render(lit, f, tint, DT, out);
		expect(brightness(out)).toBeGreaterThan(settled);

		// And lets go of it: ~100 ms, so six frames is most of the way back down.
		f.kickEnv = 0;
		const hit = brightness(out);
		for (let i = 0; i < 12; i++) lamp.render(lit, f, tint, DT, out);
		expect(brightness(out)).toBeLessThan(hit);
	});

	it('shows the palette accent, not the room colour', () => {
		const out = run(240, 0.9);
		const accent = sample(PALETTE, SLOT.accent, 1, [0, 0, 0]);
		const order = (v: number[]) => [...v.keys()].sort((a, b) => v[b] - v[a]);
		expect(order([...out])).toEqual(order([...accent]));
	});

	it('is deterministic, so a seek reproduces the frame', () => {
		expect([...run(180, 0.6, 0.4)]).toEqual([...run(180, 0.6, 0.4)]);
	});

	it('starts again from a reset', () => {
		const lamp = new BounceLamp();
		const fresh = new Uint8Array(3);
		const reused = new Uint8Array(3);
		const f = createShowFrame();
		const tint = sample(PALETTE, SLOT.accent, 1, [0, 0, 0]);

		for (let i = 0; i < 300; i++) lamp.render(room(0.9), f, tint, DT, reused);
		lamp.reset();
		for (let i = 0; i < 30; i++) lamp.render(room(0.2), f, tint, DT, reused);

		const other = new BounceLamp();
		for (let i = 0; i < 30; i++) other.render(room(0.2), f, tint, DT, fresh);
		expect([...reused]).toEqual([...fresh]);
	});
});
