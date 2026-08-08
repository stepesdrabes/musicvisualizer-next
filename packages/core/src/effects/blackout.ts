import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { param } from './helpers.ts';

export const blackout: EffectDef = {
	id: 'blackout',
	name: 'Blackout',
	role: 'bed',
	blurb: 'Everything off but a faint keep-alive on the beam. The void, held.',
	taste: {
		energy: 1,
		sections: ['intro', 'groove', 'breakdown', 'build', 'void', 'drop', 'outro'],
		minBars: 1,
		maxBars: 4,
		peakReserved: false,
		quiet: 1.06,
		// Darkness is the whole instruction.
		carries: false
	},
	params: [param('keepAlive', 'Keep-alive', 0.02, 0, 0.15)],
	create(g) {
		// The beam is the strip that is not part of the perimeter ring, not whichever strip a
		// room spec happens to list last.
		const beam = g.strips.find((s) => !s.inPerimeter) ?? g.strips[g.strips.length - 1];
		return {
			reset() {},
			render(out, ctx) {
				const { p, palette } = ctx;
				out.fill(0);
				if (p.keepAlive <= 0) return;
				for (let k = 0; k < beam.count; k++) {
					setSample(out, beam.offset + k, palette, SLOT.deep + ctx.hueShift, p.keepAlive);
				}
			}
		};
	}
};
