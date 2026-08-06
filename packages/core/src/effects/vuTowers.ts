import type { EffectDef } from '../contracts/effect.ts';
import { hash01 } from '../dsl/rng.ts';
import { Band } from '../contracts/frame.ts';
import { SLOT } from '../contracts/palette.ts';
import { addSample, sample } from '../color/palette.ts';
import { clamp, envelope, lerp } from '../dsl/math.ts';
import { fadeToBlack, stampGaussian } from '../dsl/buffer.ts';
import { beatRelease, INTENSITY, param } from './helpers.ts';

/**
 * Volume changes LENGTH, not brightness - that is the difference between a meter and a
 * wall that pulses. Falling peak dots under gravity make it legible as a measurement.
 */
export const vuTowers: EffectDef = {
	id: 'vuTowers',
	name: 'VU Towers',
	role: 'rhythm',
	blurb: 'Centre-out gravity meters on every strip, bass-driven, white peak dots.',
	taste: {
		energy: 3,
		sections: ['groove', 'drop', 'build'],
		minBars: 2,
		maxBars: 32,
		peakReserved: false
	},
	params: [INTENSITY, param('gravity', 'Peak fall', 0.4)],
	create(g) {
		const n = g.strips.length;
		const level = new Float32Array(n);
		const peak = new Float32Array(n);
		const vel = new Float32Array(n);
		const bias = new Float32Array(n);
		for (let s = 0; s < n; s++) bias[s] = 0.8 + 0.3 * hash01(s * 31);

		return {
			reset() {
				level.fill(0);
				peak.fill(0);
				vel.fill(0);
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;
				fadeToBlack(out, f.dt, 0.05);

				const drive = clamp(f.kickEnv * 0.5 + f.bands[Band.Sub] * 0.65 + f.bands[Band.Low] * 0.2);
				const rel = beatRelease(f.beatPeriod, 0.55);
				const gain = 0.45 + p.intensity * 1.1;
				const gravity = 0.8 + p.gravity * 6;

				for (let s = 0; s < n; s++) {
					const strip = g.strips[s];
					// A slightly different mix per strip, so the room does not move as one slab.
					const mix = clamp(drive * bias[s] + f.bands[Band.Low] * 0.12 * (s % 2));
					level[s] = envelope(level[s], mix, f.dt, 0, rel);

					const lvl = clamp(level[s] * gain);
					if (lvl >= peak[s]) {
						peak[s] = lvl;
						vel[s] = 0;
					} else {
						vel[s] += gravity * f.dt;
						peak[s] = Math.max(lvl, peak[s] - vel[s] * f.dt);
					}

					const mid = strip.count / 2;
					const barPx = lvl * mid;

					for (let k = 0; k < strip.count; k++) {
						const d = Math.abs(k - mid);
						if (d > barPx + 1) continue;
						const edge = d > barPx ? 1 - (d - barPx) : 1;
						const slot = lerp(SLOT.base, SLOT.accent, d / mid);
						addSample(out, strip.offset + k, palette, slot + hueShift, edge * 0.9);
					}

					const pk = peak[s] * mid;
					const c = sample(palette, SLOT.white + hueShift, 0.8);
					const lo = strip.offset;
					const hi = strip.offset + strip.count;
					stampGaussian(out, g.count, lo + mid + pk, 0.8, c[0], c[1], c[2], false, lo, hi);
					stampGaussian(out, g.count, lo + mid - pk, 0.8, c[0], c[1], c[2], false, lo, hi);
				}
			}
		};
	}
};
