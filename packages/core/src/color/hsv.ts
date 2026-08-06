import { clamp, frac } from '../dsl/math.ts';

const T = 1 / 3;
const C171 = 171 / 255;

/**
 * FastLED's rainbow hue ramp, not textbook HSV. Eight cardinal points with a widened
 * yellow band; textbook HSV gives yellow a thin sliver and reads wrong on LEDs.
 *
 * Value stays linear here. Gamma belongs to the output stage, applied exactly once.
 */
export function hsv2rgb(
	h: number,
	s: number,
	v: number,
	out: [number, number, number] = [0, 0, 0]
): [number, number, number] {
	const hh = frac(h) * 8;
	const section = Math.floor(hh);
	const t = hh - section;
	const third = t * T;
	const twoThirds = t * (2 * T);

	let r: number;
	let g: number;
	let b: number;

	switch (section) {
		case 0:
			r = 1 - third;
			g = third;
			b = 0;
			break;
		case 1:
			r = C171;
			g = T + third;
			b = 0;
			break;
		case 2:
			r = C171 - twoThirds;
			g = 2 * T + third;
			b = 0;
			break;
		case 3:
			r = 0;
			g = 1 - third;
			b = third;
			break;
		case 4:
			r = 0;
			g = C171 - twoThirds;
			b = T + twoThirds;
			break;
		case 5:
			r = third;
			g = 0;
			b = 1 - third;
			break;
		case 6:
			r = T + third;
			g = 0;
			b = C171 - third;
			break;
		default:
			r = 2 * T + third;
			g = 0;
			b = T - third;
			break;
	}

	const sat = clamp(s);
	if (sat < 1) {
		// Quadratic desaturation floor, so partial saturation lifts toward white the way
		// a real fixture does rather than washing out linearly.
		const desat = 1 - sat;
		const floor = desat * desat;
		r = r * sat + floor;
		g = g * sat + floor;
		b = b * sat + floor;
	}

	out[0] = r * v;
	out[1] = g * v;
	out[2] = b * v;
	return out;
}
