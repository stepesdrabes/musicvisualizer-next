import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { addSample } from '../color/palette.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { BeatHold } from '../dsl/env.ts';
import { ringU } from '../dsl/space.ts';
import { bandBetween } from '../dsl/spectrum.ts';
import { INTENSITY, param } from './helpers.ts';

/** Bottom, middle and top of the spectrum. At module scope because a literal here allocates. */
const SPAN_LO = [0, 0.3, 0.65];
const SPAN_HI = [0.3, 0.65, 1];

/**
 * Three bands of the mix, three overlapping fields, the whole room.
 *
 * Written as a second layer that is genuinely a layer. Most accents in the catalog are stamps
 * and sparks with almost nothing behind them, which is fine over a full drop stack and leaves a
 * two-layer intro cue lit by one and a half. This covers the room and still says something the
 * bed does not: where the weight of the mix is sitting, right now, in three slow lobes.
 */
export const bandBloom: EffectDef = {
	id: 'bandBloom',
	name: 'Band Bloom',
	role: 'accent',
	blurb: 'Low, middle and top of the mix as three overlapping fields across the room.',
	taste: {
		energy: 2,
		sections: ['intro', 'groove', 'breakdown', 'build', 'drop', 'outro'],
		minBars: 2,
		maxBars: 48,
		peakReserved: false,
		quiet: 3.04
	},
	params: [INTENSITY, param('spread', 'Lobe width', 0.5), param('turn', 'How fast it turns', 0.4)],
	create(g) {
		// The passage's own level, latched on the beat. `f.energy` is beat-resolution data that
		// the player interpolates per frame, so multiplying brightness by it directly slides
		// the whole room continuously - the same shimmer the spectrum caused, by another route.
		// Glided over most of a beat so it arrives as a swell rather than a step.
		const level = new BeatHold(0.45);
		const held = new Float32Array(3);
		const bands = Array.from({ length: 3 }, () => new BeatHold(0.15));
		const slots = [SLOT.base, SLOT.glow, SLOT.third];
		let turn = 0;

		return {
			reset() {
				level.reset();
				held.fill(0);
				turn = 0;
				for (const b of bands) b.reset();
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;
				// Written every frame rather than added onto a decaying buffer. `fadeToBlack` plus
				// `addSample` is the idiom for trails and sparks: the buffer keeps a fraction of
				// the last frame while the full pattern is added on top, so a pattern that MOVES
				// leaves a lagging edge behind it and every pixel it crosses ripples at the frame
				// rate. Measured on a real intro that was 4.2 bytes of ripple, four times the
				// whole room's before this pass.
				out.fill(0);

				turn += (f.dt / Math.max(0.15, f.beatPeriod * 48)) * motion * p.turn;
				// Latched on the beat, and spent on WHERE each lobe sits and what colour it is
				// rather than on how bright it is. Driving the level from these was what made a
				// quiet passage flicker: three bands moving continuously is three independent
				// reasons for the room to change between beats.
				for (let k = 0; k < 3; k++) {
					held[k] = bands[k].update(bandBetween(f, SPAN_LO[k], SPAN_HI[k]), f.beat, f.dt, f.beatPeriod);
				}

				// Scaled by the passage. An accent that fills the room is only useful if it is also
				// proportionate to it: at a flat gain this lit an intro brighter than the drop, which
				// is the contrast collapse a filling layer always risks.
				const gain = (0.32 + p.intensity * 0.7) * clamp(0.16 + level.update(f.energy, f.beat, f.dt, f.beatPeriod) * 0.84);
				// How far the music is allowed to move anything, from the cue's own motion.
				const lively = clamp(0.25 + motion * 0.75);
				// Wide enough that the three overlap everywhere: the room should read as one lit
				// field whose colour moves, not as three spots with gaps between them.
				const width = 0.28 + p.spread * 0.22;

				for (let i = 0; i < g.count; i++) {
					const u = ringU(g, i);
					for (let k = 0; k < 3; k++) {
						// The band leans its own lobe around the room and tints it; all three stay
						// lit, so the room's level never moves with the music.
						const centre = turn + k / 3 + held[k] * 0.05 * lively;
						const d = Math.abs(u - centre - Math.round(u - centre));
						const v = clamp(1 - d / width);
						if (v <= 0) continue;
						const slot = lerp(slots[k], SLOT.white, held[k] * 0.3 * lively);
						addSample(out, i, palette, slot + hueShift, v * v * gain);
					}
				}
			}
		};
	}
};
