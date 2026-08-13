import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { Follower } from '../dsl/env.ts';
import { bandBetween } from '../dsl/spectrum.ts';
import { ringU } from '../dsl/space.ts';
import { INTENSITY, param } from './helpers.ts';

/**
 * Two dim combs of light run the ring in opposite directions, and the picture is their
 * INTERFERENCE: where teeth align the room brightens, where they oppose it rests, so
 * slow bright beat-patterns drift through the walls with no element of the picture
 * actually travelling fast. The comb speeds are locked to the grid a quarter apart, so
 * the moire pattern itself cycles exactly once per four bars - structure the eye learns
 * without being able to say why.
 */
export const weave: EffectDef = {
	id: 'weave',
	name: 'Weave',
	role: 'rhythm',
	blurb: 'Two counter-running combs interfere; the beat pattern drifts while nothing races.',
	taste: {
		energy: 2,
		sections: ['intro', 'groove', 'verse', 'breakdown', 'drop', 'outro'],
		minBars: 2,
		maxBars: 64,
		peakReserved: false
	},
	params: [INTENSITY, param('teeth', 'Comb teeth', 8, 4, 14, 1)],
	create(g) {
		const mid = new Follower(0.03, 0.2);

		return {
			reset() {
				mid.reset();
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;
				// Grid-locked phases off the absolute bar clock: a seek reproduces the frame,
				// and the quarter-per-four-bars split is what makes the interference cycle
				// breathe with the phrase rather than at an arbitrary rate.
				const bars = f.barIndex + f.barPhase;
				const a = bars / 4;
				const b = -bars / 4 + 0.125;
				const teeth = Math.max(4, Math.round(p.teeth));
				const level = mid.update(clamp(bandBetween(f, 0.25, 0.8)), f.dt);
				const gain = (0.3 + p.intensity * 0.5) * (0.45 + level * 0.55);

				for (let i = 0; i < g.count; i++) {
					const u = ringU(g, i);
					const combA = 0.5 + 0.5 * Math.cos((u + a) * teeth * Math.PI * 2);
					const combB = 0.5 + 0.5 * Math.cos((u + b) * teeth * Math.PI * 2);
					const meet = combA * combB;
					// Constructive crossings graze glow; the rest of the field sits between
					// deep and base, so the picture is pattern rather than brightness.
					const slot = lerp(SLOT.deep, lerp(SLOT.base, SLOT.glow, meet), 0.3 + meet * 0.7);
					setSample(out, i, palette, slot + hueShift, (0.15 + meet * 0.85) * gain);
				}
			}
		};
	}
};
