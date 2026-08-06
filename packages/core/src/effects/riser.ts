import type { EffectDef } from '../contracts/effect.ts';
import { Band } from '../contracts/frame.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { clamp, frac, lerp } from '../dsl/math.ts';
import { ratchet } from '../dsl/env.ts';
import { sinewave } from '../dsl/wave.ts';
import { INTENSITY, param } from './helpers.ts';

export const riser: EffectDef = {
	id: 'riser',
	name: 'Riser',
	role: 'rhythm',
	blurb: 'The ring is the progress bar: fills from both sides and bleaches white exactly on the drop.',
	taste: {
		energy: 4,
		sections: ['build'],
		minBars: 2,
		maxBars: 16,
		peakReserved: false
	},
	params: [INTENSITY, param('ticks', 'Segment ticks', 8, 0, 16, 1), param('bleach', 'Bleach', 0.8)],
	create(g) {
		let progress = 0;
		return {
			reset() {
				progress = 0;
			},
			render(out, ctx) {
				const { f, p, palette } = ctx;
				const target = f.buildProgress > 0 ? f.buildProgress : clamp(f.bands[Band.Air]);
				progress = ratchet(progress, target, f.dt, 0.12);

				const reach = progress * 0.5;
				const bleach = Math.pow(progress, 2) * p.bleach;
				const ticks = Math.round(p.ticks);

				for (let i = 0; i < g.count; i++) {
					const along = g.perim[i];
					// Mirror around the ring's start so the two fronts meet at the back wall
					// on the drop downbeat.
					const d = along < 0 ? 1 : Math.min(along, 1 - along);
					let v = d <= reach ? 1 : 0;
					if (v > 0 && ticks > 0) {
						const tickPhase = frac(d * ticks * 2);
						v *= 0.82 + 0.18 * sinewave(tickPhase);
					}
					const slot = lerp(SLOT.base, SLOT.white, bleach);
					setSample(out, i, palette, slot + ctx.hueShift, v * p.intensity * (0.5 + 0.5 * progress));
				}
			}
		};
	}
};
