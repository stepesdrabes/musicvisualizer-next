import type { EffectDef } from '../contracts/effect.ts';
import type { Palette } from '../contracts/palette.ts';
import type { StripSpec } from '../contracts/room.ts';
import { Band } from '../contracts/frame.ts';
import { SLOT } from '../contracts/palette.ts';
import { addSample } from '../color/palette.ts';
import { clamp } from '../dsl/math.ts';
import { fadeToBlack } from '../dsl/buffer.ts';
import { INTENSITY, param } from './helpers.ts';

/** Additive gaussian confined to one strip, so a blob never bleeds onto a distant wall. */
function splat(
	out: Float32Array,
	wall: StripSpec,
	centre: number,
	sigma: number,
	palette: Palette,
	slot: number,
	amp: number
): void {
	const lo = wall.offset;
	const hi = wall.offset + wall.count;
	const reach = Math.ceil(sigma * 3);
	const inv = 1 / (2 * sigma * sigma);
	const c0 = Math.round(centre);
	for (let k = -reach; k <= reach; k++) {
		const i = c0 + k;
		if (i < lo || i >= hi) continue;
		const d = i - centre;
		const w = Math.exp(-d * d * inv);
		if (w < 0.01) continue;
		addSample(out, i, palette, slot, w * amp);
	}
}

export const splash: EffectDef = {
	id: 'splash',
	name: 'Splash',
	role: 'transient',
	blurb: 'Kicks splash the front and back walls, snares answer on the sides. Size codes velocity.',
	taste: {
		energy: 3,
		sections: ['groove', 'drop', 'breakdown', 'build'],
		minBars: 1,
		maxBars: 32,
		peakReserved: false
	},
	params: [INTENSITY, param('size', 'Size', 0.35, 0.1, 1), param('decay', 'Decay beats', 0.55, 0.1, 2)],
	create(g) {
		// Fixed patch: kicks own the depth axis and the base hue, snares the width axis and
		// the accent. Randomising this makes hits stop reading as the same instrument.
		const kickWalls = g.strips.filter((s) => s.inPerimeter && s.normal[1] !== 0);
		const snareWalls = g.strips.filter((s) => s.inPerimeter && s.normal[0] !== 0);
		let kickCount = 0;
		let snareCount = 0;

		return {
			reset() {
				kickCount = 0;
				snareCount = 0;
			},
			render(out, ctx) {
				const { f, p, palette } = ctx;
				fadeToBlack(out, f.dt, (p.decay * f.beatPeriod) / 3);

				const sigma = p.size * 28;

				if (f.kick && kickWalls.length > 0) {
					const wall = kickWalls[kickCount % kickWalls.length];
					// Golden-ratio walk: successive hits never repeat a position but the spread
					// stays even, which random placement does not guarantee.
					const u = (kickCount * 0.618034) % 1;
					kickCount++;
					const strength = clamp(0.5 + 0.5 * f.bands[Band.Sub]) * p.intensity;
					splat(
						out,
						wall,
						wall.offset + u * (wall.count - 1),
						sigma * (0.7 + 0.6 * strength),
						palette,
						SLOT.base + ctx.hueShift,
						strength
					);
				}

				if (f.snare && snareWalls.length > 0) {
					const wall = snareWalls[snareCount % snareWalls.length];
					const u = (snareCount * 0.618034 + 0.5) % 1;
					snareCount++;
					const strength = clamp(0.45 + 0.55 * f.snareEnv) * p.intensity;
					splat(
						out,
						wall,
						wall.offset + u * (wall.count - 1),
						sigma * 0.7,
						palette,
						SLOT.accent + ctx.hueShift,
						strength
					);
				}
			}
		};
	}
};
