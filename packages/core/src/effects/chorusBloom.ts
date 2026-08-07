import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { alphaFor, clamp, envelope, lerp } from '../dsl/math.ts';
import { BeatHold } from '../dsl/env.ts';
import { nblend } from '../dsl/buffer.ts';
import { sinewave } from '../dsl/wave.ts';
import { ringU } from '../dsl/space.ts';
import { bandAt, spectralTilt } from '../dsl/spectrum.ts';
import { INTENSITY } from './helpers.ts';

/**
 * Outside a chorus this rests as a dim base wash, which is what earns the bloom: every
 * 8-bar phrase inside the drop lifts the floor another step, the "one more gear" feeling.
 */
export const chorusBloom: EffectDef = {
	id: 'chorusBloom',
	name: 'Chorus Bloom',
	role: 'bed',
	blurb: 'The bed blooms brighter through the chorus, lifting a step every phrase.',
	taste: {
		energy: 3,
		sections: ['intro', 'groove', 'breakdown', 'build', 'void', 'drop', 'outro'],
		minBars: 2,
		maxBars: 32,
		peakReserved: false
	},
	params: [INTENSITY],
	create(g) {
		const buf = new Float32Array(g.count * 3);
		const lean = new BeatHold(0.3);
		const voices = Array.from({ length: 6 }, () => new BeatHold(0.25));
		const held = new Float32Array(6);
		let bloom = 0;

		return {
			reset() {
				bloom = 0;
				buf.fill(0);
				lean.reset();
				for (const v of voices) v.reset();
				held.fill(0);
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;

				let target = 0.2;
				if (f.section === 'drop') {
					const phrases = Math.floor(f.timeSinceDrop / Math.max(0.1, f.beatPeriod * 32));
					const lift = Math.min(0.3, Number.isFinite(phrases) ? phrases * 0.15 : 0.3);
					target = clamp(0.45 + f.sectionProgress * 0.4 + lift);
				}
				bloom = envelope(bloom, target, f.dt, 0.6, 1.4);

				const gain = (0.5 + p.intensity * 1.1) * (0.55 + bloom * 0.75);

				// Which petal is open is the arrangement's business, not a fixed pattern's. Both
				// readings are latched on the beat and both go into the COLOUR: they used to
				// multiply the brightness too, and a bed whose level follows the spectrum is the
				// shimmer this whole pass exists to remove.
				const tilt = lean.update(spectralTilt(f), f.beat, f.dt, f.beatPeriod);
				for (let k = 0; k < held.length; k++) {
					held[k] = voices[k].update(bandAt(f, k / (held.length - 1)), f.beat, f.dt, f.beatPeriod);
				}

				for (let i = 0; i < g.count; i++) {
					const u = ringU(g, i);
					// Petal lobes that widen as the bloom opens, and lean toward whichever part of
					// the spectrum is carrying: the lobes ride up the room as a filter opens.
					const petal =
						0.7 + 0.3 * sinewave(u * (5 - bloom * 2) + bloom * 0.5 + tilt * 0.6);
					const fold = clamp(u < 0.5 ? u * 2 : (1 - u) * 2) * (held.length - 1);
					const k = Math.min(held.length - 2, Math.floor(fold));
					const voice = held[k] + (held[k + 1] - held[k]) * (fold - k);
					// From the room's home colour up toward its bright read, never from its shadow.
					const slot = lerp(SLOT.base, SLOT.glow, clamp(bloom * 1.15 + voice * 0.35));
					setSample(buf, i, palette, slot + hueShift, gain * petal);
				}

				nblend(out, buf, alphaFor(f.dt, 0.09));
			}
		};
	}
};
