import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { sample } from '../color/palette.ts';
import { Edge, INTENSITY, param } from './helpers.ts';

/**
 * Every real desk keeps a colour bump under a finger for the moments timecode cannot
 * predict. Floods the room in the accent hue and decays over a beat and a half.
 */
export const colorBump: EffectDef = {
	id: 'colorBump',
	name: 'Colour Bump',
	role: 'master',
	blurb: 'Manual one-shot accent-colour flood.',
	taste: {
		energy: 4,
		sections: ['drop', 'groove', 'breakdown', 'build'],
		minBars: 0,
		maxBars: 1,
		peakReserved: false
	},
	params: [INTENSITY, param('trigger', 'Trigger', 0, 0, 1, 1)],
	create(g) {
		const edge = new Edge();
		let level = 0;

		return {
			reset() {
				edge.reset();
				level = 0;
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;
				if (edge.update(p.trigger > 0.5)) level = 1;

				level *= Math.exp(-f.dt / Math.max(0.1, f.beatPeriod * 0.9));
				if (level < 0.004) {
					out.fill(0);
					return;
				}

				const c = sample(palette, SLOT.accent + hueShift, level * (0.6 + p.intensity * 1.4));
				for (let i = 0; i < g.count; i++) {
					const o = i * 3;
					out[o] = c[0];
					out[o + 1] = c[1];
					out[o + 2] = c[2];
				}
			}
		};
	}
};
