import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { addSample } from '../color/palette.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { ringU } from '../dsl/space.ts';
import { spectralTilt, spectrumFocus } from '../dsl/spectrum.ts';
import { BeatHold } from '../dsl/env.ts';
import { INTENSITY, param } from './helpers.ts';

/**
 * A band of light that follows whatever is carrying the tune.
 *
 * The spectral centroid says where the energy is sitting and `spectrumFocus` says whether that
 * is one voice or a whole arrangement. Together they draw a line that walks with a vocal or a
 * lead and spreads into a wash when the mix fills out, which is a melody in the room - the one
 * thing a drum-driven catalog could never show.
 *
 * It carries, and it means it: a quiet cue whose second layer is this is genuinely two layers,
 * where the same cue behind a sparkle was one and a rumour.
 */
export const harmonicRibbon: EffectDef = {
	id: 'harmonicRibbon',
	name: 'Harmonic Ribbon',
	role: 'accent',
	blurb: 'A soft band tracking the brightest voice in the mix, tightening as it stands alone.',
	taste: {
		energy: 2,
		sections: ['intro', 'groove', 'breakdown', 'build', 'drop', 'outro'],
		minBars: 2,
		maxBars: 32,
		peakReserved: false,
		quiet: 2.85
	},
	params: [INTENSITY, param('travel', 'How far it walks', 0.7), param('width', 'Band width', 0.5)],
	create(g) {
		// The passage's own level, latched on the beat. `f.energy` is beat-resolution data that
		// the player interpolates per frame, so multiplying brightness by it directly slides
		// the whole room continuously - the same shimmer the spectrum caused, by another route.
		// Glided over most of a beat so it arrives as a swell rather than a step.
		const level = new BeatHold(0.45);
		// A position wants to arrive rather than jump, so it glides most of a beat; a colour is
		// the opposite and steps. Both still only ever take a new reading on the beat.
		const centroid = new BeatHold(0.75);
		const width = new BeatHold(0.3);

		return {
			reset() {
				level.reset();
				centroid.reset();
				width.reset();
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;
				// Written, not accumulated. A band that walks across a buffer decaying at 0.4 s
				// leaves a lagging edge on every pixel it crosses, which is a ripple at the frame
				// rate however slowly the band itself moves.
				out.fill(0);

				// Latched on the beat rather than followed. The centroid of a mix with a hi-hat in
				// it moves by a band every frame, and a light that tracks that reads as a fault
				// rather than as a melody however smoothly it is eased.
				const at = centroid.update(spectralTilt(f), f.beat, f.dt, f.beatPeriod);
				const spread = width.update(1 - spectrumFocus(f), f.beat, f.dt, f.beatPeriod);

				// Level from the passage alone. It used to be multiplied by the spectrum's own
				// peak, which is what made the band pulse between beats instead of on them.
				const gain = (0.25 + p.intensity * 0.7) * clamp(0.15 + level.update(f.energy, f.beat, f.dt, f.beatPeriod) * 0.85);
				// One voice is a line, a whole arrangement is a wash. The width is the measurement.
				// Wide enough at its narrowest that the band is a region of the room rather than a
				// stripe on one wall: as the only texture over a quiet bed, a stripe reads as a fault.
				const sigma = 0.07 + spread * 0.1 + p.width * 0.08;
				const slot = lerp(SLOT.glow, SLOT.accent, at);
				// Walked around the ring rather than up a strip, so the melody crosses the room
				// instead of climbing one wall.
				// Scaled by the cue's motion, which is how an effect is told the passage is quiet.
				// Across a whole ring per beat is a melody; a fifth of it is a room breathing.
				const centre = 0.5 + (at - 0.5) * (0.4 + p.travel * 1.2) * clamp(0.25 + motion * 0.75);

				for (let i = 0; i < g.count; i++) {
					const d = Math.abs(ringU(g, i) - centre);
					const wrapped = Math.min(d, 1 - d);
					const v = Math.exp(-(wrapped * wrapped) / (2 * sigma * sigma));
					// A floor under the band, because this is asked to carry a quiet cue: the
					// band is what it says, and the floor is what makes it a room rather than a
					// stripe on a dark wall.
					addSample(out, i, palette, slot + hueShift, (0.28 + v * 0.72) * gain);
				}
			}
		};
	}
};
