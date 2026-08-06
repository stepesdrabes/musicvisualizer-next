import type { EffectDef } from '../contracts/effect.ts';
import { Band } from '../contracts/frame.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { clamp, envelope, lerp } from '../dsl/math.ts';
import { nblend } from '../dsl/buffer.ts';
import { sinewave } from '../dsl/wave.ts';
import { INTENSITY } from './helpers.ts';

/**
 * A long release, so this tracks an 808's tail rather than a kick's snap. The glow
 * bleeds up into the beam only as the level rises, as if the bass were filling the room
 * from the walls inward; the darkness between notes is the point.
 */
export const subThrob: EffectDef = {
	id: 'subThrob',
	name: 'Subwoofer Throb',
	role: 'bed',
	blurb: 'The 808 tail as a slow perimeter throb bleeding toward the ceiling.',
	taste: {
		energy: 2,
		sections: ['groove', 'drop', 'breakdown'],
		minBars: 4,
		maxBars: 64,
		peakReserved: false
	},
	params: [INTENSITY],
	create(g) {
		const buf = new Float32Array(g.count * 3);
		let env = 0;

		return {
			reset() {
				env = 0;
				buf.fill(0);
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;

				env = envelope(
					env,
					clamp(f.bands[Band.Sub] * 1.5),
					f.dt,
					0.02,
					Math.max(0.5, f.beatPeriod * 1.4)
				);
				const gain = env * (0.45 + p.intensity * 0.9);

				for (let i = 0; i < g.count; i++) {
					const onRing = g.perim[i] >= 0;
					const reach = onRing ? 1 : clamp(env * 1.6 - 0.35);
					const o = i * 3;
					if (reach <= 0.01) {
						buf[o] = 0;
						buf[o + 1] = 0;
						buf[o + 2] = 0;
						continue;
					}
					const slot = lerp(SLOT.deep, SLOT.base, clamp(env * 1.25));
					const wave = 0.85 + 0.15 * sinewave((onRing ? g.perim[i] : g.local[i]) * 1.5 + env);
					setSample(buf, i, palette, slot + hueShift, gain * reach * wave);
				}

				nblend(out, buf, 1 - Math.exp(-f.dt / 0.07));
			}
		};
	}
};
