import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { INTENSITY, param } from './helpers.ts';

export const strobe: EffectDef = {
	id: 'strobe',
	name: 'Strobe',
	role: 'master',
	blurb: 'Eighth-note burst alternating wall pairs, which halves the full-field flash rate.',
	taste: {
		energy: 5,
		sections: ['groove', 'breakdown', 'build', 'drop'],
		minBars: 0,
		maxBars: 2,
		peakReserved: false
	},
	params: [
		INTENSITY,
		param('trigger', 'Trigger', 0, 0, 1, 1),
		param('perBeat', 'Flashes per beat', 2, 1, 4, 1)
	],
	create(g) {
		// Alternating pairs rather than the whole room: perceived flash rate at any point in
		// the room is half the strobe rate, which is what keeps a 2-per-beat burst inside
		// the 3 Hz ceiling at club tempos.
		const groupA = new Set<number>();
		for (const s of g.strips) if (s.inPerimeter && s.normal[1] !== 0) groupA.add(s.id);

		return {
			reset() {},
			render(out, ctx) {
				const { f, p, palette } = ctx;
				if (p.trigger <= 0.5) {
					out.fill(0);
					return;
				}

				const step = Math.floor((f.beatIndex + f.beatPhase) * Math.round(p.perBeat));
				const onA = step % 2 === 0;
				// Duty cycle under a half so each flash is a distinct event, not a flicker.
				const phase = (f.beatIndex + f.beatPhase) * Math.round(p.perBeat) - step;
				const lit = phase < 0.4 ? 1 : 0;

				for (let i = 0; i < g.count; i++) {
					const inA = groupA.has(g.strip[i]);
					const v = lit && inA === onA ? p.intensity : 0;
					setSample(out, i, palette, SLOT.white + ctx.hueShift, v);
				}
			}
		};
	}
};
