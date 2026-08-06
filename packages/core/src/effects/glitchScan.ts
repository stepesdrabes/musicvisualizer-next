import type { EffectDef } from '../contracts/effect.ts';
import { hash01 } from '../dsl/rng.ts';
import { SLOT } from '../contracts/palette.ts';
import { addSample } from '../color/palette.ts';
import { clamp } from '../dsl/math.ts';
import { ringsFor } from '../dsl/space.ts';
import { INTENSITY, param } from './helpers.ts';

const MAX_SEGMENTS = 32;

/**
 * Random in space, never in time: which segments light is a hash of the 16th-note slot
 * index, but the timing is always on the grid. Every fourth bar inverts figure and
 * ground, so the picked segments punch holes in a dim field instead of flashing over
 * darkness.
 */
export const glitchScan: EffectDef = {
	id: 'glitchScan',
	name: 'Glitch Scan',
	role: 'rhythm',
	blurb: 'Hash-picked ring segments strobing on the 16th grid, inverting every 4 bars.',
	taste: {
		energy: 4,
		sections: ['drop', 'groove', 'build'],
		minBars: 2,
		maxBars: 16,
		peakReserved: false
	},
	params: [INTENSITY, param('segments', 'Segments', 16, 8, 32, 4)],
	create(g) {
		const ring = ringsFor(g).perimeter;
		const segEnv = new Float32Array(MAX_SEGMENTS);
		let lastSlot = -1;

		return {
			reset() {
				segEnv.fill(0);
				lastSlot = -1;
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;
				out.fill(0);

				const segs = Math.min(MAX_SEGMENTS, Math.max(8, Math.round(p.segments)));
				const slot = Math.floor((f.beatIndex + f.beatPhase) * 4);
				if (slot !== lastSlot) {
					lastSlot = slot;
					const count = 2 + (hash01(slot * 31 + 7) < 0.4 ? 1 : 0);
					for (let c = 0; c < count; c++) {
						segEnv[Math.floor(hash01(slot * 13 + c * 101) * segs)] = 1;
					}
				}

				const inverted = Math.floor(f.barIndex / 4) % 2 === 1;
				const tail = Math.exp(-f.dt / Math.max(0.04, f.beatPeriod * 0.22));
				const gain = (0.5 + p.intensity * 1.3) * clamp(0.3 + f.energy);
				const segPx = ring.length / segs;

				for (let s = 0; s < segs; s++) {
					segEnv[s] *= tail;
					const lit = inverted ? 0.35 * (1 - segEnv[s]) + 0.02 : segEnv[s];
					if (lit < 0.015) continue;
					const hue = inverted ? SLOT.deep + 0.06 : s % 2 === 0 ? SLOT.base : SLOT.accent;
					const lo = Math.floor(s * segPx);
					const hi = Math.floor((s + 1) * segPx) - 1;
					for (let k = lo; k < hi; k++) {
						addSample(out, ring.map[k], palette, hue + hueShift, lit * gain);
					}
				}
			}
		};
	}
};
