import type { EffectDef } from '../contracts/effect.ts';
import { Band } from '../contracts/frame.ts';
import { SLOT } from '../contracts/palette.ts';
import { addSample } from '../color/palette.ts';
import { clamp, envelope, frac } from '../dsl/math.ts';
import { fadeToBlack } from '../dsl/buffer.ts';
import { INTENSITY, param } from './helpers.ts';

/**
 * Smoothed to breath length rather than syllable length, so the spotlight swells with
 * phrases. When the vocal drops out it rests: the emptiness IS the arrangement.
 */
export const vocalGlow: EffectDef = {
	id: 'vocalGlow',
	name: 'Vocal Glow',
	role: 'accent',
	blurb: 'A front-of-room spotlight breathing with the vocal band.',
	taste: {
		energy: 2,
		sections: ['groove', 'breakdown', 'drop', 'intro'],
		minBars: 4,
		maxBars: 32,
		peakReserved: false
	},
	params: [INTENSITY, param('width', 'Spot width', 0.4)],
	create(g) {
		let level = 0;

		return {
			reset() {
				level = 0;
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;
				fadeToBlack(out, f.dt, 0.1);

				const vocal = clamp(f.bands[Band.Mid] * 1.5 - f.bands[Band.Sub] * 0.2);
				level = envelope(level, vocal, f.dt, 0.08, 0.6);
				if (level < 0.05) return;

				const gain = (0.5 + p.intensity * 1.1) * level;
				const width = 0.1 + p.width * 0.25;

				for (let i = 0; i < g.count; i++) {
					// Theta 0.75 is the middle of the front wall in the counter-clockwise frame;
					// the beam's centre catches the edge of the glow too.
					const d = Math.abs(frac(g.theta[i] - 0.75 + 0.5) - 0.5);
					if (d > width) continue;
					const v = Math.pow(1 - d / width, 2);
					const slot = v > 0.7 ? SLOT.white : SLOT.glow;
					addSample(out, i, palette, slot + hueShift, v * gain);
				}
			}
		};
	}
};
