import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { sinewave } from '../dsl/wave.ts';
import { ringU } from '../dsl/space.ts';
import { INTENSITY, param } from './helpers.ts';

/**
 * Constant hue, pure phase-spread brightness - the most restrained motion layer, and the
 * right default when the groove should feel liquid rather than punchy.
 */
export const sineRoll: EffectDef = {
	id: 'sineRoll',
	name: 'Sine Roll',
	role: 'rhythm',
	blurb: 'A liquid brightness wave rolling around the room, one cycle per N beats.',
	taste: {
		energy: 2,
		sections: ['groove', 'breakdown', 'intro', 'outro'],
		minBars: 4,
		maxBars: 64,
		peakReserved: false
	},
	params: [
		INTENSITY,
		param('perBeat', 'Beats per cycle', 4, 1, 16, 1),
		param('waves', 'Waves around room', 4, 1, 8, 1)
	],
	create(g) {
		return {
			reset() {},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;

				const phase = (f.beatIndex + f.beatPhase) / Math.max(1, p.perBeat);
				const waves = Math.max(1, Math.round(p.waves));
				const gain = (0.4 + p.intensity) * clamp(0.3 + f.energy * 0.9);

				for (let i = 0; i < g.count; i++) {
					const u = ringU(g, i);
					// Squared, so the wave dwells near dark and the crests punch.
					const w = Math.pow(sinewave(u * waves - phase), 2);
					const slot = lerp(SLOT.deep, SLOT.glow, w);
					setSample(out, i, palette, slot + hueShift, (0.15 + 0.85 * w) * gain);
				}
			}
		};
	}
};
