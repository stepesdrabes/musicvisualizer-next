import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { sinewave } from '../dsl/wave.ts';
import { ringU } from '../dsl/space.ts';
import { spectralTilt } from '../dsl/spectrum.ts';
import { BeatHold } from '../dsl/env.ts';
import { INTENSITY, param } from './helpers.ts';

/**
 * Two bars in, two bars out, across the whole room.
 *
 * The quietest thing here that is still doing something, and the one to reach for when a
 * passage should feel held rather than lit. It takes its period from the bar table, so it
 * breathes with the song at any tempo and stays in phase with it across a track that drifts.
 *
 * The spectrum only ever colours it, never gates it: an outro where the last note has decayed
 * should still show the room breathing, or the track ends by looking switched off.
 */
export const breathe: EffectDef = {
	id: 'breathe',
	name: 'Breathe',
	role: 'accent',
	blurb: 'The whole room swelling on a two-bar cycle, tinted by what is left playing.',
	taste: {
		energy: 1,
		sections: ['intro', 'breakdown', 'outro'],
		minBars: 4,
		maxBars: 64,
		peakReserved: false
	},
	params: [INTENSITY, param('bars', 'Bars per breath', 0.5), param('tilt', 'Colour travel', 0.5)],
	create(g) {
		// The passage's own level, latched on the beat. `f.energy` is beat-resolution data that
		// the player interpolates per frame, so multiplying brightness by it directly slides
		// the whole room continuously - the same shimmer the spectrum caused, by another route.
		// Glided over most of a beat so it arrives as a swell rather than a step.
		const level = new BeatHold(0.45);
		const hue = new BeatHold(0.3);

		return {
			reset() {
				level.reset();
				hue.reset();
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;

				// From the bar index and phase rather than from a clock, so a seek lands in the
				// same part of the breath the music is in.
				const period = 2 + Math.round(clamp(p.bars) * 2);
				const cycle = (f.barIndex % period) + f.barPhase;
				const swell = sinewave(cycle / period);

				// Colour only, latched on the beat. What is left playing decides the tint; the
				// swell decides everything else, and the swell comes off the bar table.
				const colour = hue.update(spectralTilt(f), f.beat, f.dt, f.beatPeriod);
				// Only a light energy term: this exists for the passages that have no energy, so
				// scaling it hard by the thing it is written for would leave it with nothing.
				const gain = (0.3 + p.intensity * 0.6) * clamp(0.55 + level.update(f.energy, f.beat, f.dt, f.beatPeriod) * 0.45);

				for (let i = 0; i < g.count; i++) {
					// A quarter-turn of offset around the room, so the breath arrives at the far
					// wall a moment after the near one and the room has depth.
					const lag = sinewave(cycle / period - ringU(g, i) * 0.25);
					const v = clamp(0.35 + (swell * 0.5 + lag * 0.5) * 0.65);
					const slot = lerp(SLOT.base, SLOT.third, colour * p.tilt);
					setSample(out, i, palette, lerp(slot, SLOT.glow, v * 0.4) + hueShift, v * gain);
				}
			}
		};
	}
};
