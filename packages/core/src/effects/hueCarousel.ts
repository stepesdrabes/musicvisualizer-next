import type { EffectDef } from '../contracts/effect.ts';
import { hsv2rgb } from '../color/hsv.ts';
import { clamp, frac } from '../dsl/math.ts';
import { sinewave } from '../dsl/wave.ts';
import { INTENSITY, param } from './helpers.ts';

/**
 * The stepping is everything: a smoothly rotating rainbow reads as a screensaver, one
 * that clicks around in quantized 8th-note steps reads as a machine playing the music.
 */
export const hueCarousel: EffectDef = {
	id: 'hueCarousel',
	name: 'Hue Carousel',
	role: 'rhythm',
	blurb: 'The spectrum around the ring, clicking around in 8th-note steps, one rev per phrase.',
	taste: {
		energy: 3,
		sections: ['groove', 'drop'],
		minBars: 4,
		maxBars: 32,
		peakReserved: false
	},
	params: [INTENSITY, param('barsPerRev', 'Bars per revolution', 8, 2, 16, 2)],
	create(g) {
		const rgb: [number, number, number] = [0, 0, 0];
		return {
			reset() {},
			render(out, ctx) {
				const { f, p, hueShift } = ctx;

				const steps = Math.max(2, p.barsPerRev) * 8;
				const stepIdx = Math.floor((f.barIndex + f.barPhase) * 8);
				const spin = (((stepIdx % steps) + steps) % steps) / steps;
				const gain = (0.4 + p.intensity) * clamp(0.3 + f.energy * 0.9);

				for (let i = 0; i < g.count; i++) {
					const u = g.perim[i] >= 0 ? g.perim[i] : g.theta[i];
					// Bar-locked brightness wave gives the wheel light and shade; squared so it
					// dwells dark rather than reading as a flat band of colour.
					const w = 0.25 + 0.75 * Math.pow(sinewave(u * 3 - f.barPhase), 2);
					hsv2rgb(frac(u - spin + hueShift), 0.92, w * gain, rgb);
					const o = i * 3;
					out[o] = rgb[0];
					out[o + 1] = rgb[1];
					out[o + 2] = rgb[2];
				}
			}
		};
	}
};
