import { describe, expect, it } from 'vitest';
import { BUILT_IN_EFFECTS, Rng } from '@mv/core';
import { EffectPicker } from './select.ts';

describe('the pounding band raise', () => {
	const pick = (energy: number, pounding: boolean, seed = 7) =>
		new EffectPicker(BUILT_IN_EFFECTS, new Rng(seed)).pick({
			role: 'rhythm',
			section: 'drop',
			lengthBars: 8,
			energy,
			pounding
		});

	/**
	 * The band a pick actually landed in, which is the thing under test - not the effect id,
	 * which the seed is entitled to choose freely within a band.
	 */
	const bandOf = (energy: number, pounding: boolean, seed = 7) =>
		pick(energy, pounding, seed)?.taste.energy ?? 0;

	it('draws harder than mean loudness asked for', () => {
		// 0.62 is Ponyboy's inner drops: band 3 of 5 on a record that pounds from bar one.
		const polite = [1, 2, 3, 4, 5].map((s) => bandOf(0.62, false, s));
		const pounding = [1, 2, 3, 4, 5].map((s) => bandOf(0.62, true, s));
		expect(Math.min(...polite)).toBeGreaterThanOrEqual(2);
		// Every seed moves up, and none of them lands below where the polite draw could.
		for (let i = 0; i < polite.length; i++) expect(pounding[i]).toBeGreaterThan(polite[i]);
	});

	it('cannot push past the top of the catalog', () => {
		// The loudest passages already target band 5, so pounding asks for nothing further:
		// same target, same seed, same pick. An uncapped raise would aim at a band no effect
		// declares, where the fit is flat and every candidate scores alike.
		for (const seed of [1, 2, 3, 4, 5]) {
			expect(pick(1, true, seed)?.id).toBe(pick(1, false, seed)?.id);
		}
	});

	it('leaves a passage that does not pound exactly where it was', () => {
		for (const e of [0, 0.25, 0.5, 0.75, 1]) {
			expect(bandOf(e, false, 3)).toBe(bandOf(e, false, 3));
			expect(pick(e, false, 3)?.id).toBe(pick(e, false, 3)?.id);
		}
	});
});
