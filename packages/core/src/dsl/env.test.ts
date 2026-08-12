import { describe, expect, it } from 'vitest';
import { Presence } from './env.ts';

describe('Presence', () => {
	const beat = 0.5;
	const silence = (p: Presence, seconds: number) => {
		let v = 1;
		for (let t = 0; t < seconds; t += 0.016) v = p.update(0, 0.016, beat);
		return v;
	};

	it('arms on a hit, holds through a pattern gap, rests after the kit leaves', () => {
		const p = new Presence(4, 4);
		expect(p.update(0, 0.016, beat)).toBe(0);
		p.update(1, 0.016, beat);
		// One beat of silence is a gap four-on-the-floor actually contains: still full.
		expect(silence(p, 0.5)).toBeGreaterThan(0.95);
		// Two more bars of silence is the kick having left: resting.
		expect(silence(p, 4)).toBeLessThan(0.1);
	});

	it('rises only to the hit its own strength, so a ghost note arms a ghost', () => {
		const p = new Presence(4, 4);
		expect(p.update(0.35, 0.016, beat)).toBeCloseTo(0.35, 5);
		// A full hit lifts it the rest of the way immediately.
		expect(p.update(1, 0.016, beat)).toBe(1);
	});
});
