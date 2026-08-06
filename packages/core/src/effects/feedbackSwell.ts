import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { sinewave } from '../dsl/wave.ts';
import { INTENSITY } from './helpers.ts';

/**
 * The rock build is a held breath rather than a snare-roll meter: the whole room swells
 * while a vibrato shimmer tightens from a slow wow into a scream, released on the one.
 */
export const feedbackSwell: EffectDef = {
	id: 'feedbackSwell',
	name: 'Feedback Swell',
	role: 'rhythm',
	blurb: 'The room swells and its shimmer tightens, like feedback into the chorus.',
	taste: {
		energy: 4,
		sections: ['build'],
		minBars: 2,
		maxBars: 16,
		peakReserved: false
	},
	params: [INTENSITY],
	create(g) {
		let fill = 0;
		let shimmer = 0;

		return {
			reset() {
				fill = 0;
				shimmer = 0;
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;

				const delta = clamp(f.buildProgress - fill, -f.dt * 3, f.dt * 0.5);
				fill = clamp(fill + delta);
				if (fill < 0.01) {
					out.fill(0);
					return;
				}

				shimmer += f.dt * (1.5 + fill * fill * 22);
				const gain = (0.4 + p.intensity) * (0.25 + fill * 0.75);

				for (let i = 0; i < g.count; i++) {
					const u = g.perim[i] >= 0 ? g.perim[i] : g.local[i];
					const vib = 1 - 0.35 * fill * (0.5 + 0.5 * sinewave(u * 6 + shimmer));
					// Colour drains toward white as the feedback peaks.
					const slot = lerp(SLOT.base, SLOT.white, fill * fill);
					setSample(out, i, palette, slot + hueShift, gain * vib);
				}
			}
		};
	}
};
