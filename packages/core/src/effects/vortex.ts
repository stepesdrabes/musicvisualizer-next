import type { EffectDef } from '../contracts/effect.ts';
import { sample } from '../color/palette.ts';
import { SLOT } from '../contracts/palette.ts';
import { alphaFor, clamp, frac, lerp, paletteArc } from '../dsl/math.ts';
import { nblend, setPixel } from '../dsl/buffer.ts';
import { sinewave } from '../dsl/wave.ts';
import { INTENSITY, param } from './helpers.ts';

/**
 * A spiral field in (theta, dist) space. The ceiling beam sits near the room's axis, so
 * it naturally becomes the vortex's bright eye. The kick surge is integrated, which gives
 * the swirl inertia instead of a twitch.
 */
export const vortex: EffectDef = {
	id: 'vortex',
	name: 'Vortex',
	role: 'rhythm',
	blurb: 'A full-spectrum spiral swirling around the room, kicked forward by the kick.',
	taste: {
		energy: 4,
		sections: ['groove', 'breakdown', 'build', 'drop'],
		minBars: 2,
		maxBars: 16,
		peakReserved: false
	},
	params: [
		INTENSITY,
		param('barsPerRev', 'Bars per revolution', 2, 0.5, 8, 0.5),
		param('twist', 'Spiral twist', 0.5)
	],
	create(g) {
		const buf = new Float32Array(g.count * 3);
		const rgb: [number, number, number] = [0, 0, 0];
		let surge = 0;

		return {
			reset() {
				surge = 0;
				buf.fill(0);
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;

				surge += f.kickEnv * f.dt * 1.8;
				surge *= Math.exp(-f.dt / 1.4);
				const spin = (f.barIndex + f.barPhase) / Math.max(0.5, p.barsPerRev) + surge;
				const twist = 1 + p.twist * 3;
				const gain = (0.45 + p.intensity * 1.1) * clamp(0.3 + f.energy * 0.9);

				for (let i = 0; i < g.count; i++) {
					const s = frac(g.theta[i] + g.dist[i] * twist * 0.4 - spin);
					// Two arms: brightness peaks twice per revolution, squared for shade.
					const w = Math.pow(sinewave(s * 2), 2);
					// Near the axis, brightness lifts toward white-hot: the eye of the vortex.
					const eye = Math.max(0, 1 - g.r[i] * 3.2);
					// The eye reads toward white by moving up the palette rather than by desaturating,
					// which is the same gesture without leaving the show's colours.
					const u = eye > 0 ? lerp(paletteArc(s + hueShift), SLOT.white, eye * 0.7) : paletteArc(s + hueShift);
					sample(palette, u, (0.2 + 0.8 * w + eye * 0.6) * gain, rgb);
					setPixel(buf, i, rgb[0], rgb[1], rgb[2]);
				}

				nblend(out, buf, alphaFor(f.dt, 0.05));
			}
		};
	}
};
