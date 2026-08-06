import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { addSample } from '../color/palette.ts';
import { hash01 } from '../dsl/rng.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { fadeToBlack } from '../dsl/buffer.ts';
import { sinewave } from '../dsl/wave.ts';
import { INTENSITY, param } from './helpers.ts';

const MAX_BURSTS = 8;

interface Pyro {
	alive: boolean;
	t0: number;
	corner: number;
}

/**
 * Columns of fire-textured light at the room's corners on the biggest hits only. The
 * flicker is a fixed per-pixel hash being scanned, never re-rolled, and the colour climbs
 * the palette's heat ladder toward white at the tip.
 */
export const pyroBursts: EffectDef = {
	id: 'pyroBursts',
	name: 'Pyro Bursts',
	role: 'transient',
	blurb: 'Flame columns erupting at the corners on chorus slams and drop phrases.',
	taste: {
		energy: 5,
		sections: ['groove', 'breakdown', 'build', 'drop'],
		minBars: 1,
		maxBars: 16,
		peakReserved: false
	},
	params: [INTENSITY, param('lifeBeats', 'Burst life beats', 4, 1, 8, 0.5)],
	create(g) {
		const walls = g.strips.filter((s) => s.inPerimeter);
		const bursts: Pyro[] = [];
		for (let i = 0; i < MAX_BURSTS; i++) bursts.push({ alive: false, t0: 0, corner: 0 });
		const flickPhase = new Float32Array(g.count);
		const flickRate = new Float32Array(g.count);
		for (let i = 0; i < g.count; i++) {
			flickPhase[i] = hash01(i) * 6.28;
			flickRate[i] = 0.7 + hash01(i * 3);
		}
		let next = 0;
		let armedFor = Number.NaN;

		return {
			reset() {
				for (const b of bursts) b.alive = false;
				next = 0;
				armedFor = Number.NaN;
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;
				fadeToBlack(out, f.dt, 0.08);
				if (walls.length === 0) return;

				const bigMoment =
					f.section === 'drop' && f.downbeat && (f.timeSinceDrop < 0.3 || f.phraseStart);
				const slam = f.kickEnv > 0.85 && f.snareEnv > 0.65;
				if ((bigMoment || slam) && armedFor !== f.barIndex) {
					armedFor = f.barIndex;
					for (let c = 0; c < 4; c++) {
						const b = bursts[next];
						next = (next + 1) % MAX_BURSTS;
						b.alive = true;
						b.t0 = f.t;
						b.corner = c;
					}
				}

				const life = Math.max(0.3, p.lifeBeats * f.beatPeriod);
				const gain = 0.55 + p.intensity * 1.3;
				const flick = f.t * 26;

				for (const b of bursts) {
					if (!b.alive) continue;
					const u = (f.t - b.t0) / life;
					if (u >= 1) {
						b.alive = false;
						continue;
					}
					// The column shoots up fast then dies; brightness follows the height.
					const height = Math.min(1, u * 4) * (1 - u * u);
					const wall = walls[b.corner % walls.length];
					const fromEnd = b.corner % 2;
					const span = Math.min(wall.count, Math.floor(wall.count * 0.22 * height) + 2);
					for (let k = 0; k < span; k++) {
						const i = wall.offset + (fromEnd === 0 ? k : wall.count - 1 - k);
						const fl = 0.7 + 0.3 * sinewave(flickPhase[i] + flick * flickRate[i]);
						const heat = clamp((1 - k / Math.max(1, span)) * (1.1 - u)) * fl;
						const slot = heat > 0.85 ? SLOT.white : lerp(SLOT.deep, SLOT.glow, heat);
						addSample(out, i, palette, slot + hueShift, heat * height * gain);
					}
				}
			}
		};
	}
};
