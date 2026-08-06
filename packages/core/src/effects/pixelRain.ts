import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { sample } from '../color/palette.ts';
import { fadeToBlack, stampGaussian } from '../dsl/buffer.ts';
import { PulseEnv } from '../dsl/env.ts';
import { beatRelease, INTENSITY, param } from './helpers.ts';

const MAX_DROPS = 24;

interface Drop {
	alive: boolean;
	wall: number;
	fromEnd: number;
	t0: number;
	slot: number;
}

/**
 * Droplets spawn at the room's corners on the grid and slide toward their wall's centre,
 * accelerating like a falling object and landing in a small pooled glow.
 */
export const pixelRain: EffectDef = {
	id: 'pixelRain',
	name: 'Pixel Rain',
	role: 'rhythm',
	blurb: 'Droplets from the corners sliding to each wall centre on the 8th-note grid.',
	taste: {
		energy: 3,
		sections: ['groove', 'breakdown', 'drop', 'intro'],
		minBars: 2,
		maxBars: 32,
		peakReserved: false
	},
	params: [
		INTENSITY,
		param('perBeat', 'Drops per beat', 2, 0.5, 4, 0.5),
		param('fallBeats', 'Beats to land', 4, 1, 8, 0.5)
	],
	create(g) {
		const walls = g.strips.filter((s) => s.inPerimeter);
		const drops: Drop[] = [];
		for (let i = 0; i < MAX_DROPS; i++) {
			drops.push({ alive: false, wall: 0, fromEnd: 0, t0: 0, slot: SLOT.base });
		}
		const landGlow = walls.map(() => new PulseEnv());
		let next = 0;
		let lastStep = -1;
		let spawnCount = 0;

		return {
			reset() {
				for (const d of drops) d.alive = false;
				for (const l of landGlow) l.reset();
				next = 0;
				lastStep = -1;
				spawnCount = 0;
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;
				fadeToBlack(out, f.dt, beatRelease(f.beatPeriod, 0.3));
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
					// Mostly the home hue with designed interruptions, rotating per bar.
					const pick = ((f.barIndex % 4) + 4) % 4;
					d.slot = pick === 3 ? SLOT.accent : pick === 2 ? SLOT.third : SLOT.base;
				}

				const fallTime = Math.max(0.3, p.fallBeats * f.beatPeriod);
				const gain = 0.6 + p.intensity * 1.4;

				for (const d of drops) {
					if (!d.alive) continue;
					const u = (f.t - d.t0) / fallTime;
					if (u >= 1) {
						d.alive = false;
						landGlow[d.wall].fire(0.8);
						continue;
					}
					const wall = walls[d.wall];
					const half = wall.count / 2;
					// u^1.8 reads as gravity with drag; a linear slide reads as an animation.
					const dist = Math.pow(u, 1.8) * half;
					const pos = d.fromEnd === 0 ? dist : wall.count - 1 - dist;
					const c = sample(palette, d.slot + hueShift, gain * (0.5 + 0.5 * u));
					stampGaussian(
						out,
						g.count,
						wall.offset + pos,
						1.1,
						c[0],
						c[1],
						c[2],
						false,
						wall.offset,
						wall.offset + wall.count
					);
				}

				for (let w = 0; w < walls.length; w++) {
					const v = landGlow[w].decay(f.dt, f.beatPeriod, 3);
					if (v < 0.02) continue;
					const wall = walls[w];
					const c = sample(palette, SLOT.glow + hueShift, v * gain * 0.8);
					stampGaussian(
						out,
						g.count,
						wall.offset + wall.count / 2,
						3.2,
						c[0],
						c[1],
						c[2],
						false,
						wall.offset,
						wall.offset + wall.count
					);
				}
			}
		};
	}
};
