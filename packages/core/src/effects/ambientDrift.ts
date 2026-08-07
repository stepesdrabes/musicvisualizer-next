import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { frac, lerp } from '../dsl/math.ts';
import { sinewave } from '../dsl/wave.ts';
import { ringU } from '../dsl/space.ts';
import { INTENSITY, param } from './helpers.ts';

/**
 * Deliberately dull, on a 30-60 s period and deaf to the music: silence should look like
 * the room resting, not like the analyser chewing on the noise floor.
 */
export const ambientDrift: EffectDef = {
	id: 'ambientDrift',
	name: 'Ambient Drift',
	role: 'bed',
	blurb: 'Calm idle wash. Very slow, very dim, ignores the music.',
	taste: {
		energy: 1,
		sections: ['intro', 'groove', 'breakdown', 'build', 'void', 'drop', 'outro'],
		minBars: 2,
		maxBars: 64,
		peakReserved: false
	},
	params: [INTENSITY, param('period', 'Period', 0.5)],
	create(g) {
		let phase = 0;
		return {
			reset() {
				phase = 0;
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;
				phase += f.dt / (30 + p.period * 30);
				const gain = 0.32 + p.intensity * 0.5;

				for (let i = 0; i < g.count; i++) {
					const u = ringU(g, i);
					const v = 0.35 + 0.65 * sinewave(u * 0.7 + phase);
					const slot = lerp(SLOT.deep, SLOT.glow, v);
					setSample(out, i, palette, slot + frac(phase * 0.3) * 0.06 + hueShift, v * gain);
				}
			}
		};
	}
};
