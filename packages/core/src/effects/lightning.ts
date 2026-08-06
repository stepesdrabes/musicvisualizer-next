import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { addSample } from '../color/palette.ts';
import { hash01 } from '../dsl/rng.ts';
import { clamp } from '../dsl/math.ts';
import { fadeToBlack } from '../dsl/buffer.ts';
import { PulseEnv } from '../dsl/env.ts';
import { INTENSITY, param } from './helpers.ts';

/**
 * "Random" the way a rig does random: WHICH segment lights is a hash of the 16th-note
 * slot, WHEN is always on the grid, and most slots stay empty.
 */
export const lightning: EffectDef = {
	id: 'lightning',
	name: 'Lightning',
	role: 'transient',
	blurb: 'Deterministic white arcs on the 16th grid. For drops only.',
	taste: {
		energy: 5,
		sections: ['drop', 'build'],
		minBars: 1,
		maxBars: 8,
		peakReserved: false
	},
	params: [INTENSITY, param('density', 'Strike density', 0.35)],
	create(g) {
		const walls = g.strips.filter((s) => s.inPerimeter);
		const env = new PulseEnv();
		let lastSlot = -1;
		let arcWall = 0;
		let arcPos = 0;
		let arcLen = 0;

		return {
			reset() {
				env.reset();
				lastSlot = -1;
				arcWall = 0;
				arcPos = 0;
				arcLen = 0;
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;
				fadeToBlack(out, f.dt, 0.03);
				if (walls.length === 0) return;

				const slot = Math.floor((f.beatIndex + f.beatPhase) * 4);
				if (slot !== lastSlot) {
					lastSlot = slot;
					if (hash01(slot * 7 + 3) < (0.1 + p.density * 0.35) * clamp(f.energy * 1.4)) {
						env.fire(1);
						arcWall = Math.floor(hash01(slot * 13 + 1) * walls.length);
						const wall = walls[arcWall];
						arcLen = Math.min(8 + Math.floor(hash01(slot * 17 + 5) * 14), wall.count);
						arcPos = Math.floor(hash01(slot * 23 + 9) * Math.max(1, wall.count - arcLen));
					}
				}

				const v = env.decay(f.dt, f.beatPeriod, 0.36);
				if (v < 0.02) return;

				const wall = walls[arcWall];
				const gain = (0.7 + p.intensity * 1.3) * v;
				for (let k = 0; k < arcLen; k++) {
					// Jagged profile from the pixel hash: an arc, not a bar.
					const jag = 0.4 + 0.6 * hash01((arcPos + k) * 3 + arcWall * 101);
					addSample(out, wall.offset + arcPos + k, palette, SLOT.white + hueShift, gain * jag);
				}
			}
		};
	}
};
