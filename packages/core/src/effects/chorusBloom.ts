import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { alphaFor, clamp, envelope, lerp } from '../dsl/math.ts';
import { nblend } from '../dsl/buffer.ts';
import { sinewave } from '../dsl/wave.ts';
import { ringU } from '../dsl/space.ts';
import { INTENSITY } from './helpers.ts';

/**
 * Outside a chorus this rests as a dim base wash, which is what earns the bloom: every
 * 8-bar phrase inside the drop lifts the floor another step, the "one more gear" feeling.
 */
export const chorusBloom: EffectDef = {
	id: 'chorusBloom',
	name: 'Chorus Bloom',
	role: 'bed',
	blurb: 'The bed blooms brighter through the chorus, lifting a step every phrase.',
	taste: {
		energy: 3,
		sections: ['drop', 'groove', 'build'],
		minBars: 4,
		maxBars: 32,
		peakReserved: false
	},
	params: [INTENSITY],
	create(g) {
		const buf = new Float32Array(g.count * 3);
		let bloom = 0;

		return {
			reset() {
				bloom = 0;
				buf.fill(0);
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;

				let target = 0.2;
				if (f.section === 'drop') {
					const phrases = Math.floor(f.timeSinceDrop / Math.max(0.1, f.beatPeriod * 32));
					const lift = Math.min(0.3, Number.isFinite(phrases) ? phrases * 0.15 : 0.3);
					target = clamp(0.45 + f.sectionProgress * 0.4 + lift);
				}
				bloom = envelope(bloom, target, f.dt, 0.6, 1.4);

				const gain = (0.35 + p.intensity * 0.85) * (0.3 + bloom * 0.9);

				for (let i = 0; i < g.count; i++) {
					const u = ringU(g, i);
					// Petal lobes that widen as the bloom opens.
					const petal = 0.7 + 0.3 * sinewave(u * (5 - bloom * 2) + bloom * 0.5);
					const slot = lerp(SLOT.deep, SLOT.glow, clamp(bloom * 1.15));
					setSample(buf, i, palette, slot + hueShift, gain * petal);
				}

				nblend(out, buf, alphaFor(f.dt, 0.09));
			}
		};
	}
};
