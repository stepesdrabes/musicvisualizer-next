import type { EffectDef } from '../contracts/effect.ts';
import { hsv2rgb } from '../color/hsv.ts';
import { frac } from '../dsl/math.ts';
import { fadeToBlack, stampGaussian } from '../dsl/buffer.ts';
import { PulseEnv } from '../dsl/env.ts';
import { INTENSITY, param } from './helpers.ts';

const MAX_DROPS = 24;

interface RainDrop {
	alive: boolean;
	wall: number;
	fromEnd: number;
	t0: number;
	hue: number;
}

/**
 * Successive droplets walk the hue wheel in golden-angle steps, the trick sunflowers
 * use: maximum colour separation between neighbours, no repetition, fully deterministic.
 */
export const rainbowRain: EffectDef = {
	id: 'rainbowRain',
	name: 'Rainbow Rain',
	role: 'rhythm',
	blurb: 'Falling droplets stepping the hue wheel by the golden angle - every drop unique.',
	taste: {
		energy: 3,
		sections: ['groove', 'drop', 'breakdown'],
		minBars: 2,
		maxBars: 16,
		peakReserved: false
	},
	params: [
		INTENSITY,
		param('perBeat', 'Drops per beat', 2, 0.5, 4, 0.5),
		param('fallBeats', 'Beats to land', 3, 1, 8, 0.5)
	],
	create(g) {
		const walls = g.strips.filter((s) => s.inPerimeter);
		const drops: RainDrop[] = [];
		for (let i = 0; i < MAX_DROPS; i++) {
			drops.push({ alive: false, wall: 0, fromEnd: 0, t0: 0, hue: 0 });
		}
		const landGlow = walls.map(() => new PulseEnv());
		const landHue = new Float32Array(walls.length);
		const rgb: [number, number, number] = [0, 0, 0];
		let next = 0;
		let lastStep = -1;
		let spawnCount = 0;

		return {
			reset() {
				for (const d of drops) d.alive = false;
				for (const l of landGlow) l.reset();
				landHue.fill(0);
				next = 0;
				lastStep = -1;
				spawnCount = 0;
			},
			render(out, ctx) {
				const { f, p, hueShift } = ctx;
				fadeToBlack(out, f.dt, Math.max(0.05, f.beatPeriod * 0.3));
				if (walls.length === 0) return;

				const step = Math.floor((f.beatIndex + f.beatPhase) * Math.max(0.5, p.perBeat));
				if (step !== lastStep) {
					lastStep = step;
					spawnCount++;
					const d = drops[next];
					next = (next + 1) % MAX_DROPS;
					d.alive = true;
					d.wall = spawnCount % walls.length;
					d.fromEnd = (spawnCount >> 2) % 2;
					d.t0 = f.t;
					d.hue = frac(spawnCount * 0.381966);
				}

				const fallTime = Math.max(0.3, p.fallBeats * f.beatPeriod);
				const gain = 0.6 + p.intensity * 1.4;

				for (const d of drops) {
					if (!d.alive) continue;
					const u = (f.t - d.t0) / fallTime;
					if (u >= 1) {
						d.alive = false;
						landGlow[d.wall].fire(0.85);
						landHue[d.wall] = d.hue;
						continue;
					}
					const wall = walls[d.wall];
					const half = wall.count / 2;
					const dist = Math.pow(u, 1.8) * half;
					const pos = d.fromEnd === 0 ? dist : wall.count - 1 - dist;
					hsv2rgb(frac(d.hue + hueShift), 0.92, gain * (0.5 + 0.5 * u), rgb);
					stampGaussian(
						out,
						g.count,
						wall.offset + pos,
						1.1,
						rgb[0],
						rgb[1],
						rgb[2],
						false,
						wall.offset,
						wall.offset + wall.count
					);
				}

				for (let w = 0; w < walls.length; w++) {
					const v = landGlow[w].decay(f.dt, f.beatPeriod, 3);
					if (v < 0.02) continue;
					const wall = walls[w];
					hsv2rgb(frac(landHue[w] + hueShift), 0.7, v * gain * 0.8, rgb);
					stampGaussian(
						out,
						g.count,
						wall.offset + wall.count / 2,
						3.2,
						rgb[0],
						rgb[1],
						rgb[2],
						false,
						wall.offset,
						wall.offset + wall.count
					);
				}
			}
		};
	}
};
