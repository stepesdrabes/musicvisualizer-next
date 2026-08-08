import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { clamp, frac, lerp } from '../dsl/math.ts';
import { BeatHold } from '../dsl/env.ts';
import { sinewave } from '../dsl/wave.ts';
import { INTENSITY, param } from './helpers.ts';

/**
 * The tempo of a crowd nodding, not dancing. Heavy sine easing makes the wave linger at
 * each wall like a nod at its peak; anything faster breaks a half-time pocket.
 */
export const laidbackWave: EffectDef = {
	id: 'laidbackWave',
	name: 'Laidback Wave',
	role: 'rhythm',
	blurb: 'One eased head-nod wave rolling through the room every two bars.',
	taste: {
		energy: 2,
		sections: ['intro', 'groove', 'breakdown', 'build', 'drop', 'outro'],
		minBars: 4,
		maxBars: 32,
		peakReserved: false
	},
	params: [INTENSITY, param('barsPerWave', 'Bars per wave', 2, 1, 4, 1)],
	create(g) {
		// The passage's own level, latched on the beat: `f.energy` is beat-resolution data the
		// player interpolates per frame, so a brightness multiplied by it slides continuously.
		const passage = new BeatHold(0.45);
		// ny is normalised by the room's LONGEST side, so the depth axis covers only part of
		// 0..1. The nod is supposed to linger at each wall, and over the raw range it lingered
		// past the back wall instead, outside the room.
		let lo = Infinity;
		let hi = -Infinity;
		for (let i = 0; i < g.count; i++) {
			if (g.ny[i] < lo) lo = g.ny[i];
			if (g.ny[i] > hi) hi = g.ny[i];
		}
		const span = hi - lo || 1;

		return {
			reset() {
				passage.reset();
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;

				// ctx.motion deliberately does NOT scale this. The phase is read off the absolute
				// bar clock so a seek reproduces the frame exactly, and multiplying a growing
				// counter by a value the player cross-fades between cues moves the pattern by the
				// whole elapsed length: at bar 120 a routine 1.0 to 1.25 is 7.5 revolutions in one
				// frame. A grid-locked phase takes its speed from the grid, and that is the point
				// of it.
				const phase = frac((f.barIndex + f.barPhase) / Math.max(1, p.barsPerWave));
				const front = sinewave(phase);
				const passageLevel = passage.update(f.energy, f.beat, f.dt, f.beatPeriod);
				const level = clamp(0.3 + passageLevel * 0.7) * (0.4 + p.intensity);

				for (let i = 0; i < g.count; i++) {
					const d = (g.ny[i] - lo) / span - front;
					const wave = Math.exp(-d * d * 12);
					const slot = lerp(SLOT.deep, SLOT.base, clamp(0.4 + wave * 0.6));
					setSample(out, i, palette, slot + hueShift, (0.3 + 0.7 * wave) * level);
				}
			}
		};
	}
};
