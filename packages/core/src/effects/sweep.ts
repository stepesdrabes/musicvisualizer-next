import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { frac, lerp } from '../dsl/math.ts';
import { computeU } from '../dsl/space.ts';
import { INTENSITY, param } from './helpers.ts';

export const sweep: EffectDef = {
	id: 'sweep',
	name: 'Sweep',
	role: 'rhythm',
	blurb: 'A wavefront crossing the room in world space; the axis turns a quarter every 4 bars.',
	taste: {
		energy: 3,
		sections: ['groove', 'breakdown', 'build', 'drop'],
		minBars: 2,
		maxBars: 32,
		peakReserved: false
	},
	params: [
		INTENSITY,
		param('bars', 'Bars per pass', 2, 0.5, 8, 0.5),
		param('width', 'Front width', 0.16, 0.03, 0.5),
		param('turn', 'Turn axis', 1, 0, 1, 1)
	],
	create(g) {
		const u = new Float32Array(g.count);
		let quarter = -1;
		let phase = 0;
		return {
			reset() {
				quarter = -1;
				phase = 0;
			},
			render(out, ctx) {
				const { f, p, palette } = ctx;
				const wanted = p.turn > 0.5 ? Math.floor(f.barIndex / 4) % 4 : 0;
				if (wanted !== quarter) {
					quarter = wanted;
					computeU(u, ctx.g, 'sweep', (quarter * Math.PI) / 2);
				}

				phase = frac(phase + (f.dt / (p.bars * f.beatPeriod * 4)) * ctx.motion);

				const w = p.width;
				for (let i = 0; i < g.count; i++) {
					let d = u[i] - phase;
					d -= Math.floor(d + 0.5);
					const front = Math.exp(-(d * d) / (2 * w * w));
					const slot = lerp(SLOT.base, SLOT.white, front * front);
					setSample(out, i, palette, slot + ctx.hueShift, front * p.intensity);
				}
			}
		};
	}
};
