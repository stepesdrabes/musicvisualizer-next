import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { sample } from '../color/palette.ts';
import { hash01 } from '../dsl/rng.ts';
import { clamp, frac } from '../dsl/math.ts';
import { fadeToBlack, stampGaussian } from '../dsl/buffer.ts';
import { ringsFor, scatter } from '../dsl/space.ts';
import { sinewave } from '../dsl/wave.ts';
import { INTENSITY, param } from './helpers.ts';

const MAX_EMBERS = 32;

/**
 * A fixed flock whose wind speed and flicker rate rise with the build: a lazy scatter of
 * coals at rest, a stream around the whole room by the drop. Every ember's character is
 * a hash of its index, so a seek reproduces the flock exactly.
 */
export const emberStorm: EffectDef = {
	id: 'emberStorm',
	name: 'Ember Storm',
	role: 'accent',
	blurb: 'Drifting embers whose wind rises with the build - a storm by the drop.',
	taste: {
		energy: 3,
		sections: ['groove', 'breakdown', 'build', 'drop'],
		minBars: 2,
		maxBars: 32,
		peakReserved: false,
		// Sparks. 19% of the room, three quarters of its light in a tenth of the pixels.
		carries: false
	},
	params: [INTENSITY, param('count', 'Ember count', 0.5)],
	create(g) {
		const ring = ringsFor(g).perimeter;
		const scratch = new Float32Array(ring.length * 3);
		const home = new Float32Array(MAX_EMBERS);
		const drift = new Float32Array(MAX_EMBERS);
		const flickPhase = new Float32Array(MAX_EMBERS);
		const hot = new Uint8Array(MAX_EMBERS);
		for (let e = 0; e < MAX_EMBERS; e++) {
			home[e] = hash01(e * 13 + 1);
			drift[e] = 0.6 + hash01(e * 7 + 5) * 0.4;
			flickPhase[e] = hash01(e * 31) * 6.28;
			hot[e] = hash01(e * 3) < 0.7 ? 0 : 1;
		}
		let windPos = 0;

		return {
			reset() {
				windPos = 0;
				scratch.fill(0);
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;
				fadeToBlack(scratch, f.dt, 0.1);

				const tension = Math.max(f.buildProgress, f.energy * 0.5);
				// From a lazy drift at 16 bars per lap to a gale at 2.
				const barsPerLap = 16 - tension * 14;
				windPos += f.dt / Math.max(0.4, barsPerLap * 4 * f.beatPeriod);

				const count = Math.floor(MAX_EMBERS * (0.4 + p.count * 0.6));
				const gain = (0.45 + p.intensity * 1.1) * clamp(0.25 + tension);

				for (let e = 0; e < count; e++) {
					const u = frac(home[e] + windPos * drift[e]);
					const flick =
						0.55 + 0.45 * sinewave(flickPhase[e] + windPos * (30 + tension * 60));
					const slot = hot[e] === 0 ? SLOT.base : SLOT.accent;
					const c = sample(palette, slot + hueShift, flick * gain);
					stampGaussian(scratch, ring.length, u * ring.length, 1.6, c[0], c[1], c[2], true);
				}

				out.fill(0);
				scatter(ring, scratch, out);
			}
		};
	}
};
