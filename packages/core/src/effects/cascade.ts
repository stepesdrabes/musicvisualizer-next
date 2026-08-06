import type { EffectDef } from '../contracts/effect.ts';
import type { StripSpec } from '../contracts/room.ts';
import { SLOT } from '../contracts/palette.ts';
import { addSample } from '../color/palette.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { beatRelease, INTENSITY } from './helpers.ts';

/**
 * Four fixture groups fire in sequence across the bar - beam, front, sides, back - so
 * the light visibly pours from the ceiling down and around the room. A call-and-response
 * chase at the scale of the architecture.
 */
export const cascade: EffectDef = {
	id: 'cascade',
	name: 'Cascade',
	role: 'rhythm',
	blurb: 'Beam, front, sides, back: light pours through the room once per bar.',
	taste: {
		energy: 3,
		sections: ['groove', 'breakdown', 'build', 'drop'],
		minBars: 2,
		maxBars: 32,
		peakReserved: false
	},
	params: [INTENSITY],
	create(g) {
		const beam = g.strips.find((s) => !s.inPerimeter) ?? null;
		const walls = g.strips.filter((s) => s.inPerimeter);
		const groups: StripSpec[][] = [
			beam ? [beam] : [],
			walls[0] ? [walls[0]] : [],
			[walls[1], walls[3]].filter((s): s is StripSpec => Boolean(s)),
			walls[2] ? [walls[2]] : []
		];
		const env = new Float32Array(4);
		let lastStage = -1;

		return {
			reset() {
				env.fill(0);
				lastStage = -1;
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;
				out.fill(0);

				const stage = Math.floor(f.barPhase * 4) % 4;
				if (stage !== lastStage) {
					lastStage = stage;
					env[stage] = 1;
				}

				const tail = Math.exp(-f.dt / beatRelease(f.beatPeriod, 0.9));
				const gain = (0.5 + p.intensity * 1.2) * clamp(0.3 + f.energy * 0.9);

				for (let s = 0; s < 4; s++) {
					env[s] *= tail;
					const v = env[s];
					if (v < 0.015) continue;
					// The beam pours in glow; the walls drain back toward the deep shade as the
					// light leaves them - a waterfall of palette, not of position.
					const slot = s === 0 ? SLOT.glow : lerp(SLOT.base, SLOT.deep, (1 - v) * 0.6);
					for (const strip of groups[s]) {
						for (let k = 0; k < strip.count; k++) {
							// Feathered ends so neighbouring groups blend at the corners.
							const e = Math.min(1, Math.min(k, strip.count - 1 - k) * 0.08 + 0.4);
							addSample(out, strip.offset + k, palette, slot + hueShift, v * gain * e);
						}
					}
				}
			}
		};
	}
};
