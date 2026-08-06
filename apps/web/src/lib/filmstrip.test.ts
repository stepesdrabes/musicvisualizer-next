import { describe, expect, it } from 'vitest';
import { BUILT_IN_EFFECTS } from '@mv/core';
import { renderFilmstrip } from './filmstrip.ts';

const W = 120;
const H = 32;

describe('filmstrip', () => {
	it('renders something visible for every built-in effect', () => {
		// A card that is a black rectangle tells a reader nothing, and the usual causes are an
		// effect that only wakes on a trigger the preview never pulls, or one that lives on a
		// strip the strip does not show. `blackout` is the one that is meant to be black.
		const dark: string[] = [];
		for (const def of BUILT_IN_EFFECTS) {
			if (def.id === 'blackout') continue;
			const pixels = renderFilmstrip(def, W, H);
			let lit = 0;
			for (let i = 0; i < pixels.length; i += 4) {
				if (pixels[i] > 8 || pixels[i + 1] > 8 || pixels[i + 2] > 8) lit++;
			}
			// Eight pixels, not a percentage: `lightning` strikes twice in the whole journey and
			// should still show that it did.
			if (lit < 8) dark.push(def.id);
		}
		expect(dark).toEqual([]);
	});

	it('stays inside the byte range and paints every pixel opaque', () => {
		const pixels = renderFilmstrip(BUILT_IN_EFFECTS[0], W, H);
		expect(pixels.length).toBe(W * H * 4);
		for (let i = 3; i < pixels.length; i += 4) expect(pixels[i]).toBe(255);
	});

	it('gives the same image twice, so a card does not change under the reader', () => {
		const def = BUILT_IN_EFFECTS.find((e) => e.id === 'cascade') ?? BUILT_IN_EFFECTS[0];
		expect(Array.from(renderFilmstrip(def, W, H))).toEqual(Array.from(renderFilmstrip(def, W, H)));
	});
});
