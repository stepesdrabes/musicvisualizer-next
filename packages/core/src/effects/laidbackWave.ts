import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { clamp, frac, lerp } from '../dsl/math.ts';
import { sinewave } from '../dsl/wave.ts';
import { INTENSITY, param } from './helpers.ts';

/**
 * The tempo of a crowd nodding, not dancing. Heavy sine easing makes the wave linger at
 * each wall like a nod at its peak; anything faster breaks a half-time pocket.
 */
export const laidbackWave: EffectDef = {
	id: 'laidbackWave',
	name: 'Laidback Wave',
	role: 'rhythm',
	blurb: 'One eased head-nod wave rolling through the room every two bars.',
	taste: {
		energy: 2,
		sections: ['groove', 'breakdown', 'intro', 'outro'],
		minBars: 4,
		maxBars: 32,
		peakReserved: false
	},
	params: [INTENSITY, param('barsPerWave', 'Bars per wave', 2, 1, 4, 1)],
	create(g) {
		return {
			reset() {},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;

				const phase = frac((f.barIndex + f.barPhase) / Math.max(1, p.barsPerWave));
				const front = sinewave(phase);
				const level = clamp(0.3 + f.energy * 0.7) * (0.4 + p.intensity);

				for (let i = 0; i < g.count; i++) {
					const d = g.ny[i] - front;
					const wave = Math.exp(-d * d * 12);
					const slot = lerp(SLOT.deep, SLOT.base, clamp(0.4 + wave * 0.6));
					setSample(out, i, palette, slot + hueShift, (0.3 + 0.7 * wave) * level);
				}
			}
		};
	}
};
