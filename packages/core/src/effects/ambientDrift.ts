import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { clamp, frac, lerp } from '../dsl/math.ts';
import { sinewave } from '../dsl/wave.ts';
import { ringU } from '../dsl/space.ts';
import { spectralTilt, spectrumPeak } from '../dsl/spectrum.ts';
import { BeatHold } from '../dsl/env.ts';
import { INTENSITY, param } from './helpers.ts';

/**
 * Deliberately dull, on a 30-60 s period: silence should look like the room resting, not like
 * the analyser chewing on the noise floor.
 *
 * Deaf to level, and no longer deaf to the music. `listen` opens a breath of spectrum onto the
 * drift, which is what an intro under a lone pad needs: nothing here answers a hit, but the
 * room now knows whether anything is playing at all. Set it to zero for the old idle wash.
 */
export const ambientDrift: EffectDef = {
	id: 'ambientDrift',
	name: 'Ambient Drift',
	role: 'bed',
	blurb: 'Calm idle wash. Very slow, very dim, ignores the music.',
	taste: {
		energy: 1,
		sections: ['intro', 'groove', 'breakdown', 'build', 'void', 'drop', 'outro'],
		minBars: 2,
		maxBars: 64,
		peakReserved: false
	},
	params: [INTENSITY, param('period', 'Period', 0.5), param('listen', 'How much it hears', 0.45)],
	create(g) {
		const latch = new BeatHold(0.4);
		let phase = 0;
		let heard = 0;
		return {
			reset() {
				phase = 0;
				heard = 0;
				latch.reset();
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;
				phase += f.dt / (30 + p.period * 30);
				const gain = 0.32 + p.intensity * 0.5;

				// Latched on the beat and then eased over several seconds on top. The point is to
				// know whether anything is playing, which is a question about the passage rather
				// than about the moment, and a drift that twitches has stopped being a drift.
				const target = latch.update(0.35 * spectrumPeak(f) + 0.65 * spectralTilt(f), f.beat, f.dt, f.beatPeriod);
				heard += (target - heard) * (1 - Math.exp(-f.dt / 6));
				const listen = clamp(p.listen);

				for (let i = 0; i < g.count; i++) {
					const u = ringU(g, i);
					const v = 0.35 + 0.65 * sinewave(u * 0.7 + phase + heard * listen * 0.35);
					const slot = lerp(SLOT.deep, SLOT.glow, clamp(v * (1 + (heard - 0.5) * listen)));
					setSample(out, i, palette, slot + frac(phase * 0.3) * 0.06 + hueShift, v * gain);
				}
			}
		};
	}
};
