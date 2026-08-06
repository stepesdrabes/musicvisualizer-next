import type { EffectDef } from '../contracts/effect.ts';
import { Band } from '../contracts/frame.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { clamp, envelope, lerp } from '../dsl/math.ts';
import { setPixel } from '../dsl/buffer.ts';
import { beatRelease, INTENSITY, param } from './helpers.ts';

/**
 * Not an event but a continuous bloom whose REACH follows the sub-bass, so it
 * complements the kick shells without competing with them. When the sub cuts out before
 * a drop the swell collapses and takes the room's warmth with it.
 */
export const subSwell: EffectDef = {
	id: 'subSwell',
	name: 'Sub Swell',
	role: 'transient',
	blurb: 'Radial bloom from the room centre riding the sub-bass envelope.',
	taste: {
		energy: 3,
		sections: ['groove', 'breakdown', 'build', 'drop'],
		minBars: 2,
		maxBars: 32,
		peakReserved: false
	},
	params: [INTENSITY, param('reach', 'Max reach', 0.6)],
	create(g) {
		let env = 0;
		return {
			reset() {
				env = 0;
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;

				env = envelope(
					env,
					clamp(f.bands[Band.Sub] * 1.4),
					f.dt,
					0.012,
					beatRelease(f.beatPeriod, 0.7)
				);
				const reach = env * (0.35 + p.reach * 0.65);
				const gain = 0.4 + p.intensity;

				for (let i = 0; i < g.count; i++) {
					const d = g.dist[i];
					if (d > reach || reach < 0.02) {
						setPixel(out, i, 0, 0, 0);
						continue;
					}
					const v = 1 - d / reach;
					// Deep shade at the rim, base at the core: a pool of colour, not a spot.
					const slot = lerp(SLOT.deep, SLOT.base, v);
					setSample(out, i, palette, slot + hueShift, v * v * env * gain);
				}
			}
		};
	}
};
