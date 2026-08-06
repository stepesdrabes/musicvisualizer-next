import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { addSample } from '../color/palette.ts';
import { clamp } from '../dsl/math.ts';
import { fadeToBlack } from '../dsl/buffer.ts';
import { Rng } from '../dsl/rng.ts';
import { INTENSITY, param } from './helpers.ts';

export const sparkle: EffectDef = {
	id: 'sparkle',
	name: 'Sparkle',
	role: 'accent',
	blurb: 'Micro-sparks scattered on the hats, at an absolute rate rather than one per frame.',
	taste: {
		energy: 2,
		sections: ['intro', 'groove', 'breakdown', 'build', 'drop', 'outro'],
		minBars: 2,
		maxBars: 64,
		peakReserved: false
	},
	params: [
		INTENSITY,
		param('rate', 'Sparks/sec', 90, 5, 400, 5),
		param('decay', 'Decay', 0.12, 0.02, 0.6),
		param('white', 'White share', 0.6)
	],
	create(g) {
		const rng = new Rng(0x51ed2701);
		// Fractional carry, so the rate is sparks per second rather than per frame. Without
		// it the density silently tracks the frame rate.
		let carry = 0;
		return {
			reset() {
				rng.seed(0x51ed2701);
				carry = 0;
			},
			render(out, ctx) {
				const { f, p, palette } = ctx;
				fadeToBlack(out, f.dt, p.decay);

				const drive = clamp(f.hatEnv * 0.8 + f.energy * 0.3);
				carry += p.rate * drive * f.dt;
				const n = Math.floor(carry);
				carry -= n;

				for (let k = 0; k < n; k++) {
					const i = rng.int(g.count);
					const slot = rng.float() < p.white ? SLOT.white : SLOT.accent;
					addSample(out, i, palette, slot + ctx.hueShift, p.intensity * rng.range(0.5, 1));
				}
			}
		};
	}
};
