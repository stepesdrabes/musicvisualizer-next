import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { BeatHold, PulseEnv } from '../dsl/env.ts';
import { INTENSITY, param } from './helpers.ts';

/**
 * The wavefront travels with the DECAY, so a fresh hit is at the front wall and a faded
 * one is at the back: the nod is in the groove rather than reacting to it.
 */
export const headbang: EffectDef = {
	id: 'headbang',
	name: 'Headbang',
	role: 'rhythm',
	blurb: 'A nod-wave slamming front to back on every downbeat, crossing in half a bar.',
	taste: {
		energy: 4,
		sections: ['groove', 'breakdown', 'build', 'drop'],
		minBars: 2,
		maxBars: 32,
		peakReserved: false
	},
	params: [INTENSITY, param('everyBeat', 'Every beat', 0, 0, 1, 1)],
	create(g) {
		const env = new PulseEnv();
		// The passage's own level, latched on the beat: `f.energy` is beat-resolution data the
		// player interpolates per frame, so a brightness multiplied by it slides continuously.
		const passage = new BeatHold(0.45);
		// ny is normalised by the room's LONGEST side, so the depth axis covers only part of
		// 0..1. A front swept over the full range spends the last fifth of the nod outside the
		// room, which is why the wave used to die before it reached the back wall.
		let lo = Infinity;
		let hi = -Infinity;
		for (let i = 0; i < g.count; i++) {
			if (g.ny[i] < lo) lo = g.ny[i];
			if (g.ny[i] > hi) hi = g.ny[i];
		}
		const span = hi - lo || 1;

		return {
			reset() {
				env.reset();
				passage.reset();
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;

				const everyBeat = p.everyBeat > 0.5;
				if (everyBeat ? f.beat : f.downbeat) env.fire(1);
				const v = env.decay(f.dt, f.beatPeriod, (everyBeat ? 1.35 : 3.3) / Math.max(0.05, motion));

				const passageLevel = passage.update(f.energy, f.beat, f.dt, f.beatPeriod);
				const level = clamp(0.3 + passageLevel * 0.7) * (0.4 + p.intensity);
				const front = 1 - v;

				for (let i = 0; i < g.count; i++) {
					// ny runs across the room's depth; the beam rides the wave at its position.
					const d = (g.ny[i] - lo) / span - front;
					// Steep leading edge, soft wake.
					const wave = d > 0 ? Math.exp(-d * d * 30) : Math.exp(-d * d * 8);
					const slot = lerp(SLOT.deep, SLOT.base, clamp(0.3 + wave * v));
					setSample(out, i, palette, slot + hueShift, (0.25 + 0.75 * wave * v) * level);
				}
			}
		};
	}
};
