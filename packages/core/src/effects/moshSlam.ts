import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { hash01 } from '../dsl/rng.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { BeatHold, PulseEnv } from '../dsl/env.ts';
import { INTENSITY, param } from './helpers.ts';

/**
 * Where an EDM pulse breathes, this one punches: hard white over near-black, unison
 * across every strip, on the chug grid.
 */
export const moshSlam: EffectDef = {
	id: 'moshSlam',
	name: 'Mosh Slam',
	role: 'rhythm',
	blurb: 'Unison slams on the chug grid, near-black between. The room is a fist.',
	taste: {
		energy: 4,
		sections: ['groove', 'breakdown', 'build', 'drop'],
		minBars: 2,
		maxBars: 32,
		peakReserved: false
	},
	params: [INTENSITY, param('beatsPerSlam', 'Beats per slam', 2, 0.5, 4, 0.5)],
	create(g) {
		const env = new PulseEnv();
		// Fixed per-pixel texture, so a full-on frame is not a flat card.
		const tex = new Float32Array(g.count);
		for (let i = 0; i < g.count; i++) tex[i] = 0.9 + 0.1 * hash01(i * 11);
		// The passage's own level, latched on the beat: `f.energy` is beat-resolution data the
		// player interpolates per frame, so a brightness multiplied by it slides continuously.
		const passage = new BeatHold(0.4);
		let lastStep = -1;

		return {
			reset() {
				env.reset();
				passage.reset();
				lastStep = -1;
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;

				const step = Math.floor((f.beatIndex + f.beatPhase) / Math.max(0.5, p.beatsPerSlam));
				if (step !== lastStep) {
					lastStep = step;
					env.fire(1);
				}
				const v = env.decay(f.dt, f.beatPeriod, 1.05 / Math.max(0.05, motion));

				const passageLevel = passage.update(f.energy, f.beat, f.dt, f.beatPeriod);
				const gain = (0.5 + p.intensity * 1.3) * clamp(0.35 + passageLevel);
				const floor = 0.05 * gain;

				for (let i = 0; i < g.count; i++) {
					const slot = v > 0.55 ? SLOT.white : lerp(SLOT.deep, SLOT.base, clamp(v * 1.6));
					setSample(out, i, palette, slot + hueShift, Math.max(floor, v * v * gain * tex[i]));
				}
			}
		};
	}
};
