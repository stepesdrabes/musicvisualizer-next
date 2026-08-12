import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { sample } from '../color/palette.ts';
import { clamp } from '../dsl/math.ts';
import { fadeToBlack, stampGaussian } from '../dsl/buffer.ts';
import { PulseEnv } from '../dsl/env.ts';
import { ringsFor, scatter } from '../dsl/space.ts';
import { beatRelease, INTENSITY, param } from './helpers.ts';

/**
 * The step happens on the 16th grid; the brightness comes from whether a hat actually
 * played there. A plain 8th pattern ticks lazily, a trap roll visibly sprints around the
 * walls, and the trail length reads as roll density.
 *
 * The dot also jumps with the mix: when a chopped vocal is thrown hard across the stereo
 * field, the ticker jumps the same way, which is what turns a studio trick nobody can see
 * into the most visible thing in the room.
 */
export const hatTicker: EffectDef = {
	id: 'hatTicker',
	name: 'Hat Ticker',
	role: 'rhythm',
	blurb: 'A dot ticking around the ring per 16th, sprinting through trap rolls.',
	taste: {
		energy: 2,
		sections: ['groove', 'breakdown', 'build', 'drop'],
		minBars: 2,
		maxBars: 32,
		peakReserved: false,
		kit: 'hat'
	},
	params: [INTENSITY, param('stepPx', 'Step size', 0.4), param('panJump', 'Follow the mix', 0.6, 0, 1, 0.05)],
	create(g) {
		const ring = ringsFor(g).perimeter;
		const scratch = new Float32Array(ring.length * 3);
		const flash = new PulseEnv();
		let lastSlot = -1;
		let pos = 0;

		return {
			reset() {
				scratch.fill(0);
				flash.reset();
				lastSlot = -1;
				pos = 0;
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;
				fadeToBlack(scratch, f.dt, beatRelease(f.beatPeriod, 0.6));

				const slot = Math.floor((f.beatIndex + f.beatPhase) * 4);
				if (slot !== lastSlot) {
					lastSlot = slot;
					const step = Math.max(6, Math.round(ring.length * 0.02 * (0.5 + p.stepPx) * motion));
					// A hard pan is worth a quarter of the ring; a mono passage moves it not at all,
					// so the jump only ever appears on tracks that actually do this.
					const jump = f.pan * f.panWidth * p.panJump * ring.length * 0.25;
					pos = (((pos + step + jump) % ring.length) + ring.length) % ring.length;
					if (f.hatEnv > 0.12) flash.fire(clamp(0.35 + f.hatEnv));
				}

				const v = flash.decay(f.dt, f.beatPeriod, 0.9);
				if (v > 0.01) {
					const gain = (0.55 + p.intensity * 1.2) * v;
					const c = sample(palette, SLOT.third + hueShift, gain);
					stampGaussian(scratch, ring.length, pos, 1.4, c[0], c[1], c[2], true);
					const w = sample(palette, SLOT.white + hueShift, gain * 0.4);
					stampGaussian(scratch, ring.length, pos, 0.7, w[0], w[1], w[2], true);
				}

				out.fill(0);
				scatter(ring, scratch, out);
			}
		};
	}
};
