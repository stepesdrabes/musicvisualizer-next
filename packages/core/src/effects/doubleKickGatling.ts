import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { clamp } from '../dsl/math.ts';
import { PulseEnv } from '../dsl/env.ts';
import { setPixel } from '../dsl/buffer.ts';
import { INTENSITY } from './helpers.ts';

/**
 * Alternating half-room flashes make the SPEED legible where a single flashing wall
 * would smear. Each flash is small and half-room, so even a 13 Hz blast beat keeps the
 * perceived full-field rate safe.
 */
export const doubleKickGatling: EffectDef = {
	id: 'doubleKickGatling',
	name: 'Double-Kick Gatling',
	role: 'transient',
	blurb: 'Kicks strafe hard flashes left/right - a blast beat reads as gunfire.',
	taste: {
		energy: 4,
		sections: ['groove', 'breakdown', 'build', 'drop'],
		minBars: 1,
		maxBars: 16,
		peakReserved: false
	},
	params: [INTENSITY],
	create(g) {
		const envL = new PulseEnv();
		const envR = new PulseEnv();
		let side = 1;
		let lastHit = -1;

		return {
			reset() {
				side = 1;
				envL.reset();
				envR.reset();
				lastHit = -1;
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;

				if (f.kick && f.t - lastHit > 0.05) {
					lastHit = f.t;
					side = -side;
					(side > 0 ? envR : envL).fire(clamp(0.5 + f.kickEnv * 0.6));
				}
				const vl = envL.decay(f.dt, f.beatPeriod, 0.48);
				const vr = envR.decay(f.dt, f.beatPeriod, 0.48);
				if (vl < 0.004 && vr < 0.004) {
					out.fill(0);
					return;
				}

				const gain = 0.5 + p.intensity * 1.4;
				for (let i = 0; i < g.count; i++) {
					const v = g.x[i] < 0 ? vl : vr;
					if (v < 0.004) {
						setPixel(out, i, 0, 0, 0);
						continue;
					}
					// Hot core out at the side walls, falling toward the centre line.
					const reach = clamp(Math.abs(g.x[i]) * 0.55 + 0.45);
					const slot = v > 0.6 ? SLOT.white : SLOT.base;
					setSample(out, i, palette, slot + hueShift, v * reach * gain);
				}
			}
		};
	}
};
