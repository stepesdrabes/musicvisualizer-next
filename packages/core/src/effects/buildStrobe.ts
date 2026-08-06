import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { sample } from '../color/palette.ts';
import { PulseEnv } from '../dsl/env.ts';
import { INTENSITY } from './helpers.ts';

/**
 * A build is not a smooth Hz ramp, it is a musical one: half notes, then quarters, then
 * 8ths, then 16ths, so the light plays the snare roll. Held below full brightness so the
 * drop still owns the brightest frame of the show.
 */
export const buildStrobe: EffectDef = {
	id: 'buildStrobe',
	name: 'Build Strobe',
	role: 'accent',
	blurb: 'Flashes on a grid that doubles: 1/2 -> 1/4 -> 1/8 -> 1/16 into the drop.',
	taste: {
		energy: 4,
		sections: ['build'],
		minBars: 2,
		maxBars: 16,
		peakReserved: false
	},
	params: [INTENSITY],
	create(g) {
		const env = new PulseEnv();
		let lastSlot = -1;

		return {
			reset() {
				env.reset();
				lastSlot = -1;
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;

				const progress = f.buildProgress;
				const v = env.decay(f.dt, f.beatPeriod, 0.54);
				if (progress < 0.03 && v < 0.01) {
					out.fill(0);
					return;
				}

				if (progress >= 0.03) {
					const per = progress < 0.35 ? 2 : progress < 0.65 ? 1 : progress < 0.88 ? 0.5 : 0.25;
					const slot = Math.floor((f.beatIndex + f.beatPhase) / per);
					if (slot !== lastSlot) {
						lastSlot = slot;
						env.fire(1);
					}
				}

				const gain = env.value * (0.25 + 0.5 * progress) * (0.5 + p.intensity);
				if (gain < 0.005) {
					out.fill(0);
					return;
				}
				const c = sample(palette, SLOT.white + hueShift, gain);
				for (let i = 0; i < g.count; i++) {
					const o = i * 3;
					out[o] = c[0];
					out[o + 1] = c[1];
					out[o + 2] = c[2];
				}
			}
		};
	}
};
