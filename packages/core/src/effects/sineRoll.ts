import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { BeatHold } from '../dsl/env.ts';
import { sinewave } from '../dsl/wave.ts';
import { ringU } from '../dsl/space.ts';
import { INTENSITY, param } from './helpers.ts';

/**
 * Constant hue, pure phase-spread brightness - the most restrained motion layer, and the
 * right default when the groove should feel liquid rather than punchy.
 */
export const sineRoll: EffectDef = {
	id: 'sineRoll',
	name: 'Sine Roll',
	role: 'rhythm',
	blurb: 'A liquid brightness wave rolling around the room, one cycle per N beats.',
	taste: {
		energy: 2,
		sections: ['intro', 'groove', 'breakdown', 'build', 'drop', 'outro'],
		minBars: 4,
		maxBars: 64,
		peakReserved: false
	},
	params: [
		INTENSITY,
		param('perBeat', 'Beats per cycle', 4, 1, 16, 1),
		param('waves', 'Waves around room', 4, 1, 8, 1)
	],
	create(g) {
		// The passage's own level, latched on the beat: `f.energy` is beat-resolution data the
		// player interpolates per frame, so a brightness multiplied by it slides continuously.
		const passage = new BeatHold(0.45);
		return {
			reset() {
				passage.reset();
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;

				// Motion stretches the cycle in beats rather than driving a clock of its own, so a
				// slow cue rolls slowly and the crest still arrives on the grid.
				// ctx.motion deliberately does NOT scale this. The phase is read off the absolute
				// bar clock so a seek reproduces the frame exactly, and multiplying a growing
				// counter by a value the player cross-fades between cues moves the pattern by the
				// whole elapsed length: at bar 120 a routine 1.0 to 1.25 is 7.5 revolutions in one
				// frame. A grid-locked phase takes its speed from the grid, and that is the point
				// of it.
				const phase = (f.beatIndex + f.beatPhase) / Math.max(1, p.perBeat);
				const waves = Math.max(1, Math.round(p.waves));
				const passageLevel = passage.update(f.energy, f.beat, f.dt, f.beatPeriod);
				const gain = (0.4 + p.intensity) * clamp(0.3 + passageLevel * 0.9);

				for (let i = 0; i < g.count; i++) {
					const u = ringU(g, i);
					// Squared, so the wave dwells near dark and the crests punch.
					const w = Math.pow(sinewave(u * waves - phase), 2);
					const slot = lerp(SLOT.deep, SLOT.glow, w);
					setSample(out, i, palette, slot + hueShift, (0.15 + 0.85 * w) * gain);
				}
			}
		};
	}
};
