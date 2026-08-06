import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { clamp, frac, lerp } from '../dsl/math.ts';
import { nblend } from '../dsl/buffer.ts';
import { INTENSITY, param } from './helpers.ts';

/**
 * The kick surge integrates the kick envelope and springs back to zero, so the spin
 * stays phase-locked to the bar clock over time while every hit still visibly shoves the
 * colours around the walls.
 */
export const gradientSpin: EffectDef = {
	id: 'gradientSpin',
	name: 'Gradient Spin',
	role: 'rhythm',
	blurb: 'The palette wrapped around the room, one revolution per N bars, kicked by the kick.',
	taste: {
		energy: 3,
		sections: ['groove', 'drop', 'build', 'breakdown'],
		minBars: 4,
		maxBars: 32,
		peakReserved: false
	},
	params: [
		INTENSITY,
		param('barsPerRev', 'Bars per revolution', 4, 1, 16, 1),
		param('repeats', 'Palette repeats', 1, 1, 3, 1),
		param('surge', 'Kick surge', 0.5)
	],
	create(g) {
		const buf = new Float32Array(g.count * 3);
		let surge = 0;

		return {
			reset() {
				surge = 0;
				buf.fill(0);
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;

				surge += f.kickEnv * p.surge * f.dt * 2.2;
				surge *= Math.exp(-f.dt / 1.6);

				const spin = (f.barIndex + f.barPhase) / Math.max(1, p.barsPerRev) + surge;
				const gain = (0.4 + p.intensity) * clamp(0.3 + f.energy * 0.9);
				const reps = Math.max(1, Math.round(p.repeats));

				for (let i = 0; i < g.count; i++) {
					const u = g.perim[i] >= 0 ? g.perim[i] : g.theta[i];
					// Ride the palette from deep to accentDeep, dark anchors included, so
					// contrast travels around the room with the colour.
					const slot = lerp(SLOT.deep, SLOT.accentDeep, frac(u * reps - spin));
					setSample(buf, i, palette, slot + hueShift, gain);
				}

				nblend(out, buf, 1 - Math.exp(-f.dt / 0.05));
			}
		};
	}
};
