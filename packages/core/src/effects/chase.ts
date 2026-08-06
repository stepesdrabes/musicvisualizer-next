import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { lerp } from '../dsl/math.ts';
import { INTENSITY, param } from './helpers.ts';

export const chase: EffectDef = {
	id: 'chase',
	name: 'Chase',
	role: 'rhythm',
	blurb: 'Ring segments firing on the grid; direction flips every phrase, beam answers the downbeat.',
	taste: {
		energy: 3,
		sections: ['groove', 'drop', 'build'],
		minBars: 2,
		maxBars: 32,
		peakReserved: false
	},
	params: [
		INTENSITY,
		param('segments', 'Segments', 8, 4, 24, 1),
		param('perBeat', 'Steps per beat', 1, 0.25, 4, 0.25),
		param('tail', 'Tail', 0.5, 0.1, 1.5)
	],
	create(g) {
		let lastStep = -1;
		const level = new Float32Array(32);
		return {
			reset() {
				lastStep = -1;
				level.fill(0);
			},
			render(out, ctx) {
				const { f, p, palette } = ctx;
				const segments = Math.round(p.segments);
				const step = Math.floor((f.beatIndex + f.beatPhase) * p.perBeat);
				const phrase = Math.floor(f.barIndex / 8);
				const dir = phrase % 2 === 0 ? 1 : -1;

				if (step !== lastStep) {
					lastStep = step;
					const seg = (((step * dir) % segments) + segments) % segments;
					level[seg] = 1;
				}

				const decay = 1 - Math.exp(-f.dt / ((p.tail * f.beatPeriod) / ctx.motion));
				for (let s = 0; s < segments; s++) level[s] -= level[s] * decay;

				for (let i = 0; i < g.count; i++) {
					const along = g.perim[i];
					if (along < 0) {
						const beam = f.downbeat ? 1 : level[0] * 0.4;
						setSample(out, i, palette, SLOT.accent + ctx.hueShift, beam * p.intensity * 0.6);
						continue;
					}
					const seg = Math.min(Math.floor(along * segments), segments - 1);
					const v = level[seg];
					const slot = lerp(SLOT.base, SLOT.white, v * v);
					setSample(out, i, palette, slot + ctx.hueShift, v * p.intensity);
				}
			}
		};
	}
};
