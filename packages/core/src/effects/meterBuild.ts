import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { addSample } from '../color/palette.ts';
import { clamp, frac } from '../dsl/math.ts';
import { ringsFor } from '../dsl/space.ts';
import { INTENSITY } from './helpers.ts';

/**
 * The most literal payoff of pre-analysis: the ring IS the progress bar, and it reaches
 * 100% exactly on the drop downbeat.
 */
export const meterBuild: EffectDef = {
	id: 'meterBuild',
	name: 'Meter Build',
	role: 'rhythm',
	blurb: 'The ring fills to 100% exactly at the drop, segment ticks marking progress.',
	taste: {
		energy: 4,
		sections: ['build'],
		minBars: 2,
		maxBars: 16,
		peakReserved: false
	},
	params: [INTENSITY],
	create(g) {
		const ring = ringsFor(g).perimeter;
		let fill = 0;

		return {
			reset() {
				fill = 0;
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;
				out.fill(0);

				// Slew so it can only climb smoothly, but collapse fast when the build ends.
				const delta = clamp(f.buildProgress - fill, -f.dt * 4, f.dt * 0.6);
				fill = clamp(fill + delta);
				if (fill < 0.01) return;

				const n = ring.length;
				const edge = fill * n;
				const gain = 0.45 + p.intensity * 1.2;
				const whiteness = fill * fill;

				for (let k = 0; k < n; k++) {
					if (k > edge) break;
					const head = k > edge - 3;
					const tick = frac((k / n) * 8) < 0.03 ? 1.5 : 1;
					const slot = head ? SLOT.white : whiteness > 0.5 ? SLOT.glow : SLOT.base;
					addSample(out, ring.map[k], palette, slot + hueShift, gain * (head ? 1.6 : 0.65 * tick));
				}
			}
		};
	}
};
