import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { sample } from '../color/palette.ts';
import { fadeToBlack } from '../dsl/buffer.ts';
import { stampOnStrip } from '../dsl/space.ts';
import { beatRelease, INTENSITY, param } from './helpers.ts';

const MAX_FLICKS = 6;

interface Flick {
	alive: boolean;
	t0: number;
	outward: boolean;
	slot: number;
}

/**
 * The beam is the room's exclamation mark: it should mostly rest, then move decisively.
 * Kicks streak it centre-out, snares flick it ends-in.
 *
 * The pair of heads leans toward wherever the mix is sitting, so a vocal thrown hard left and
 * right on every sixteenth throws the beam with it. That is a bias on a movement the effect
 * was already making, not a position: mapping pan straight onto the beam gets a rig that
 * lurches every time a pad happens to be wide.
 */
export const beamFlick: EffectDef = {
	id: 'beamFlick',
	name: 'Beam Flick',
	role: 'transient',
	blurb: 'The ceiling beam answers: kicks streak centre-out, snares flick ends-in.',
	taste: {
		energy: 3,
		sections: ['groove', 'breakdown', 'build', 'drop'],
		minBars: 1,
		maxBars: 32,
		peakReserved: false
	},
	params: [
		INTENSITY,
		param('travelBeats', 'Beats to cross', 1, 0.25, 2, 0.25),
		param('panLean', 'Follow the mix', 0.5, 0, 1, 0.05)
	],
	create(g) {
		const beam = g.strips.find((s) => !s.inPerimeter) ?? g.strips[g.strips.length - 1];
		const flicks: Flick[] = [];
		for (let i = 0; i < MAX_FLICKS; i++) {
			flicks.push({ alive: false, t0: 0, outward: true, slot: SLOT.base });
		}
		let next = 0;
		let lastHit = -1;

		return {
			reset() {
				for (const fl of flicks) fl.alive = false;
				next = 0;
				lastHit = -1;
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;
				fadeToBlack(out, f.dt, beatRelease(f.beatPeriod, 0.6));

				const refractory = Math.max(0.05, f.beatPeriod * 0.4);
				if ((f.kick || f.snare) && f.t - lastHit > refractory) {
					lastHit = f.t;
					const fl = flicks[next];
					next = (next + 1) % MAX_FLICKS;
					fl.alive = true;
					fl.t0 = f.t;
					fl.outward = f.kick;
					fl.slot = f.kick ? SLOT.base : SLOT.accent;
				}

				const travel = Math.max(0.1, p.travelBeats * f.beatPeriod);
				const gain = 0.6 + p.intensity * 1.4;
				const half = beam.count / 2;
				// Only as far as the mix is actually wide: a mono passage stays centred.
				const lean = f.pan * f.panWidth * p.panLean * half;

				for (const fl of flicks) {
					if (!fl.alive) continue;
					const u = (f.t - fl.t0) / travel;
					if (u >= 1) {
						fl.alive = false;
						continue;
					}
					const dist = u * half;
					const posA = (fl.outward ? half + dist : dist) + lean;
					const posB = (fl.outward ? half - dist : beam.count - 1 - dist) + lean;
					const c = sample(palette, fl.slot + hueShift, gain * (1 - u * 0.6));
					stampOnStrip(out, g.count, beam, posA, 1.3, c);
					stampOnStrip(out, g.count, beam, posB, 1.3, c);
				}
			}
		};
	}
};
