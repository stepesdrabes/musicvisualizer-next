import type { EffectDef } from '../contracts/effect.ts';
import { sample } from '../color/palette.ts';
import { SLOT } from '../contracts/palette.ts';
import { alphaFor, clamp, frac, lerp, paletteArc } from '../dsl/math.ts';
import { nblend, setPixel } from '../dsl/buffer.ts';
import { BeatHold } from '../dsl/env.ts';
import { sinewave } from '../dsl/wave.ts';
import { INTENSITY, param } from './helpers.ts';

/**
 * A spiral field in (theta, dist) space. The ceiling beam sits near the room's axis, so
 * it naturally becomes the vortex's bright eye. The kick surge is integrated, which gives
 * the swirl inertia instead of a twitch.
 */
export const vortex: EffectDef = {
	id: 'vortex',
	name: 'Vortex',
	role: 'rhythm',
	blurb: 'A full-spectrum spiral swirling around the room, kicked forward by the kick.',
	taste: {
		energy: 4,
		sections: ['groove', 'breakdown', 'build', 'drop'],
		minBars: 2,
		maxBars: 16,
		peakReserved: false
	},
	params: [
		INTENSITY,
		param('barsPerRev', 'Bars per revolution', 2, 0.5, 8, 0.5),
		param('twist', 'Spiral twist', 0.5)
	],
	create(g) {
		const buf = new Float32Array(g.count * 3);
		const rgb: [number, number, number] = [0, 0, 0];
		// The passage's own level, latched on the beat. Straight off `f.energy` this swung the
		// whole field four to one between frames, which is the arrangement's dynamics arriving
		// as a dimmer rather than as a gesture.
		const passage = new BeatHold(0.5);
		let surge = 0;

		return {
			reset() {
				passage.reset();
				surge = 0;
				buf.fill(0);
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;

				surge += f.kickEnv * f.dt * 1.8 * motion;
				surge *= Math.exp(-f.dt / Math.max(0.1, f.beatPeriod * 3));
				// Motion scales the revolution rate rather than an integrated phase, so the swirl
				// stays a function of the bar clock and a seek lands on the same frame.
				// ctx.motion deliberately does NOT scale this. The phase is read off the absolute
				// bar clock so a seek reproduces the frame exactly, and multiplying a growing
				// counter by a value the player cross-fades between cues moves the pattern by the
				// whole elapsed length: at bar 120 a routine 1.0 to 1.25 is 7.5 revolutions in one
				// frame. A grid-locked phase takes its speed from the grid, and that is the point
				// of it.
				const spin = (f.barIndex + f.barPhase) / Math.max(0.5, p.barsPerRev) + surge;
				const twist = 1 + p.twist * 3;
				const held = passage.update(f.energy, f.beat, f.dt, f.beatPeriod);
				const gain = (0.45 + p.intensity * 1.1) * clamp(0.45 + held * 0.55);

				for (let i = 0; i < g.count; i++) {
					const s = frac(g.theta[i] + g.dist[i] * twist * 0.4 - spin);
					// Two arms: brightness peaks twice per revolution, squared for shade.
					const w = Math.pow(sinewave(s * 2), 2);
					// Near the axis, brightness lifts toward white-hot: the eye of the vortex.
					const eye = Math.max(0, 1 - g.r[i] * 3.2);
					// The eye reads toward white by moving up the palette rather than by desaturating,
					// which is the same gesture without leaving the show's colours.
					const arc = paletteArc(s + hueShift);
					const u = eye > 0 ? lerp(arc, SLOT.white, eye * 0.7) : arc;
					sample(palette, u, (0.2 + 0.8 * w + eye * 0.6) * gain, rgb);
					setPixel(buf, i, rgb[0], rgb[1], rgb[2]);
				}

				nblend(out, buf, alphaFor(f.dt, 0.05));
			}
		};
	}
};
