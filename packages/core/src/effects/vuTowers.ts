import type { EffectDef } from '../contracts/effect.ts';
import { Band } from '../contracts/frame.ts';
import { SLOT } from '../contracts/palette.ts';
import { addSample, sample } from '../color/palette.ts';
import { hash01 } from '../dsl/rng.ts';
import { clamp, envelope, lerp, smoothstep } from '../dsl/math.ts';
import { stampGaussian } from '../dsl/buffer.ts';
import { BeatHold } from '../dsl/env.ts';
import { bandAt } from '../dsl/spectrum.ts';
import { beatRelease, INTENSITY, param } from './helpers.ts';

/**
 * Volume changes LENGTH, not brightness - that is the difference between a meter and a
 * wall that pulses. Falling peak dots under gravity make it legible as a measurement.
 *
 * Every strip owns a different slice of the spectrum, so the room is an analyser rather than a
 * row of identical meters. It used to drive all of them off the same three numbers and tell
 * them apart with a hashed bias, which looks like variety and measures nothing.
 */
export const vuTowers: EffectDef = {
	id: 'vuTowers',
	name: 'VU Towers',
	role: 'rhythm',
	blurb: 'Centre-out gravity meters on every strip, bass-driven, white peak dots.',
	taste: {
		energy: 3,
		sections: ['groove', 'breakdown', 'build', 'drop'],
		minBars: 2,
		maxBars: 32,
		peakReserved: false
	},
	params: [INTENSITY, param('gravity', 'Peak fall', 0.4), param('span', 'Spectrum across the room', 1)],
	create(g) {
		const n = g.strips.length;
		const level = new Float32Array(n);
		const peak = new Float32Array(n);
		const vel = new Float32Array(n);
		// Which slice of the spectrum each strip meters, spread across the room in strip order
		// with a little jitter so two adjacent strips on one wall are not the same column.
		const slice = new Float32Array(n);
		for (let s = 0; s < n; s++) slice[s] = n > 1 ? (s + 0.35 * hash01(s * 31)) / n : 0.5;
		// A bar's length is a position, so it is latched on the beat and glides in beats. Read
		// raw, the spectrum's own few per cent of frame-to-frame noise becomes an edge that
		// chatters against a beat it has no relationship to.
		const held = g.strips.map(() => new BeatHold(0.3));

		return {
			reset() {
				level.fill(0);
				peak.fill(0);
				vel.fill(0);
				for (const h of held) h.reset();
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;
				// A meter is a field, not a trail: every pixel is written every frame, or the
				// receding edge lags behind the bar and ripples at the frame rate.
				out.fill(0);

				const drive = clamp(f.kickEnv * 0.5 + f.bands[Band.Sub] * 0.65 + f.bands[Band.Low] * 0.2);
				const rel = beatRelease(f.beatPeriod, 0.55);
				const gain = 0.45 + p.intensity * 1.1;
				const gravity = (0.8 + p.gravity * 6) * Math.max(0.2, motion);

				for (let s = 0; s < n; s++) {
					const strip = g.strips[s];
					// This strip's own column of the spectrum, blended toward the shared kick drive
					// so the room still moves together on the downbeat. At span 0 it is the old
					// behaviour: one mix everywhere, told apart by nothing but a hashed bias.
					const own = held[s].update(
						bandAt(f, slice[s] * clamp(p.span)),
						f.beat,
						f.dt,
						f.beatPeriod
					);
					const mix = clamp(lerp(drive, own * 1.15 + f.kickEnv * 0.3, clamp(p.span) * 0.8));
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
						// The climb to the accent is held back to the outer stretch, so the body
						// of the meter sits ON the home hue instead of touring everything between
						// the two anchors on its way there.
						const slot = lerp(SLOT.base, SLOT.accent, smoothstep(0.55, 1, d / mid));
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
