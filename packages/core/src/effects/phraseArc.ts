import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { clamp, lerp, smoothstep } from '../dsl/math.ts';
import { BeatHold } from '../dsl/env.ts';
import { ringU } from '../dsl/space.ts';
import { spectralTilt } from '../dsl/spectrum.ts';
import { INTENSITY, param } from './helpers.ts';

/**
 * The room breathing on the phrase, for a passage with no drums to answer.
 *
 * Everything else in the catalog that moves takes its timing from a hit. In an intro there are
 * no hits, which is why those passages sat still: the grid was right there in the frame and
 * nothing was reading it. This reads only the grid and the spectrum, so it works on a solo
 * piano and on a pad, and it fills the room rather than drawing a shape on it.
 *
 * A slow swell across the phrase with a lift on each bar inside it, so the room has both the
 * long shape and the count. Nothing here is a flash: the fastest thing it does takes a beat.
 */
export const phraseArc: EffectDef = {
	id: 'phraseArc',
	name: 'Phrase Arc',
	role: 'bed',
	blurb: 'A slow swell that completes on the phrase, with a smaller lift each bar.',
	taste: {
		energy: 1,
		sections: ['intro', 'groove', 'breakdown', 'build', 'void', 'drop', 'outro'],
		minBars: 2,
		maxBars: 64,
		peakReserved: false,
		quiet: 1.58
	},
	params: [INTENSITY, param('bars', 'Bar lift', 0.45), param('sweep', 'How far it travels', 0.6)],
	create(g) {
		// The passage's own level, latched on the beat. `f.energy` is beat-resolution data that
		// the player interpolates per frame, so multiplying brightness by it directly slides
		// the whole room continuously - the same shimmer the spectrum caused, by another route.
		// Glided over most of a beat so it arrives as a swell rather than a step.
		const level = new BeatHold(0.45);
		const lean = new BeatHold(0.3);
		return {
			reset() {
				level.reset();
				lean.reset();
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;

				// Eased both ways rather than a sawtooth: a linear ramp that resets reads as a
				// fault, and the ear hears a phrase arriving rather than a counter wrapping.
				const arc = smoothstep(0, 0.55, f.phrasePhase) * (1 - smoothstep(0.75, 1, f.phrasePhase));
				const barLift = smoothstep(0, 0.3, f.barPhase) * (1 - smoothstep(0.5, 1, f.barPhase));
				const swell = clamp(0.45 + arc * 0.5 + barLift * p.bars * 0.35);
				const heard = level.update(f.energy, f.beat, f.dt, f.beatPeriod);
				const gain = (0.5 + p.intensity * 0.85) * clamp(0.45 + heard * 0.55);
				// The whole field slides around the room across the phrase, so a long passage is
				// never twice in the same place even though nothing in it is fast. Quantised to
				// whole periods of the lobe below, which repeats every half turn: `phrasePhase`
				// restarts at each phrase, and any other distance teleports the field with it.
				const travel = f.phrasePhase * Math.round(p.sweep * 4 * motion) * 0.5;
				// Latched on the beat: where the lobes sit is the music's business, but it moving
				// every frame is what turns a slow field into a shimmer.
				const tilt = lean.update(spectralTilt(f), f.beat, f.dt, f.beatPeriod);
				// How far up the palette the swell reaches follows the same number, so a passage
				// opening up pales rather than only brightens. Inside the base hue on purpose: a
				// walk between two of the show's hues spends most of its time on neither.
				// A spectral term may only walk the slot inside base..glow. Slot space is a ring whose
				// positions differ in VALUE - white is 3.7x glow's luminance - so a walk that crosses it
				// is a spectrum driving BRIGHTNESS through the palette, which is the blinking the
				// mixer already had to be rescued from once.
				const top = lerp(SLOT.base, SLOT.glow, clamp(tilt));

				for (let i = 0; i < g.count; i++) {
					const u = ringU(g, i) + travel;
					// Two lobes, so the room reads as having a near side and a far side rather
					// than as one slab changing level.
					// Shallow lobes. At a 4x swing between the bright side and the dim one this was
					// a bed that lit two walls and left two, which no amount of mean brightness fixes.
					const lobe = 0.79 + 0.21 * Math.cos((u * 2 - tilt) * Math.PI * 2);
					const v = clamp(swell * lobe);
					const slot = lerp(SLOT.base, top, v * 0.9);
					setSample(out, i, palette, slot + hueShift, (0.38 + v * 0.62) * gain);
				}
			}
		};
	}
};
