import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { clamp, lerp, paletteArc } from '../dsl/math.ts';
import { BeatHold } from '../dsl/env.ts';
import { bandBetween, spectralTilt } from '../dsl/spectrum.ts';
import { ringU } from '../dsl/space.ts';
import { INTENSITY, param } from './helpers.ts';

/** One sample per eighth note: fine enough to carry a riff, coarse enough to stay calm. */
const SLOTS_PER_BEAT = 2;
const HISTORY = 64;

/**
 * The last few bars as visible history: every eighth note a colour sample is taken at the
 * front of the room and the whole record crawls away around both sides of the ring, oldest
 * at the back. The scroll is bar arithmetic rather than accumulated state, so a seek
 * reproduces the layout exactly and only the samples themselves need refilling.
 */
export const conveyorGlow: EffectDef = {
	id: 'conveyorGlow',
	name: 'Conveyor Glow',
	role: 'bed',
	blurb: 'Eighth-note colour samples crawl away around the ring - the last bars as visible history.',
	taste: {
		energy: 2,
		sections: ['intro', 'groove', 'breakdown', 'void', 'outro'],
		minBars: 2,
		maxBars: 64,
		peakReserved: false,
		quiet: 3.06,
		// A texture in bed's clothing: most of its field sits in the low bytes where the
		// history recedes, and the carries bar wants a floor. It underlays a lit cue; it
		// does not hold a bare one.
		carries: false
	},
	params: [
		INTENSITY,
		// How many beats of history stretch across half the perimeter.
		param('memoryBeats', 'Memory', 16, 8, 32, 1)
	],
	create(g) {
		/** Palette slot and level per grid step, indexed by step modulo HISTORY. */
		const slots = new Float32Array(HISTORY).fill(Number.NaN);
		const heights = new Float32Array(HISTORY);
		let lastStep = -1;
		const loud = new BeatHold(0.25);

		return {
			reset() {
				slots.fill(Number.NaN);
				heights.fill(0);
				lastStep = -1;
				loud.reset();
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;

				// Sample on the grid, never per frame: each entry in the history is one
				// musical moment, so the conveyor carries the phrase rather than noise.
				const step = Math.floor((f.beatIndex + f.beatPhase) * SLOTS_PER_BEAT);
				if (step !== lastStep) {
					lastStep = step;
					const at = ((step % HISTORY) + HISTORY) % HISTORY;
					// Colour from where the energy sits, level from how much of it there is:
					// a dark verse writes low embers, a bright chorus writes hot wide strokes.
					slots[at] = paletteArc(clamp(spectralTilt(f)));
					heights[at] = clamp(bandBetween(f, 0.05, 0.9));
				}

				const level = loud.update(f.energy, f.beat, f.dt, f.beatPeriod);
				const visible = Math.max(8, Math.round(p.memoryBeats)) * SLOTS_PER_BEAT;
				// Gamma 2.2 sends anything under ~0.34 to the bottom two dozen bytes, so a
				// bed's working range has to sit above it: this is the floor of a cue, not
				// a texture over one.
				const gain = (0.36 + p.intensity * 0.42) * (0.6 + level * 0.4);

				for (let i = 0; i < g.count; i++) {
					// Distance from the front-wall centre, mirrored around both sides: 0 is
					// now, 1 is the oldest visible moment rounding the far corner.
					const u = ringU(g, i);
					const d = Math.min(Math.abs(u - 0.5) * 2, 1);
					const age = d * visible;
					const idx = step - Math.floor(age);
					const at = ((idx % HISTORY) + HISTORY) % HISTORY;
					const slot = slots[at];
					if (Number.isNaN(slot)) {
						setSample(out, i, palette, SLOT.deep + hueShift, 0.12);
						continue;
					}
					// Older samples sink toward deep, so history reads as receding rather
					// than as a second live meter competing with the front.
					const fade = 1 - d * 0.4;
					const height = heights[at];
					setSample(
						out,
						i,
						palette,
						lerp(SLOT.deep, slot, clamp(0.35 + height * 0.65)) + hueShift,
						gain * fade * (0.5 + height * 0.5)
					);
				}
			}
		};
	}
};
