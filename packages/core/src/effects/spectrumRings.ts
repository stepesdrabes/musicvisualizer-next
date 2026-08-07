import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { addSample } from '../color/palette.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { fadeToBlack } from '../dsl/buffer.ts';
import { ringU } from '../dsl/space.ts';
import { bandAt, spectrumPeak } from '../dsl/spectrum.ts';
import { INTENSITY, param } from './helpers.ts';

/**
 * The spectrum laid around the room and turning, one band per slice.
 *
 * `spectrumBed` maps the spectrum onto the room and holds it still, which says where the music
 * is sitting. This one turns, so each band walks the walls at its own rate and a sustained
 * chord becomes a slow rotation rather than a static picture. The difference matters most in a
 * long quiet passage, which is precisely where nothing else in the catalog moves.
 *
 * A rhythm layer without a drum in it: what it keeps time to is the beat grid and the
 * arrangement, so it works on a track with no kit at all.
 */
export const spectrumRings: EffectDef = {
	id: 'spectrumRings',
	name: 'Spectrum Rings',
	role: 'rhythm',
	blurb: 'The spectrum wrapped around the room, each band walking at its own rate.',
	taste: {
		energy: 2,
		sections: ['intro', 'groove', 'breakdown', 'build', 'drop', 'outro'],
		minBars: 2,
		maxBars: 48,
		peakReserved: false
	},
	params: [INTENSITY, param('turn', 'Rotation', 0.5), param('bands', 'Slices', 0.6)],
	create(g) {
		const level = new Float32Array(8);
		let turn = 0;

		return {
			reset() {
				level.fill(0);
				turn = 0;
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;
				fadeToBlack(out, f.dt, 0.1 / Math.max(0.1, motion));

				// One full turn every four phrases at motion 1, which is slow enough to read as
				// the room moving rather than as something spinning.
				turn += (f.dt / Math.max(0.2, f.beatPeriod * 128)) * motion * (0.4 + p.turn * 2.2);

				const slices = 3 + Math.round(clamp(p.bands) * 5);
				const a = 1 - Math.exp(-f.dt / Math.max(0.05, f.beatPeriod * 0.4));
				for (let k = 0; k < slices; k++) {
					const u = slices > 1 ? k / (slices - 1) : 0.5;
					level[k] += (bandAt(f, u) - level[k]) * a;
				}

				const loud = spectrumPeak(f);
				if (loud < 0.02) return;
				const gain = (0.4 + p.intensity * 0.85) * clamp(0.35 + loud);
				const width = 1 / slices;

				for (let i = 0; i < g.count; i++) {
					const u = ringU(g, i) + turn;
					const pos = (u - Math.floor(u)) * slices;
					const k = Math.min(slices - 1, Math.floor(pos));
					const frac = pos - k;
					// Blended with the neighbouring slice, so the ring has no seams where a band
					// hands over to the next.
					const nk = (k + 1) % slices;
					const v = level[k] + (level[nk] - level[k]) * frac;
					const slot = lerp(SLOT.base, SLOT.accent, (k + frac) / slices);
					addSample(out, i, palette, slot + hueShift, (0.22 + v * 0.9) * gain);
				}
				void width;
			}
		};
	}
};
