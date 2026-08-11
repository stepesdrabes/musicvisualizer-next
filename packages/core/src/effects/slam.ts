import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { lerp } from '../dsl/math.ts';
import { PulseEnv } from '../dsl/env.ts';
import { Edge, INTENSITY, param } from './helpers.ts';

/**
 * Masters are driven by the show's `hits`, not by the music: the player sets `trigger`
 * while a hit is live. That keeps punctuation on the timeline where the linter can audit
 * it, instead of firing off whatever the audio happens to do.
 */
export const slam: EffectDef = {
	id: 'slam',
	name: 'Slam',
	role: 'master',
	blurb: 'One full-room white frame, decaying through the accent. The blinder hit.',
	taste: {
		energy: 5,
		sections: ['groove', 'breakdown', 'build', 'drop'],
		minBars: 0,
		maxBars: 1,
		peakReserved: false,
		hitOnly: true,
		character: 'impact'
	},
	params: [
		INTENSITY,
		param('trigger', 'Trigger', 0, 0, 1, 1),
		param('beats', 'Decay beats', 1, 0.25, 4)
	],
	create() {
		const env = new PulseEnv();
		const edge = new Edge();
		return {
			reset() {
				env.reset();
				edge.reset();
			},
			render(out, ctx) {
				const { f, g, p, palette } = ctx;
				if (edge.update(p.trigger > 0.5)) env.fire(1);
				const v = env.decay(f.dt, f.beatPeriod, p.beats);

				if (v <= 0) {
					out.fill(0);
					return;
				}
				// Cools white to accent as it decays, the way a tungsten blinder actually does.
				const slot = lerp(SLOT.accent, SLOT.white, v);
				const bright = v * p.intensity;
				for (let i = 0; i < g.count; i++) {
					setSample(out, i, palette, slot + ctx.hueShift, bright);
				}
			}
		};
	}
};
