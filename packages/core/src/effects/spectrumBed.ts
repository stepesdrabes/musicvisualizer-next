import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { BeatHold } from '../dsl/env.ts';
import { ringU } from '../dsl/space.ts';
import { bandAt, spectralTilt } from '../dsl/spectrum.ts';
import { INTENSITY, param } from './helpers.ts';

/**
 * The room laid out low to high, and read in COLOUR rather than in level.
 *
 * The first version of this drove brightness from each band and shimmered: the spectrum moves
 * continuously and carries several per cent of frame-to-frame noise, so a bed following it
 * flickers against a beat it has no relationship to. A bed's brightness belongs to the section
 * and the cue; what the spectrum is good for is saying WHAT COLOUR each part of the room is,
 * which the eye reads as the arrangement moving and never as a blink.
 *
 * Latched on the beat, so the colour walks the room in time with the music rather than crawling.
 */
export const spectrumBed: EffectDef = {
	id: 'spectrumBed',
	name: 'Spectrum Bed',
	role: 'bed',
	blurb: 'The room laid out low to high, each part taking its colour from what plays there.',
	taste: {
		energy: 2,
		sections: ['intro', 'groove', 'breakdown', 'build', 'void', 'drop', 'outro'],
		minBars: 2,
		maxBars: 64,
		peakReserved: false
	},
	params: [INTENSITY, param('spread', 'Octaves across the room', 0.7), param('depth', 'Colour travel', 0.6)],
	create(g) {
		// One per pixel would be 1320 latches for a value that only ever moves on the beat, so
		// the ring is read at a handful of points and interpolated between them.
		const TAPS = 12;
		const taps = Array.from({ length: TAPS }, () => new BeatHold(0.18));
		const held = new Float32Array(TAPS);
		const tilt = new BeatHold(0.25);

		return {
			reset() {
				for (const t of taps) t.reset();
				tilt.reset();
				held.fill(0);
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;

				const reach = 0.35 + p.spread * 0.65;
				for (let k = 0; k < TAPS; k++) {
					const u = (k / (TAPS - 1)) * reach;
					held[k] = taps[k].update(bandAt(f, u), f.beat, f.dt, f.beatPeriod);
				}
				const lean = tilt.update(spectralTilt(f), f.beat, f.dt, f.beatPeriod);

				// Level comes from the cue, not from the music. A bed is a room being lit.
				const gain = 0.55 + p.intensity * 0.75;
				const depth = clamp(p.depth);

				for (let i = 0; i < g.count; i++) {
					// Mirrored around the ring so both halves read low-to-high, which keeps the
					// bass at the front wall wherever the strip happens to start.
					const u = ringU(g, i);
					const fold = u < 0.5 ? u * 2 : (1 - u) * 2;
					const at = fold * (TAPS - 1);
					const k = Math.min(TAPS - 2, Math.floor(at));
					const v = held[k] + (held[k + 1] - held[k]) * (at - k);

					// Everything the band says goes into the colour: how far up the palette this
					// part of the room sits, and how far the whole field leans with the mix.
					const slot = lerp(SLOT.base, SLOT.third, clamp(v * depth + lean * depth * 0.4));
					setSample(out, i, palette, slot + hueShift, gain);
				}
			}
		};
	}
};
