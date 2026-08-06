import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { sample } from '../color/palette.ts';
import { fadeToBlack, stampGaussian } from '../dsl/buffer.ts';
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
 */
export const beamFlick: EffectDef = {
	id: 'beamFlick',
	name: 'Beam Flick',
	role: 'transient',
	blurb: 'The ceiling beam answers: kicks streak centre-out, snares flick ends-in.',
	taste: {
		energy: 3,
		sections: ['groove', 'drop', 'breakdown', 'build'],
		minBars: 1,
		maxBars: 32,
		peakReserved: false
	},
	params: [INTENSITY, param('travelBeats', 'Beats to cross', 1, 0.25, 2, 0.25)],
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
				const lo = beam.offset;
				const hi = beam.offset + beam.count;

				for (const fl of flicks) {
					if (!fl.alive) continue;
					const u = (f.t - fl.t0) / travel;
					if (u >= 1) {
						fl.alive = false;
						continue;
					}
					const dist = u * half;
					const posA = fl.outward ? half + dist : dist;
					const posB = fl.outward ? half - dist : beam.count - 1 - dist;
					const c = sample(palette, fl.slot + hueShift, gain * (1 - u * 0.6));
					stampGaussian(out, g.count, lo + posA, 1.3, c[0], c[1], c[2], false, lo, hi);
					stampGaussian(out, g.count, lo + posB, 1.3, c[0], c[1], c[2], false, lo, hi);
				}
			}
		};
	}
};
