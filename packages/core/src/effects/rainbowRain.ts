import type { EffectDef } from '../contracts/effect.ts';
import { sample } from '../color/palette.ts';
import { frac, paletteArc } from '../dsl/math.ts';
import { fadeToBlack } from '../dsl/buffer.ts';
import { PulseEnv } from '../dsl/env.ts';
import { stampOnStrip } from '../dsl/space.ts';
import { beatRelease, INTENSITY, param, WallDrops } from './helpers.ts';

/**
 * Successive droplets walk the palette in golden-angle steps, the trick sunflowers use:
 * maximum separation between neighbours, no repetition, fully deterministic.
 *
 * The wheel they walk is the show's, not the spectrum's, so the name is now about the shape
 * rather than the colour. A room lit in two hues reads as designed; one lit in twelve reads
 * as a screensaver, whatever the droplets are doing.
 */
export const rainbowRain: EffectDef = {
	id: 'rainbowRain',
	name: 'Rainbow Rain',
	role: 'rhythm',
	blurb: 'Falling droplets stepping the hue wheel by the golden angle - every drop unique.',
	taste: {
		energy: 3,
		sections: ['groove', 'breakdown', 'build', 'drop'],
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
		const rain = new WallDrops(g);
		const landGlow = rain.walls.map(() => new PulseEnv());
		const landHue = new Float32Array(rain.walls.length);
		const rgb: [number, number, number] = [0, 0, 0];

		return {
			reset() {
				rain.reset();
				for (const l of landGlow) l.reset();
				landHue.fill(0);
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;
				fadeToBlack(out, f.dt, beatRelease(f.beatPeriod, 0.3));

				const gain = 0.6 + p.intensity * 1.4;
				const spawned = rain.spawn(f, p.perBeat);
				if (spawned) spawned.tint = frac(spawned.seq * 0.381966);

				rain.fall(
					f,
					p.fallBeats,
					(drop, u, pos, wall) => {
						sample(palette, paletteArc(drop.tint + hueShift), gain * (0.5 + 0.5 * u), rgb);
						stampOnStrip(out, g.count, wall, pos, 1.1, rgb);
					},
					(drop) => {
						landGlow[drop.wall].fire(0.85);
						landHue[drop.wall] = drop.tint;
					}
				);

				for (let w = 0; w < rain.walls.length; w++) {
					const v = landGlow[w].decay(f.dt, f.beatPeriod, 3);
					if (v < 0.02) continue;
					const wall = rain.walls[w];
					sample(palette, paletteArc(landHue[w] + hueShift), v * gain * 0.8, rgb);
					stampOnStrip(out, g.count, wall, wall.count / 2, 3.2, rgb);
				}
			}
		};
	}
};
