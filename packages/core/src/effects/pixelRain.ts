import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { sample } from '../color/palette.ts';
import { fadeToBlack } from '../dsl/buffer.ts';
import { PulseEnv } from '../dsl/env.ts';
import { stampOnStrip } from '../dsl/space.ts';
import { beatRelease, INTENSITY, param, WallDrops } from './helpers.ts';

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
		const rain = new WallDrops(g);
		const landGlow = rain.walls.map(() => new PulseEnv());

		return {
			reset() {
				rain.reset();
				for (const l of landGlow) l.reset();
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;
				fadeToBlack(out, f.dt, beatRelease(f.beatPeriod, 0.3));

				const gain = 0.6 + p.intensity * 1.4;
				const spawned = rain.spawn(f, p.perBeat);
				if (spawned) {
					// Mostly the home hue with designed interruptions, rotating per bar.
					const pick = ((f.barIndex % 4) + 4) % 4;
					spawned.tint = pick === 3 ? SLOT.accent : pick === 2 ? SLOT.third : SLOT.base;
				}

				rain.fall(
					f,
					p.fallBeats,
					(drop, u, pos, wall) => {
						const c = sample(palette, drop.tint + hueShift, gain * (0.5 + 0.5 * u));
						stampOnStrip(out, g.count, wall, pos, 1.1, c);
					},
					(drop) => landGlow[drop.wall].fire(0.8)
				);

				for (let w = 0; w < rain.walls.length; w++) {
					const v = landGlow[w].decay(f.dt, f.beatPeriod, 3);
					if (v < 0.02) continue;
					const wall = rain.walls[w];
					const c = sample(palette, SLOT.glow + hueShift, v * gain * 0.8);
					stampOnStrip(out, g.count, wall, wall.count / 2, 3.2, c);
				}
			}
		};
	}
};
