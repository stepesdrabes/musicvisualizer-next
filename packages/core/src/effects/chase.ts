import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { BeatHold, PulseEnv } from '../dsl/env.ts';
import { spectralTilt } from '../dsl/spectrum.ts';
import { INTENSITY, param } from './helpers.ts';

export const chase: EffectDef = {
	id: 'chase',
	name: 'Chase',
	role: 'rhythm',
	blurb: 'Ring segments firing on the grid; direction flips every phrase, beam answers the downbeat.',
	taste: {
		energy: 3,
		sections: ['groove', 'breakdown', 'build', 'drop'],
		minBars: 2,
		maxBars: 32,
		peakReserved: false
	},
	params: [
		INTENSITY,
		param('segments', 'Segments', 8, 4, 24, 1),
		param('perBeat', 'Steps per beat', 1, 0.25, 4, 0.25),
		param('tail', 'Tail', 0.5, 0.1, 1.5)
	],
	create(g) {
		let lastStep = -1;
		const level = new Float32Array(32);
		// The beam's answer used to be `f.downbeat`, which is true for exactly one frame: below
		// the eye's integration window, so its apparent brightness depended on where the frame
		// boundary fell.
		const beam = new PulseEnv();
		// The passage's own level, latched on the beat: `f.energy` is beat-resolution data the
		// player interpolates per frame, so a brightness multiplied by it slides continuously.
		const passage = new BeatHold(0.45);
		// The spectrum picks the head's colour, never its level, so an opening arrangement whitens
		// the chase rather than brightening it.
		const tilt = new BeatHold(0.2);
		return {
			reset() {
				lastStep = -1;
				level.fill(0);
				beam.reset();
				passage.reset();
				tilt.reset();
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;
				// A show is free to ask for more segments than the register holds, and reading past
				// the end of it would put NaN in every pixel of the ring.
				const segments = Math.min(level.length, Math.max(2, Math.round(p.segments)));
				const step = Math.floor((f.beatIndex + f.beatPhase) * p.perBeat);
				const phrase = Math.floor(f.barIndex / 8);
				const dir = phrase % 2 === 0 ? 1 : -1;

				if (step !== lastStep) {
					lastStep = step;
					const seg = (((step * dir) % segments) + segments) % segments;
					level[seg] = 1;
				}
				if (f.downbeat) beam.fire(1);

				const decay = 1 - Math.exp(-f.dt / ((p.tail * f.beatPeriod) / Math.max(0.05, motion)));
				for (let s = 0; s < segments; s++) level[s] -= level[s] * decay;

				const beamV = beam.decay(f.dt, f.beatPeriod, 0.8 / Math.max(0.05, motion));
				const passageLevel = passage.update(f.energy, f.beat, f.dt, f.beatPeriod);
				const gain = p.intensity * clamp(0.4 + passageLevel * 0.6);
				// Kept inside the base hue's own family, glow through white: the palette walks its
				// hue between families, so a head sliding toward the third would spend the trip on
				// oranges the show never declared.
				const lean = tilt.update(spectralTilt(f), f.beat, f.dt, f.beatPeriod);
				const head = lerp(SLOT.glow, SLOT.white, lean);

				for (let i = 0; i < g.count; i++) {
					const along = g.perim[i];
					if (along < 0) {
						setSample(out, i, palette, SLOT.accent + hueShift, beamV * gain * 0.6);
						continue;
					}
					const seg = Math.min(Math.floor(along * segments), segments - 1);
					const v = level[seg];
					const slot = lerp(SLOT.base, head, v * v);
					setSample(out, i, palette, slot + hueShift, v * gain);
				}
			}
		};
	}
};
