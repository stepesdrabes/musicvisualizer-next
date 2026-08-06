import type { EffectDef } from '../contracts/effect.ts';
import { hsv2rgb } from '../color/hsv.ts';
import { frac } from '../dsl/math.ts';
import { setPixel } from '../dsl/buffer.ts';
import { Edge, INTENSITY, param } from './helpers.ts';

/**
 * The rationed full-spectrum special: three concentric shells carrying a slice of the
 * spectrum by radius, two beats of glory, then gone. A rainbow that appears for one
 * breath at the biggest moment stays special all night.
 */
export const chromaBurst: EffectDef = {
	id: 'chromaBurst',
	name: 'Chroma Burst',
	role: 'master',
	blurb: 'One-shot rainbow shockwave rings on the drop and its phrase starts.',
	taste: {
		energy: 5,
		sections: ['drop'],
		minBars: 0,
		maxBars: 2,
		peakReserved: true
	},
	params: [INTENSITY, param('trigger', 'Trigger', 0, 0, 1, 1)],
	create(g) {
		const rgb: [number, number, number] = [0, 0, 0];
		const edge = new Edge();
		let burstT = -1;
		let armedFor = Number.NaN;

		return {
			reset() {
				burstT = -1;
				armedFor = Number.NaN;
				edge.reset();
			},
			render(out, ctx) {
				const { f, p, hueShift } = ctx;

				if (f.section === 'drop' && f.downbeat) {
					const impact = f.timeSinceDrop < 0.3;
					if ((impact || f.phraseStart) && armedFor !== f.barIndex) {
						armedFor = f.barIndex;
						burstT = f.t;
					}
				}
				if (edge.update(p.trigger > 0.5)) burstT = f.t;

				const life = Math.max(0.4, f.beatPeriod * 2);
				const age = burstT >= 0 ? f.t - burstT : Infinity;
				if (age > life) {
					out.fill(0);
					return;
				}

				const u = age / life;
				const gain = (0.7 + p.intensity * 1.3) * (1 - u) * (1 - u);
				const maxR = 4.2;

				for (let i = 0; i < g.count; i++) {
					let r = 0;
					let gr = 0;
					let b = 0;
					// Three shells at staggered radii, each a spectrum slice by radius.
					for (let s = 0; s < 3; s++) {
						const radius = (u * (1 + s * 0.18) - s * 0.06) * maxR;
						if (radius < 0) continue;
						const d = Math.abs(g.dist[i] * maxR - radius);
						if (d > 0.28) continue;
						const v = Math.pow(1 - d / 0.28, 2);
						hsv2rgb(frac(g.dist[i] * 0.8 + s * 0.33 + hueShift), 0.9, v * gain, rgb);
						r += rgb[0];
						gr += rgb[1];
						b += rgb[2];
					}
					setPixel(out, i, r, gr, b);
				}
			}
		};
	}
};
