import type { EffectDef } from '../contracts/effect.ts';
import type { StripSpec } from '../contracts/room.ts';
import type { Palette } from '../contracts/palette.ts';
import { sample } from '../color/palette.ts';
import { frac, paletteArc } from '../dsl/math.ts';
import { fadeToBlack } from '../dsl/buffer.ts';
import { PulseEnv } from '../dsl/env.ts';
import { spectralTilt } from '../dsl/spectrum.ts';
import { stampOnStrip } from '../dsl/space.ts';
import { beatRelease, INTENSITY, param, WallDrops, type WallDrop } from './helpers.ts';

/** How much of the base-to-accent arc the golden-angle walk is allowed to cover at once. */
const WINDOW = 0.26;

/**
 * Successive droplets walk the palette in golden-angle steps, the trick sunflowers use:
 * maximum separation between neighbours, no repetition, fully deterministic.
 *
 * The wheel they walk is the show's, not the spectrum's, so the name is now about the shape
 * rather than the colour. A room lit in two hues reads as designed; one lit in twelve reads
 * as a screensaver, whatever the droplets are doing.
 *
 * The walk is a window on the arc rather than the whole of it, and the arrangement's own
 * brightness places the window: a bass-heavy passage rains near the home hue and an opening
 * one climbs toward the accent, while neighbouring droplets still separate as far as the
 * window allows.
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

		// The frame's context, held so the fall callbacks can be built once. `fall` takes them
		// every frame, and a fresh closure per frame is an allocation per frame.
		let dst: Float32Array = new Float32Array(0);
		let palette: Palette = new Float32Array(0);
		let hueShift = 0;
		let gain = 1;

		const onFall = (drop: WallDrop, u: number, pos: number, wall: StripSpec): void => {
			sample(palette, paletteArc(drop.tint + hueShift), gain * (0.5 + 0.5 * u), rgb);
			stampOnStrip(dst, g.count, wall, pos, 1.1, rgb);
		};
		const onLand = (drop: WallDrop): void => {
			landGlow[drop.wall].fire(0.85);
			landHue[drop.wall] = drop.tint;
		};

		return {
			reset() {
				rain.reset();
				for (const l of landGlow) l.reset();
				landHue.fill(0);
			},
			render(out, ctx) {
				const { f, p } = ctx;
				dst = out;
				palette = ctx.palette;
				hueShift = ctx.hueShift;
				fadeToBlack(out, f.dt, beatRelease(f.beatPeriod, 0.3));

				gain = 0.6 + p.intensity * 1.4;
				const spawned = rain.spawn(f, p.perBeat);
				if (spawned) {
					// Half the arc coordinate is the whole base-to-accent run; the rest of the
					// range is the same run mirrored, which would put the window on both ends.
					const centre = spectralTilt(f) * 0.5;
					spawned.tint = centre + (frac(spawned.seq * 0.381966) - 0.5) * WINDOW;
				}

				rain.fall(f, p.fallBeats / Math.max(0.2, ctx.motion), onFall, onLand);

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
