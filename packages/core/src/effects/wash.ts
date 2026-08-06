import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { clamp, envelope, frac, lerp } from '../dsl/math.ts';
import { sinewave } from '../dsl/wave.ts';
import { ringU } from '../dsl/space.ts';
import { INTENSITY, param } from './helpers.ts';

export const wash: EffectDef = {
	id: 'wash',
	name: 'Wash',
	role: 'bed',
	blurb: 'The room in its home colour, breathing once per bar, gradient drifting around the ring.',
	taste: {
		energy: 2,
		sections: ['intro', 'groove', 'breakdown', 'build', 'void', 'drop', 'outro'],
		minBars: 2,
		maxBars: 64,
		peakReserved: false
	},
	params: [INTENSITY, param('breath', 'Breath', 0.45), param('drift', 'Drift', 0.06, 0, 0.4)],
	create() {
		let level = 0;
		return {
			reset() {
				level = 0;
			},
			render(out, ctx) {
				const { f, g, p, palette } = ctx;
				const breathe = Math.pow(sinewave(f.barPhase), 1.8);
				const target = clamp(0.35 + 0.65 * f.energy) * p.intensity;
				level = envelope(level, target, f.dt, 0.08, 0.5);

				const bright = level * lerp(1 - p.breath, 1, breathe);
				const phase = (f.barIndex + f.barPhase) * p.drift * ctx.motion;

				for (let i = 0; i < g.count; i++) {
					const along = ringU(g, i);
					const grad = sinewave(frac(along * 0.5 - phase));
					const u = lerp(SLOT.deep, SLOT.glow, 0.3 + 0.55 * grad) + ctx.hueShift;
					setSample(out, i, palette, u, bright);
				}
			}
		};
	}
};
