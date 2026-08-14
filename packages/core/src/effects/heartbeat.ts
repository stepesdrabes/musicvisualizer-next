import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { BeatHold, Presence, PulseEnv } from '../dsl/env.ts';
import { INTENSITY, param } from './helpers.ts';

/**
 * Built for half-time feels, where a four-on-the-floor pump would fight the groove: this
 * pulse says the SLOW meter while the hats say the fast one.
 */
export const heartbeat: EffectDef = {
	id: 'heartbeat',
	name: 'Heartbeat',
	role: 'rhythm',
	blurb: 'A radial ba-BUM double pulse once per bar - the half-time chest.',
	taste: {
		energy: 3,
		sections: ['groove', 'breakdown', 'build', 'drop'],
		minBars: 4,
		maxBars: 32,
		peakReserved: false,
		// A chest pulse is a kick gesture: over a passage whose floor is silent it reads
		// as a metronome arguing with the record - two judged tracks said exactly that.
		kit: 'kick'
	},
	params: [INTENSITY, param('depth', 'Pulse depth', 0.6)],
	create(g) {
		const lub = new PulseEnv();
		const dub = new PulseEnv();
		// The passage's own level, latched on the beat: `f.energy` is beat-resolution data the
		// player interpolates per frame, so a brightness multiplied by it slides continuously.
		const passage = new BeatHold(0.45);
		// Timing stays on the bar grid; the kick grants permission to beat at all, and the
		// pulse rises only to the envelope's own level, so a half-time floor gets a half-
		// strength chest and a dropped-out kick rests the room within a couple of bars.
		const kit = new Presence();
		let lastBar = Number.NaN;
		let firedDub = false;

		return {
			reset() {
				lub.reset();
				dub.reset();
				passage.reset();
				kit.reset();
				lastBar = Number.NaN;
				firedDub = false;
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;

				const playing = kit.update(f.kickEnv, f.dt, f.beatPeriod);
				if (f.barIndex !== lastBar) {
					lastBar = f.barIndex;
					firedDub = false;
					if (playing > 0.08) lub.fire(0.65 * playing);
				}
				// The second, stronger beat lands three 16ths in: the "BUM".
				if (!firedDub && f.barPhase >= 0.1875) {
					firedDub = true;
					if (playing > 0.08) dub.fire(playing);
				}
				const v = Math.max(
					lub.decay(f.dt, f.beatPeriod, 1.2 / Math.max(0.05, motion)),
					dub.decay(f.dt, f.beatPeriod, 1.8 / Math.max(0.05, motion))
				);

				const passageLevel = passage.update(f.energy, f.beat, f.dt, f.beatPeriod);
				const level = clamp(0.25 + passageLevel * 0.7) * (0.4 + p.intensity);
				const bright = level * (1 - p.depth + p.depth * v);

				for (let i = 0; i < g.count; i++) {
					// The pulse blooms from the centre: near pixels move most.
					const reach = 1 - g.dist[i] * 0.5 * (1 - v);
					const slot = lerp(SLOT.deep, SLOT.base, clamp(0.35 + v * 0.65));
					setSample(out, i, palette, slot + hueShift, bright * reach);
				}
			}
		};
	}
};
