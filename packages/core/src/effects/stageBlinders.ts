import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { sample } from '../color/palette.ts';
import { lerp } from '../dsl/math.ts';
import { fillSolid } from '../dsl/buffer.ts';
import { PulseEnv } from '../dsl/env.ts';
import { INTENSITY, param } from './helpers.ts';

/**
 * The slam is instant but the decay is filament physics: white-hot cooling through amber.
 * That cooldown is why tungsten blinders feel warm and LEDs feel cold.
 */
export const stageBlinders: EffectDef = {
	id: 'stageBlinders',
	name: 'Stage Blinders',
	role: 'accent',
	blurb: 'Tungsten blinder slam on the downbeat, cooling white-to-amber like filament.',
	taste: {
		energy: 4,
		sections: ['groove', 'breakdown', 'build', 'drop'],
		minBars: 1,
		maxBars: 16,
		peakReserved: false
	},
	params: [INTENSITY, param('everyBeat', 'Every beat', 0, 0, 1, 1)],
	create(g) {
		const env = new PulseEnv();

		return {
			reset() {
				env.reset();
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;

				const everyBeat = p.everyBeat > 0.5 || f.section === 'drop';
				if (everyBeat ? f.beat : f.downbeat) env.fire(1);
				const v = env.decay(f.dt, f.beatPeriod, 2.25);
				if (v < 0.004) {
					out.fill(0);
					return;
				}

				const slot = lerp(SLOT.white, SLOT.glow, (1 - v) * 0.8);
				fillSolid(out, g.count, sample(palette, slot + hueShift, v * (0.5 + p.intensity * 1.3)));
			}
		};
	}
};
