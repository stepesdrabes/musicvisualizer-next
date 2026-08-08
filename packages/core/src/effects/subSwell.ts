import type { EffectDef } from '../contracts/effect.ts';
import { Band } from '../contracts/frame.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { clamp, envelope, lerp } from '../dsl/math.ts';
import { setPixel } from '../dsl/buffer.ts';
import { BeatHold } from '../dsl/env.ts';
import { beatRelease, INTENSITY, param } from './helpers.ts';

/**
 * Not an event but a continuous bloom whose REACH follows the sub-bass, so it
 * complements the kick shells without competing with them. When the sub cuts out before
 * a drop the swell collapses and takes the room's warmth with it.
 */
export const subSwell: EffectDef = {
	id: 'subSwell',
	name: 'Sub Swell',
	role: 'transient',
	blurb: 'Radial bloom from the room centre riding the sub-bass envelope.',
	taste: {
		energy: 3,
		sections: ['groove', 'breakdown', 'build', 'drop'],
		minBars: 2,
		maxBars: 32,
		peakReserved: false
	},
	params: [INTENSITY, param('reach', 'Max reach', 0.6)],
	create(g) {
		// `g.dist` is measured from the room centre, and the nearest LED to it is a third of the
		// way out: every strip sits at the wall/ceiling junction. Against the raw figure the
		// bloom spends its first third on empty space and dies before it reaches a wall, which
		// is why it delivered almost no light at all. Re-based on the room's own depth range.
		const depth = new Float32Array(g.count);
		let near = Infinity;
		let far = 0;
		for (let i = 0; i < g.count; i++) {
			if (g.dist[i] < near) near = g.dist[i];
			if (g.dist[i] > far) far = g.dist[i];
		}
		const span = Math.max(1e-3, far - near);
		for (let i = 0; i < g.count; i++) depth[i] = (g.dist[i] - near) / span;

		const level = new BeatHold(0.25);
		let env = 0;
		return {
			reset() {
				env = 0;
				level.reset();
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;

				env = envelope(
					env,
					clamp(f.bands[Band.Sub] * 1.4),
					f.dt,
					0.012,
					beatRelease(f.beatPeriod, 0.7)
				);
				const reach = env * (0.35 + p.reach * 0.65);
				// The band may carry the REACH continuously, which is what this effect is, but
				// its own frame-to-frame noise is several per cent: brightness taken from it
				// directly shimmers against a beat it has no relationship to, so it lands on one.
				const level01 = level.update(
					clamp(0.45 + 0.55 * f.bands[Band.Sub]),
					f.beat,
					f.dt,
					f.beatPeriod
				);
				const gain = (0.4 + p.intensity) * level01;

				for (let i = 0; i < g.count; i++) {
					const d = depth[i];
					if (d > reach || reach < 0.02) {
						setPixel(out, i, 0, 0, 0);
						continue;
					}
					const v = 1 - d / reach;
					// Deep shade at the rim, base at the core: a pool of colour, not a spot.
					const slot = lerp(SLOT.deep, SLOT.base, v);
					setSample(out, i, palette, slot + hueShift, v * v * gain);
				}
			}
		};
	}
};
