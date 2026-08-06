import type { EffectDef } from '../contracts/effect.ts';
import { Band } from '../contracts/frame.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { clamp, envelope, lerp } from '../dsl/math.ts';
import { PulseEnv } from '../dsl/env.ts';
import { INTENSITY, param } from './helpers.ts';

export const pump: EffectDef = {
	id: 'pump',
	name: 'Pump',
	role: 'rhythm',
	blurb: 'The room pulses on the downbeat, or ducks on every kick. Duck mode is the EDM signature.',
	taste: {
		energy: 4,
		sections: ['groove', 'drop'],
		minBars: 2,
		maxBars: 32,
		peakReserved: false
	},
	params: [
		INTENSITY,
		param('duck', 'Duck mode', 1, 0, 1, 1),
		param('depth', 'Depth', 0.65),
		param('decay', 'Decay beats', 0.5, 0.1, 2)
	],
	create() {
		const env = new PulseEnv();
		let base = 0;
		return {
			reset() {
				env.reset();
				base = 0;
			},
			render(out, ctx) {
				const { f, g, p, palette } = ctx;
				base = envelope(base, clamp(0.4 + 0.6 * f.energy), f.dt, 0.06, 0.4);

				let level: number;
				if (p.duck > 0.5) {
					// Sidechain: the gap the kick carves out IS the groove.
					level = base * (1 - clamp(f.kickEnv) * p.depth);
				} else {
					if (f.downbeat) env.fire(1);
					level = base * (1 - p.depth + env.decay(f.dt, f.beatPeriod, p.decay) * p.depth);
				}

				const bright = level * p.intensity;
				const slot = lerp(SLOT.base, SLOT.glow, clamp(f.bands[Band.Low]));
				for (let i = 0; i < g.count; i++) {
					setSample(out, i, palette, slot + ctx.hueShift, bright);
				}
			}
		};
	}
};
