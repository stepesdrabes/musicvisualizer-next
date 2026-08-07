import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { alphaFor, clamp, envelope, frac, lerp } from '../dsl/math.ts';
import { nblend, setPixel } from '../dsl/buffer.ts';
import { ringU } from '../dsl/space.ts';
import { INTENSITY, param } from './helpers.ts';

/**
 * Three molten drops drifting around the ring. Where two overlap their light adds and
 * the palette slot climbs toward the glow, so touching blobs visibly fuse into something
 * hotter instead of just being brighter.
 */
export const lavaBlobs: EffectDef = {
	id: 'lavaBlobs',
	name: 'Lava Blobs',
	role: 'bed',
	blurb: 'Molten blobs drifting the ring, fusing where they touch. Slow and heavy.',
	taste: {
		energy: 2,
		sections: ['intro', 'groove', 'breakdown', 'build', 'void', 'drop', 'outro'],
		minBars: 2,
		maxBars: 64,
		peakReserved: false
	},
	params: [INTENSITY, param('size', 'Blob size', 0.5)],
	create(g) {
		const buf = new Float32Array(g.count * 3);
		let level = 0;

		return {
			reset() {
				level = 0;
				buf.fill(0);
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;

				// The floor is high because the cue's own intensity already says the passage is
				// quiet. A bed that dims itself as well is dimmed twice, and two multiplications
				// of a number under one is how an intro reached byte zero.
				level = envelope(level, clamp(0.55 + f.energy * 0.45), f.dt, 0.2, 1.1);
				const gain = level * (0.4 + p.intensity * 0.8);
				const clock = (f.barIndex + f.barPhase) * 0.03;
				const sigma = 0.03 + p.size * 0.05;
				const inv = 1 / (2 * sigma * sigma);

				// Two incommensurate sines per centre: organic drift, still deterministic.
				const c0 = frac(0.1 + 0.3 * Math.sin(clock * 2.3) + 0.1 * Math.sin(clock * 5.1));
				const c1 = frac(0.45 + 0.28 * Math.sin(clock * 1.7 + 2) + 0.12 * Math.sin(clock * 4.3));
				const c2 = frac(0.78 + 0.26 * Math.sin(clock * 2.9 + 4) + 0.1 * Math.sin(clock * 3.7));

				for (let i = 0; i < g.count; i++) {
					const u = ringU(g, i);
					// Unrolled over the three blobs: no array literal inside the pixel loop.
					let d0 = Math.abs(u - c0);
					if (d0 > 0.5) d0 = 1 - d0;
					let d1 = Math.abs(u - c1);
					if (d1 > 0.5) d1 = 1 - d1;
					let d2 = Math.abs(u - c2);
					if (d2 > 0.5) d2 = 1 - d2;
					const m = Math.exp(-d0 * d0 * inv) + Math.exp(-d1 * d1 * inv) + Math.exp(-d2 * d2 * inv);
					if (m < 0.02) {
						setPixel(buf, i, 0, 0, 0);
						continue;
					}
					const slot = lerp(SLOT.deep, SLOT.glow, clamp(m * 0.7));
					setSample(buf, i, palette, slot + hueShift, Math.min(m, 1.4) * gain);
				}

				nblend(out, buf, alphaFor(f.dt, 0.12));
			}
		};
	}
};
