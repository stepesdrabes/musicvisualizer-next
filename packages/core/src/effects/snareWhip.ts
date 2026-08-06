import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { sample } from '../color/palette.ts';
import { clamp } from '../dsl/math.ts';
import { fadeToBlack } from '../dsl/buffer.ts';
import { stampOnStrip } from '../dsl/space.ts';
import { beatRelease, INTENSITY, param } from './helpers.ts';

/**
 * A streak crosses the beam in a quarter of a beat - far faster than any other motion in
 * the room, which is exactly what a whip is. Fires only on snares, so it IS the backbeat.
 */
export const snareWhip: EffectDef = {
	id: 'snareWhip',
	name: 'Snare Whip',
	role: 'transient',
	blurb: 'A whip-crack streak down the beam on every snare. The backbeat, visible.',
	taste: {
		energy: 3,
		sections: ['groove', 'breakdown', 'build', 'drop'],
		minBars: 2,
		maxBars: 32,
		peakReserved: false
	},
	params: [INTENSITY, param('crackBeats', 'Beats to cross', 0.25, 0.125, 1, 0.125)],
	create(g) {
		const beam = g.strips.find((s) => !s.inPerimeter) ?? g.strips[g.strips.length - 1];
		const sides = g.strips.filter((s) => s.inPerimeter && s.normal[0] !== 0);
		let whipT = -1;
		let dir = 1;
		let power = 1;

		return {
			reset() {
				whipT = -1;
				dir = 1;
				power = 1;
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;
				fadeToBlack(out, f.dt, beatRelease(f.beatPeriod, 0.4));

				if (f.snare) {
					whipT = f.t;
					dir = -dir;
					power = clamp(0.5 + f.snareEnv * 0.7);
				}
				if (whipT < 0) return;

				const travel = Math.max(0.05, p.crackBeats * f.beatPeriod);
				const u = (f.t - whipT) / travel;
				if (u > 1.2) return;

				const gain = (0.6 + p.intensity * 1.5) * power;

				if (u <= 1) {
					const pos = (dir > 0 ? u : 1 - u) * (beam.count - 1);
					stampOnStrip(out, g.count, beam, pos, 2.2, sample(palette, SLOT.accent + hueShift, gain));
					stampOnStrip(out, g.count, beam, pos, 0.8, sample(palette, SLOT.white + hueShift, gain * 0.7));
				}

				// The answering shiver on the side walls, a hair later and dimmer.
				const echo = clamp(u - 0.3) * gain * 0.3;
				if (echo > 0.02) {
					for (const wall of sides) {
						const c = sample(palette, SLOT.accent + hueShift, echo * (1.2 - u));
						stampOnStrip(out, g.count, wall, wall.count / 2, wall.count * 0.18, c);
					}
				}
			}
		};
	}
};
