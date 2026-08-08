import type { EffectDef } from '../contracts/effect.ts';
import { Band } from '../contracts/frame.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { clamp, envelope, lerp } from '../dsl/math.ts';
import { pulse } from '../dsl/wave.ts';
import { BeatHold, PulseEnv } from '../dsl/env.ts';
import { INTENSITY, param } from './helpers.ts';

export const pump: EffectDef = {
	id: 'pump',
	name: 'Pump',
	role: 'rhythm',
	blurb: 'The room pulses on the downbeat, or ducks on every kick. Duck mode is the EDM signature.',
	taste: {
		energy: 4,
		sections: ['groove', 'breakdown', 'build', 'drop'],
		minBars: 2,
		maxBars: 32,
		peakReserved: false
	},
	params: [
		INTENSITY,
		param('duck', 'Duck mode', 1, 0, 1, 1),
		param('depth', 'Depth', 0.65),
		param('decay', 'Decay beats', 0.5, 0.1, 2)
	],
	create() {
		const env = new PulseEnv();
		// The passage's own level and the low band's colour, both read once per beat. Both are
		// beat-resolution data the player interpolates per frame, so a brightness or a hue taken
		// from them raw slides continuously between beats instead of moving with the music.
		const passage = new BeatHold(0.4);
		const tone = new BeatHold(0.15);
		// How much kick there is to duck against. A sidechain with no kick under it is a flat
		// wall of colour, so as this fades the bar grid takes the groove over.
		let drive = 0;
		let base = 0;
		return {
			reset() {
				env.reset();
				passage.reset();
				tone.reset();
				drive = 0;
				base = 0;
			},
			render(out, ctx) {
				const { f, g, p, palette, motion } = ctx;
				const passageLevel = passage.update(f.energy, f.beat, f.dt, f.beatPeriod);
				base = envelope(base, clamp(0.4 + 0.6 * passageLevel), f.dt, 0.06, 0.4);
				drive = envelope(drive, clamp(f.kickEnv * 1.4), f.dt, 0.01, f.beatPeriod * 3);

				let level: number;
				if (p.duck > 0.5) {
					// Sidechain: the gap the kick carves out IS the groove.
					const duck = Math.max(clamp(f.kickEnv), (1 - drive) * pulse(f.beatPhase, 5));
					level = base * (1 - duck * p.depth);
				} else {
					if (f.downbeat) env.fire(1);
					level =
						base * (1 - p.depth + env.decay(f.dt, f.beatPeriod, p.decay / Math.max(0.05, motion)) * p.depth);
				}

				const bright = level * p.intensity;
				const low = tone.update(f.bands[Band.Low], f.beat, f.dt, f.beatPeriod);
				const slot = lerp(SLOT.base, SLOT.glow, clamp(low));
				for (let i = 0; i < g.count; i++) {
					setSample(out, i, palette, slot + ctx.hueShift, bright);
				}
			}
		};
	}
};
