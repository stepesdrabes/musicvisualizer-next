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
/**
 * How deep the latched band cuts into the level, as a fraction either side of unity.
 *
 * Swept against `levelprobe` and `flickerprobe` after the spectrum stopped being per-band
 * normalised: 0.42 gave intro drift 1.76, 1.05 gave 2.25, 1.4 gave 2.55 and 1.7 gave 2.81, with
 * mean flicker pinned at 0.48 and zero shimmering effects at every depth. The jitter that used to
 * make this dangerous is removed by the centred median in `spectrum.ts`, so the only real cost is
 * coverage - at 1.7 this bed fills 59% of the room against 100% at 0.42, and a bed has to keep
 * filling one. This is where the gain is still most of the way in and the fill is not yet the
 * binding constraint.
 */
const RELIEF = 1.4;

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
		peakReserved: false,
		quiet: 4.71
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

					// How far up the palette this part of the room sits, and how far the whole field
					// leans with the mix.
					const slot = lerp(SLOT.base, SLOT.third, clamp(v * depth + lean * depth * 0.4));
					// And a shallow SPATIAL relief from the same latched band, so the room has a
					// shape that answers the arrangement instead of one flat level. The latch is
					// what makes a band safe on a level at all: the shimmer this effect was
					// rewritten to remove came from reading the spectrum per FRAME, and a value
					// that steps on the beat and glides between beats cannot produce it. Bounded
					// well under unity so the bed still reads as a room being lit.
					// Centred on unity rather than reaching down to it: a relief that only ever darkens
					// is a dimmer, and it cost this bed a third of its coverage when it was written that
					// way. The mixer's highlight compressor takes the tops.
					setSample(out, i, palette, slot + hueShift, gain * (1 + RELIEF * (v - 0.5)));
				}
			}
		};
	}
};
