import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { sample } from '../color/palette.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { fillSolid } from '../dsl/buffer.ts';
import { BeatHold, PulseEnv } from '../dsl/env.ts';
import { spectralTilt } from '../dsl/spectrum.ts';
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
		peakReserved: false,
		quiet: 6.08
	},
	params: [INTENSITY, param('everyBeat', 'Every beat', 0, 0, 1, 1)],
	create(g) {
		const env = new PulseEnv();
		// Which colour the filament cools toward, latched so it steps on the beat rather than
		// sliding through the palette between slams.
		const tint = new BeatHold(0.15);

		return {
			reset() {
				env.reset();
				tint.reset();
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;

				const at = tint.update(spectralTilt(f), f.beat, f.dt, f.beatPeriod);

				const everyBeat = p.everyBeat > 0.5 || f.section === 'drop';
				// A blinder answers the drums. Struck off the envelopes rather than the booleans:
				// a beat the kit is not playing gets the softer slam it deserves.
				if (everyBeat ? f.beat : f.downbeat) env.fire(clamp(0.6 + (f.kickEnv + f.snareEnv) * 0.4));
				const v = env.decay(f.dt, f.beatPeriod, 2.25);
				if (v < 0.004) {
					out.fill(0);
					return;
				}

				const cooled = lerp(SLOT.glow, SLOT.third, at);
				const slot = lerp(SLOT.white, cooled, (1 - v) * 0.8);
				fillSolid(out, g.count, sample(palette, slot + hueShift, v * (0.5 + p.intensity * 1.3)));
			}
		};
	}
};
