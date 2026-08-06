import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { hash01 } from '../dsl/rng.ts';
import { alphaFor, clamp, envelope, frac, lerp } from '../dsl/math.ts';
import { nblend } from '../dsl/buffer.ts';
import { INTENSITY, param } from './helpers.ts';

/**
 * Every pixel derives its twinkle phase and speed from a hash of its index against the
 * shared bar clock: zero per-pixel state, perfectly reproducible after a seek.
 */
export const embers: EffectDef = {
	id: 'embers',
	name: 'Embers',
	role: 'bed',
	blurb: 'Slow deterministic twinkle pools in the deep palette colours.',
	taste: {
		energy: 1,
		sections: ['intro', 'breakdown', 'outro', 'groove'],
		minBars: 4,
		maxBars: 64,
		peakReserved: false
	},
	params: [INTENSITY, param('pool', 'Pool size', 0.4)],
	create(g) {
		const buf = new Float32Array(g.count * 3);
		const h1 = new Float32Array(g.count);
		const h2 = new Float32Array(g.count);
		for (let i = 0; i < g.count; i++) {
			h1[i] = hash01(i);
			h2[i] = hash01(i * 7 + 13);
		}
		let level = 0;

		return {
			reset() {
				level = 0;
				buf.fill(0);
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;

				level = envelope(level, clamp(0.2 + f.energy), f.dt, 0.2, 1.2);
				const duty = (0.1 + p.pool * 0.3) * (0.5 + 0.5 * level);
				const gain = 0.4 + p.intensity;
				// Clock in bars, so the twinkle tempo breathes with the track.
				const clock = (f.barIndex + f.barPhase) * 0.5;

				for (let i = 0; i < g.count; i++) {
					const speed = 0.35 + h1[i] * 0.65;
					const cycle = frac(clock * speed + h2[i] * 7.13);
					let v = 0;
					if (cycle < duty) {
						const u = cycle / duty;
						// Fast attack, slow decay: incandescent rather than LED-blinky.
						v = u < 0.25 ? u / 0.25 : 1 - (u - 0.25) / 0.75;
						v *= v;
					}
					const slot = h2[i] < 0.6 ? lerp(SLOT.deep, SLOT.base, h1[i]) : SLOT.third;
					setSample(buf, i, palette, slot + hueShift, v * gain * (0.3 + 0.7 * h1[i]));
				}

				nblend(out, buf, alphaFor(f.dt, 0.09));
			}
		};
	}
};
