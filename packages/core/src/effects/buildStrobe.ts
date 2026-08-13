import type { EffectDef } from '../contracts/effect.ts';
import { STROBE_MAX_HZ } from '../contracts/show.ts';
import { SLOT } from '../contracts/palette.ts';
import { sample } from '../color/palette.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { fillSolid } from '../dsl/buffer.ts';
import { BeatHold, PulseEnv } from '../dsl/env.ts';
import { bandBetween } from '../dsl/spectrum.ts';
import { INTENSITY } from './helpers.ts';

/**
 * A build is not a smooth Hz ramp, it is a musical one: half notes, then quarters, then
 * 8ths, then 16ths, so the light plays the snare roll. Held below full brightness so the
 * drop still owns the brightest frame of the show.
 */
export const buildStrobe: EffectDef = {
	id: 'buildStrobe',
	name: 'Build Strobe',
	role: 'accent',
	blurb: 'Flashes on a grid that doubles: 1/2 -> 1/4 -> 1/8 -> 1/16 into the drop.',
	taste: {
		energy: 4,
		sections: ['build'],
		minBars: 2,
		maxBars: 16,
		peakReserved: false,
		// A strobe cannot be the thing a room is lit by; it is what happens to a lit room.
		carries: false,
		character: 'flash'
	},
	params: [INTENSITY],
	create(g) {
		const env = new PulseEnv();
		// How much top end the riser has, latched on the beat and spent entirely on colour.
		// Driving the flash level from it would put the build's brightness on band data that
		// is normalised across the whole track.
		const air = new BeatHold(0.15);
		let lastStep = -1;

		return {
			reset() {
				env.reset();
				air.reset();
				lastStep = -1;
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;

				// Only the back half of the build. Firing from the first bar meant a sixteen-bar
				// riser flashed for half a minute, which two listening notes called out on two
				// different tracks: the roll is the END of a build, and the front half belongs
				// to the layers that climb. The ladder is remapped onto the firing span so it
				// still enters at half notes and doubles all the way in.
				const progress = clamp((f.buildProgress - 0.45) / 0.55);
				const top = air.update(bandBetween(f, 0.65, 1), f.beat, f.dt, f.beatPeriod);
				const v = env.decay(f.dt, f.beatPeriod, 0.54);
				if (progress <= 0 && v < 0.01) {
					out.fill(0);
					return;
				}

				if (progress > 0) {
					let per = progress < 0.3 ? 2 : progress < 0.6 ? 1 : progress < 0.85 ? 0.5 : 0.25;
					// The ladder stops doubling where the next rung would cross the strobe
					// ceiling: at 140 bpm the sixteenth rung is 9.3 Hz, which has fused into a
					// texture, so the roll tops out at eighths and the drop still owns the step up.
					const floor = 1 / (STROBE_MAX_HZ * Math.max(0.05, f.beatPeriod));
					while (per < floor && per < 2) per *= 2;
					const step = Math.floor((f.beatIndex + f.beatPhase) / per);
					if (step !== lastStep) {
						lastStep = step;
						env.fire(1);
					}
				}

				const gain = env.value * (0.25 + 0.5 * progress) * (0.5 + p.intensity);
				if (gain < 0.005) {
					out.fill(0);
					return;
				}
				// Tinted toward the room's own colour while the riser is still low and bleached
				// as it opens up, so the flash answers the arrangement without changing level.
				fillSolid(out, g.count, sample(palette, lerp(SLOT.glow, SLOT.white, top) + hueShift, gain));
			}
		};
	}
};
