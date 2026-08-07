import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { BeatHold } from '../dsl/env.ts';
import { noise3 } from '../dsl/wave.ts';
import { ringU } from '../dsl/space.ts';
import { bandBetween, spectralTilt, spectrumFocus } from '../dsl/spectrum.ts';
import { INTENSITY, param } from './helpers.ts';

/**
 * A drifting field whose grain is set by how busy the arrangement is.
 *
 * One voice on its own leaves the room smooth and slow; a full mix breaks it into finer, faster
 * cells. That is a texture reading the ARRANGEMENT rather than the level, which is what a
 * passage with no percussion has to be lit by, and it fills the whole room while doing it.
 *
 * The colour walks between the base and the third hue on the bottom-to-top balance of the mix,
 * so a bassline entering is a change of colour as well as of brightness.
 */
export const harmonicHaze: EffectDef = {
	id: 'harmonicHaze',
	name: 'Harmonic Haze',
	role: 'bed',
	blurb: 'A noise field whose grain and colour follow how busy and how bright the mix is.',
	taste: {
		energy: 2,
		sections: ['intro', 'groove', 'breakdown', 'build', 'void', 'drop', 'outro'],
		minBars: 2,
		maxBars: 64,
		peakReserved: false
	},
	params: [INTENSITY, param('grain', 'Cell size', 0.5), param('drift', 'Drift speed', 0.5)],
	create(g) {
		let phase = 0;
		const focus = new BeatHold(0.3);
		const low = new BeatHold(0.3);
		const lean = new BeatHold(0.3);

		return {
			reset() {
				phase = 0;
				focus.reset();
				low.reset();
				lean.reset();
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;

				// Beats, not seconds, so the drift keeps time with the track rather than with
				// the wall clock. Thirty-two of them: a bed at rest should take most of a minute
				// to go round, and anything faster than that reads as the room being restless.
				phase += (f.dt / Math.max(0.15, f.beatPeriod * 32)) * motion * (0.5 + p.drift);

				// Every reading from the music is latched on the beat. What these change is the
				// grain and the colour of the field, never how bright it is: brightness that
				// follows a signal with a few per cent of frame-to-frame noise in it is a blink.
				const busy = focus.update(spectrumFocus(f), f.beat, f.dt, f.beatPeriod);
				const bottom = low.update(bandBetween(f, 0, 0.35), f.beat, f.dt, f.beatPeriod);
				const tilt = lean.update(spectralTilt(f), f.beat, f.dt, f.beatPeriod);

				// A busy mix is a fine grain; one sustained voice is a broad slow field.
				const scale = (1.4 + p.grain * 2.2) * (0.6 + (1 - busy) * 1.8);
				const gain = 0.48 + p.intensity * 0.8;

				for (let i = 0; i < g.count; i++) {
					const u = ringU(g, i);
					const n = noise3(u * scale, phase, tilt * 1.5);
					const v = clamp(0.4 + n * 0.75);
					// Bottom-heavy walks toward the room's own colour, bright toward the third.
					const slot = lerp(SLOT.base, SLOT.third, clamp(tilt * 1.2 - bottom * 0.35));
					setSample(out, i, palette, lerp(slot, SLOT.glow, v * 0.35) + hueShift, (0.4 + v * 0.6) * gain);
				}
			}
		};
	}
};
