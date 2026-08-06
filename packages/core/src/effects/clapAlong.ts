import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { sample } from '../color/palette.ts';
import { clamp } from '../dsl/math.ts';
import { fadeToBlack } from '../dsl/buffer.ts';
import { stampOnStrip } from '../dsl/space.ts';
import { beatRelease, INTENSITY } from './helpers.ts';

/**
 * Symmetry is what makes this read as a crowd of hands rather than as scattered hits:
 * every clap fires mirrored positions on both side walls, cycling four spots.
 */
export const clapAlong: EffectDef = {
	id: 'clapAlong',
	name: 'Clap Along',
	role: 'transient',
	blurb: 'Mirrored double-flashes on the side walls with every clap.',
	taste: {
		energy: 3,
		sections: ['groove', 'breakdown', 'build', 'drop'],
		minBars: 2,
		maxBars: 32,
		peakReserved: false
	},
	params: [INTENSITY],
	create(g) {
		const sideWalls = g.strips.filter((s) => s.inPerimeter && s.normal[0] !== 0);
		let clapCount = 0;
		let lastHit = -1;

		return {
			reset() {
				clapCount = 0;
				lastHit = -1;
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;
				fadeToBlack(out, f.dt, beatRelease(f.beatPeriod, 0.35));
				if (sideWalls.length === 0) return;

				const refractory = Math.max(0.06, f.beatPeriod * 0.3);
				if (f.snare && f.t - lastHit > refractory) {
					lastHit = f.t;
					clapCount++;
					const spot = (clapCount % 4) / 4 + 0.125;
					const gain = (0.6 + p.intensity * 1.3) * clamp(0.4 + f.snareEnv);
					for (const wall of sideWalls) {
						const centre = spot * wall.count;
						stampOnStrip(out, g.count, wall, centre, 2.4, sample(palette, SLOT.accent + hueShift, gain));
						stampOnStrip(out, g.count, wall, centre, 0.9, sample(palette, SLOT.white + hueShift, gain * 0.5));
					}
				}
			}
		};
	}
};
