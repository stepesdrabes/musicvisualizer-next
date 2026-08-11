import type { EffectDef } from '../contracts/effect.ts';
import { sectionBase } from '../contracts/frame.ts';
import { SLOT } from '../contracts/palette.ts';
import { sample } from '../color/palette.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { fillSolid } from '../dsl/buffer.ts';
import { Follower, PulseEnv } from '../dsl/env.ts';
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
		// No 'breakdown': a stripped passage lit by blinder slams is the documented failure
		// the mustCarry rule exists for, and this effect once caused it.
		sections: ['groove', 'build', 'drop'],
		minBars: 1,
		maxBars: 16,
		peakReserved: false,
		// A slam is an event; the room is dark between them. Its old quiet score was the
		// probe rewarding exactly that flash, which is why it declares none now.
		carries: false,
		character: 'impact'
	},
	params: [INTENSITY, param('everyBeat', 'Every beat', 0, 0, 1, 1)],
	create(g) {
		const env = new PulseEnv();
		// Which colour the filament cools toward. Slow: this is where the room settles between
		// slams, not something that should chase the mix.
		const tint = new Follower(0.08, 0.35);

		return {
			reset() {
				env.reset();
				tint.reset();
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;

				const at = tint.update(spectralTilt(f), f.dt);

				const everyBeat = p.everyBeat > 0.5 || sectionBase(f.section) === 'drop';
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
