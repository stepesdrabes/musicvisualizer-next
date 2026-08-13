import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { addSample, setSample } from '../color/palette.ts';
import { clamp, lerp, smoothstep } from '../dsl/math.ts';
import { ringU } from '../dsl/space.ts';
import { INTENSITY, param } from './helpers.ts';

/**
 * The build as a countdown the room can read: one block per bar flies around the ring and
 * stacks, and the stack is exactly full when the drop lands. Only a compiled show can do
 * this - the effect knows where the drop is because `buildProgress` reaches 1.0 ON its
 * downbeat, so the architecture forecasts the arrival instead of reacting to it.
 */
export const buildStacker: EffectDef = {
	id: 'buildStacker',
	name: 'Build Stacker',
	role: 'rhythm',
	blurb: 'One block per bar flies in and stacks; the ring is exactly full when the drop lands.',
	taste: {
		energy: 4,
		sections: ['build'],
		minBars: 2,
		maxBars: 32,
		peakReserved: false
	},
	params: [INTENSITY, param('blockGlow', 'Block heat', 0.5)],
	create(g) {
		// The stack top at the last downbeat. Latched rather than derived, because the frame
		// does not carry the build's length in bars; after a seek the first latch is a hair
		// high mid-bar and corrects itself at the next downbeat.
		let top = Number.NaN;

		return {
			reset() {
				top = Number.NaN;
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;
				const progress = clamp(f.buildProgress);
				if (Number.isNaN(top) || f.downbeat || progress < top) top = progress;

				// The flying block departs on the downbeat and lands on the next: it carries
				// the bar's own length, so it touches down exactly as the stack grows.
				const flight = smoothstep(0.1, 0.95, f.barPhase);
				const from = 1;
				const to = top;
				const blockPos = lerp(from, to, flight);
				const blockWidth = 0.02;

				const heat = clamp(progress * 0.85 + 0.1);
				const sustain = 0.28 + p.intensity * 0.5;

				for (let i = 0; i < g.count; i++) {
					const pos = ringU(g, i);
					if (pos < top) {
						// The stack itself, heating toward the drop: early bars sit at base,
						// the last one grazes white - the same story the riser is telling.
						const slot = lerp(SLOT.base, lerp(SLOT.glow, SLOT.white, heat * 0.5), pos / Math.max(0.05, top));
						setSample(out, i, palette, slot + hueShift, sustain * (0.7 + heat * 0.5));
					} else {
						setSample(out, i, palette, SLOT.deep + hueShift, 0.04);
					}
					const d = Math.abs(pos - blockPos);
					if (d < blockWidth && progress > 0) {
						const v = 1 - d / blockWidth;
						addSample(
							out,
							i,
							palette,
							lerp(SLOT.glow, SLOT.white, p.blockGlow) + hueShift,
							v * v * (0.5 + p.intensity * 0.8)
						);
					}
				}
			}
		};
	}
};
