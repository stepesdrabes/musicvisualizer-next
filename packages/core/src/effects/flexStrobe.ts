import type { EffectDef } from '../contracts/effect.ts';
import { hash01 } from '../dsl/rng.ts';
import { SLOT } from '../contracts/palette.ts';
import { addSample } from '../color/palette.ts';
import { clamp } from '../dsl/math.ts';
import { fadeToBlack } from '../dsl/buffer.ts';
import { PulseEnv } from '../dsl/env.ts';
import { sinewave } from '../dsl/wave.ts';
import { INTENSITY } from './helpers.ts';

/**
 * One gesture per backbeat and nothing else: no kick response, no filler. The darkness
 * around it is what makes the constellation read as expensive rather than busy.
 */
export const flexStrobe: EffectDef = {
	id: 'flexStrobe',
	name: 'Flex Strobe',
	role: 'accent',
	blurb: 'A gold constellation shimmering once per snare. Darkness is the flex.',
	taste: {
		energy: 2,
		sections: ['groove', 'breakdown', 'drop'],
		minBars: 2,
		maxBars: 32,
		peakReserved: false
	},
	params: [INTENSITY],
	create(g) {
		const spots: number[] = [];
		for (let i = 0; i < g.count; i++) if (hash01(i * 13 + 5) < 0.11) spots.push(i);
		const spotIdx = Uint16Array.from(spots);
		const twPhase = new Float32Array(spotIdx.length);
		const twRate = new Float32Array(spotIdx.length);
		for (let k = 0; k < spotIdx.length; k++) {
			twPhase[k] = hash01(spotIdx[k]) * 6.28;
			twRate[k] = 0.7 + hash01(spotIdx[k] * 3) * 0.6;
		}
		const env = new PulseEnv();
		let shimmer = 0;

		return {
			reset() {
				env.reset();
				shimmer = 0;
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;
				fadeToBlack(out, f.dt, 0.06);
				if (spotIdx.length === 0) return;

				if (f.snare) env.fire(clamp(0.5 + f.snareEnv * 0.6));
				const v = env.decay(f.dt, f.beatPeriod, 1.65);
				if (v < 0.01) return;

				shimmer += f.dt * 22;
				const gain = (0.55 + p.intensity * 1.2) * v;
				for (let k = 0; k < spotIdx.length; k++) {
					const tw = 0.5 + 0.5 * sinewave(twPhase[k] + shimmer * twRate[k]);
					// In the royal and velvet palette families the accent slot IS the gold.
					addSample(out, spotIdx[k], palette, SLOT.accent + hueShift, v * tw * gain);
				}
			}
		};
	}
};
