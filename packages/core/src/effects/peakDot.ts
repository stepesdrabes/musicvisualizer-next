import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { addSample, setSample } from '../color/palette.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { Follower } from '../dsl/env.ts';
import { bandBetween } from '../dsl/spectrum.ts';
import { INTENSITY, param } from './helpers.ts';

/**
 * Five quiet meters, one per strip, each with a ballistic peak marker: the level rides up
 * instantly and the dot falls back at constant speed in beat-derived units, so every
 * transient leaves a visible after-image. Written for the passages where the room goes
 * flattest - a verse, an outro, the lounge - where a full meter would be too loud and a
 * still bed too dead.
 */
export const peakDot: EffectDef = {
	id: 'peakDot',
	name: 'Peak Dot',
	role: 'accent',
	blurb: 'Per-wall meters whose peak markers fall under gravity - transients leave after-images.',
	taste: {
		energy: 2,
		sections: ['intro', 'groove', 'breakdown', 'outro'],
		minBars: 2,
		maxBars: 64,
		peakReserved: false,
		quiet: 3.92,
		carries: false
	},
	params: [INTENSITY, param('fall', 'Fall speed', 0.4)],
	create(g) {
		const strips = g.strips;
		const levels = strips.map(() => new Follower(0.03, 0.25));
		const peaks = new Float32Array(strips.length);

		return {
			reset() {
				for (const l of levels) l.reset();
				peaks.fill(0);
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;
				out.fill(0);

				// The dot falls a fixed fraction of the strip per beat, scaled by the cue's
				// motion: a resting outro lets the after-images hang, a groove snaps them down.
				const fallPerSecond =
					((0.25 + p.fall * 0.6) / Math.max(0.05, f.beatPeriod)) * Math.max(0.05, motion);

				for (let s = 0; s < strips.length; s++) {
					const strip = strips[s];
					// Each strip owns a slice of the spectrum, lowest at the first wall, so
					// the five meters together are a coarse analyser laid around the room.
					const slice = bandBetween(f, s / strips.length, (s + 1) / strips.length);
					const level = levels[s].update(clamp(slice), f.dt);

					if (level > peaks[s]) peaks[s] = level;
					else peaks[s] = Math.max(0, peaks[s] - fallPerSecond * f.dt);

					const litTo = Math.floor(level * (strip.count - 1));
					const dotAt = strip.offset + Math.round(peaks[s] * (strip.count - 1));
					const fillGain = (0.1 + p.intensity * 0.16) * (0.5 + level * 0.5);

					for (let k = 0; k <= litTo; k++) {
						const i = strip.offset + k;
						const u = k / Math.max(1, strip.count - 1);
						setSample(out, i, palette, lerp(SLOT.deep, SLOT.base, u) + hueShift, fillGain);
					}
					if (peaks[s] > 0.02) {
						addSample(
							out,
							dotAt,
							palette,
							SLOT.glow + hueShift,
							(0.3 + p.intensity * 0.5) * (0.4 + peaks[s] * 0.6)
						);
					}
				}
			}
		};
	}
};
