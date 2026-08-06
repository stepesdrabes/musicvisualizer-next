import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { PulseEnv } from '../dsl/env.ts';
import { INTENSITY, param } from './helpers.ts';

/**
 * Built for half-time feels, where a four-on-the-floor pump would fight the groove: this
 * pulse says the SLOW meter while the hats say the fast one.
 */
export const heartbeat: EffectDef = {
	id: 'heartbeat',
	name: 'Heartbeat',
	role: 'rhythm',
	blurb: 'A radial ba-BUM double pulse once per bar - the half-time chest.',
	taste: {
		energy: 3,
		sections: ['groove', 'breakdown', 'build', 'drop'],
		minBars: 4,
		maxBars: 32,
		peakReserved: false
	},
	params: [INTENSITY, param('depth', 'Pulse depth', 0.6)],
	create(g) {
		const lub = new PulseEnv();
		const dub = new PulseEnv();
		let lastBar = Number.NaN;
		let firedDub = false;

		return {
			reset() {
				lub.reset();
				dub.reset();
				lastBar = Number.NaN;
				firedDub = false;
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;

				if (f.barIndex !== lastBar) {
					lastBar = f.barIndex;
					firedDub = false;
					lub.fire(0.65);
				}
				// The second, stronger beat lands three 16ths in: the "BUM".
				if (!firedDub && f.barPhase >= 0.1875) {
					firedDub = true;
					dub.fire(1);
				}
				const v = Math.max(
					lub.decay(f.dt, f.beatPeriod, 1.2),
					dub.decay(f.dt, f.beatPeriod, 1.8)
				);

				const level = clamp(0.25 + f.energy * 0.7) * (0.4 + p.intensity);
				const bright = level * (1 - p.depth + p.depth * v);

				for (let i = 0; i < g.count; i++) {
					// The pulse blooms from the centre: near pixels move most.
					const reach = 1 - g.dist[i] * 0.5 * (1 - v);
					const slot = lerp(SLOT.deep, SLOT.base, clamp(0.35 + v * 0.65));
					setSample(out, i, palette, slot + hueShift, bright * reach);
				}
			}
		};
	}
};
