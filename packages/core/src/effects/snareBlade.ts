import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { addSample } from '../color/palette.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { fadeToBlack } from '../dsl/buffer.ts';
import { Presence } from '../dsl/env.ts';
import { INTENSITY, param } from './helpers.ts';

const MAX_BLADES = 4;

interface Blade {
	alive: boolean;
	strip: number;
	t0: number;
	/** 0 sweeps low-to-high along the strip, 1 the reverse. */
	fromEnd: number;
	power: number;
}

/**
 * Every snare draws one straight stroke: a thin blade wipes a single wall end to end in
 * about a third of a beat and is gone, the next snare taking the next wall in the other
 * direction. Linear, directional, one wall at a time - the whole room never moves at
 * once, which is what separates a stroke from the burst family's everywhere-at-once.
 */
export const snareBlade: EffectDef = {
	id: 'snareBlade',
	name: 'Snare Blade',
	role: 'transient',
	blurb: 'Each snare wipes one wall with a thin blade, alternating walls and directions.',
	taste: {
		energy: 4,
		sections: ['groove', 'verse', 'build', 'drop', 'chorus'],
		minBars: 2,
		maxBars: 32,
		peakReserved: false,
		kit: 'snare'
	},
	params: [INTENSITY, param('sweepBeats', 'Sweep length', 0.35, 0.2, 0.8, 0.05)],
	create(g) {
		const walls = g.strips.filter((s) => s.inPerimeter);
		const blades: Blade[] = [];
		for (let i = 0; i < MAX_BLADES; i++) {
			blades.push({ alive: false, strip: 0, t0: 0, fromEnd: 0, power: 0 });
		}
		let next = 0;
		let strokes = 0;
		const presence = new Presence();

		return {
			reset() {
				for (const b of blades) b.alive = false;
				next = 0;
				strokes = 0;
				presence.reset();
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;
				// The stroke persists as a real trail: the head stamps bright, and what it drew
				// fades over most of a beat - a line someone made, not a dot that visited.
				fadeToBlack(out, f.dt, Math.max(0.06, f.beatPeriod * 0.35));
				if (walls.length === 0) return;
				const permission = presence.update(f.snareEnv, f.dt, f.beatPeriod);

				if (f.snare && permission > 0.15) {
					const b = blades[next];
					next = (next + 1) % MAX_BLADES;
					b.alive = true;
					b.strip = strokes % walls.length;
					b.fromEnd = (strokes >> 1) % 2;
					b.t0 = f.t;
					b.power = clamp(0.4 + f.snareEnv * 0.6) * permission;
					strokes++;
				}

				const sweep = Math.max(0.08, (p.sweepBeats * f.beatPeriod) / Math.max(0.2, motion));
				const gain = 0.55 + p.intensity * 1.0;

				for (const b of blades) {
					if (!b.alive) continue;
					const u = (f.t - b.t0) / sweep;
					if (u >= 1) {
						b.alive = false;
						continue;
					}
					const wall = walls[b.strip];
					// Ease-out: the stroke lands fast and decelerates, which is how a hand
					// draws a line; constant speed reads as a scanner.
					const head = 1 - Math.pow(1 - u, 2);
					const at = b.fromEnd === 0 ? head : 1 - head;
					const centre = wall.offset + at * (wall.count - 1);
					for (let k = 0; k < wall.count; k++) {
						const i = wall.offset + k;
						const d = Math.abs(i - centre);
						if (d < 3) {
							const v = 1 - d / 3;
							addSample(
								out,
								i,
								palette,
								lerp(SLOT.white, SLOT.glow, d / 3) + hueShift,
								v * v * b.power * gain
							);
						}
					}
				}
			}
		};
	}
};
