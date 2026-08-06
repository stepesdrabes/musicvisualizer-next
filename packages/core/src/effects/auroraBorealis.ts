import type { EffectDef } from '../contracts/effect.ts';
import { hash01 } from '../dsl/rng.ts';
import { hsv2rgb } from '../color/hsv.ts';
import { clamp, envelope, frac, lerp } from '../dsl/math.ts';
import { nblend } from '../dsl/buffer.ts';
import { sinewave } from '../dsl/wave.ts';
import { INTENSITY, param } from './helpers.ts';

/** Aurora range in the rainbow hue ramp: green through aqua to violet. */
const HUE_LO = 0.36;
const HUE_HI = 0.72;

/**
 * The northern lights are the one natural licence for green light in a dark room. Two
 * curtains drift around the ring at bar-locked rates and the colour slides toward violet
 * where they thin out.
 */
export const auroraBorealis: EffectDef = {
	id: 'auroraBorealis',
	name: 'Aurora Borealis',
	role: 'bed',
	blurb: 'Green-to-violet curtains drifting around the room. Breakdown material.',
	taste: {
		energy: 1,
		sections: ['breakdown', 'intro', 'outro'],
		minBars: 8,
		maxBars: 64,
		peakReserved: false
	},
	params: [INTENSITY, param('drift', 'Drift speed', 0.4)],
	create(g) {
		const buf = new Float32Array(g.count * 3);
		const rgb: [number, number, number] = [0, 0, 0];
		const shimmerPhase = new Float32Array(g.count);
		for (let i = 0; i < g.count; i++) shimmerPhase[i] = hash01(i) * 6.28;
		let level = 0;

		return {
			reset() {
				level = 0;
				buf.fill(0);
			},
			render(out, ctx) {
				const { f, p, hueShift } = ctx;

				level = envelope(level, clamp(0.3 + f.energy * 0.7), f.dt, 0.2, 1.2);
				const gain = level * (0.35 + p.intensity * 0.85);
				const clock = (f.barIndex + f.barPhase) * (0.02 + p.drift * 0.03);

				for (let i = 0; i < g.count; i++) {
					const u = g.perim[i] >= 0 ? g.perim[i] : g.local[i];
					const d1 = frac(u - clock + 0.5) - 0.5;
					const d2 = frac(u + clock * 0.6 + 0.23 + 0.5) - 0.5;
					const curtain = Math.min(1, Math.exp(-d1 * d1 * 55) + Math.exp(-d2 * d2 * 90) * 0.7);
					const o = i * 3;
					if (curtain < 0.02) {
						buf[o] = 0;
						buf[o + 1] = 0.004;
						buf[o + 2] = 0.006;
						continue;
					}
					// Solar-wind shimmer: a fixed spatial texture scanned, never re-rolled -
					// flicker with structure rather than noise.
					const shimmer = 0.75 + 0.25 * sinewave(shimmerPhase[i] + clock * 30);
					const hue = lerp(HUE_LO, HUE_HI, 1 - curtain);
					hsv2rgb(frac(hue + hueShift), 0.88, curtain * shimmer * gain, rgb);
					buf[o] = rgb[0];
					buf[o + 1] = rgb[1];
					buf[o + 2] = rgb[2];
				}

				nblend(out, buf, 1 - Math.exp(-f.dt / 0.11));
			}
		};
	}
};
