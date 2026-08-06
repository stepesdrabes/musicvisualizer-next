import type { EffectDef } from '../contracts/effect.ts';
import { Band } from '../contracts/frame.ts';
import { hsv2rgb } from '../color/hsv.ts';
import { alphaFor, clamp, envelope, frac } from '../dsl/math.ts';
import { nblend, setPixel } from '../dsl/buffer.ts';
import { noise3 } from '../dsl/wave.ts';
import { INTENSITY, param } from './helpers.ts';

/**
 * Thin-film interference: hue is a WRAPPING function of the noise field, so the colour
 * repeats in fringes like a soap bubble. Low brightness on purpose - this is a surface
 * sheen that makes whatever sits above it look expensive.
 */
export const iridescence: EffectDef = {
	id: 'iridescence',
	name: 'Iridescence',
	role: 'bed',
	blurb: 'Oil-slick interference fringes flowing slowly through the room.',
	taste: {
		energy: 2,
		sections: ['intro', 'groove', 'breakdown', 'build', 'void', 'drop', 'outro'],
		minBars: 2,
		maxBars: 64,
		peakReserved: false
	},
	params: [INTENSITY, param('scale', 'Fringe scale', 0.45)],
	create(g) {
		const buf = new Float32Array(g.count * 3);
		const rgb: [number, number, number] = [0, 0, 0];
		let clock = 0;
		let level = 0;

		return {
			reset() {
				clock = 0;
				level = 0;
				buf.fill(0);
			},
			render(out, ctx) {
				const { f, p, hueShift, motion } = ctx;

				clock += f.dt * 0.05 * motion * (1 + f.bands[Band.Mid] * 0.8);
				level = envelope(level, clamp(0.25 + f.energy * 0.8), f.dt, 0.15, 0.9);
				const bright = level * (0.3 + p.intensity * 0.7);
				const scale = 1.5 + p.scale * 5;
				const t = clock;

				for (let i = 0; i < g.count; i++) {
					const n1 = noise3(g.nx[i] * scale + t, g.ny[i] * scale - t * 0.6, g.nz[i] + t * 0.3);
					const n2 = noise3(g.nx[i] * scale * 1.9 + 17, g.ny[i] * scale * 1.9 - t, 5.1);
					hsv2rgb(frac(n1 * 1.6 + hueShift), 0.75, (0.15 + 0.85 * n2 * n2) * bright, rgb);
					setPixel(buf, i, rgb[0], rgb[1], rgb[2]);
				}

				nblend(out, buf, alphaFor(f.dt, 0.09));
			}
		};
	}
};
