import type { EffectDef } from '../contracts/effect.ts';
import { Band } from '../contracts/frame.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { alphaFor, clamp, envelope, lerp } from '../dsl/math.ts';
import { nblend, setPixel } from '../dsl/buffer.ts';
import { sinewave } from '../dsl/wave.ts';
import { INTENSITY } from './helpers.ts';

/**
 * The perimeter carries the whole effect and the ceiling beam stays dark; that contrast
 * is what makes it read as a glow from below rather than as "lights on".
 */
export const bassRing: EffectDef = {
	id: 'bassRing',
	name: 'Bass Ring',
	role: 'bed',
	blurb: 'Deep saturated perimeter underglow riding the sub-bass; the beam stays dark.',
	taste: {
		energy: 2,
		sections: ['intro', 'groove', 'breakdown', 'build', 'void', 'drop', 'outro'],
		minBars: 2,
		maxBars: 64,
		peakReserved: false,
		quiet: 2.18,
		// The dark ceiling beam is the whole point of the look, and it is also why this cannot
		// be the only thing in a cue: one of the room's five strips is off at all times.
		carries: false
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
				const { f, p, palette, hueShift, motion } = ctx;

				// Both constants are beats rather than seconds, so the glow keeps the track's time
				// at any tempo. The attack is the only path the bass bands' own frame-to-frame
				// noise has into the room, which is why it is a tenth of a beat and not a frame.
				env = envelope(
					env,
					clamp(f.bands[Band.Sub] * 1.4 + f.bands[Band.Low] * 0.4),
					f.dt,
					Math.max(0.03, f.beatPeriod * 0.1),
					Math.max(0.18, f.beatPeriod * 0.9)
				);
				const bright = env * (0.4 + p.intensity * 0.9);

				for (let i = 0; i < g.count; i++) {
					if (g.perim[i] < 0) {
						setPixel(buf, i, 0, 0, 0);
						continue;
					}
					// Slow undulation so the glow reads as a liquid, not a tube light.
					const wave =
						0.8 + 0.2 * sinewave(g.perim[i] * 2 + (f.barIndex + f.barPhase) * 0.05 * motion);
					const slot = lerp(SLOT.deep, SLOT.base, clamp(env * 1.3));
					setSample(buf, i, palette, slot + hueShift, bright * wave);
				}

				nblend(out, buf, alphaFor(f.dt, 0.06));
			}
		};
	}
};
