import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { addSample } from '../color/palette.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { hash01 } from '../dsl/rng.ts';
import { ringsFor } from '../dsl/space.ts';
import { INTENSITY, param } from './helpers.ts';

/**
 * The wave simulation steps at a fixed rate whatever the frame rate, because the update
 * rule's propagation speed is per STEP: integrating it per frame would make the waves
 * travel faster on a faster display, and two instances fed the same frames would still
 * agree only if their dt sequences did.
 */
const SUBSTEP = 1 / 120;
/** More than this many queued substeps is a stall, not a simulation debt worth paying. */
const MAX_STEPS = 8;

/**
 * A ripple tank the size of the room: the kit drops stones and real waves carry the hit
 * away around the perimeter. Kicks land at the corners, snares at the wall centres, hats
 * sprinkle small fast drops - light that travels as a CONSEQUENCE of a hit rather than a
 * drawing of one, which is what a damped wave equation buys over any envelope.
 */
export const rippleTank: EffectDef = {
	id: 'rippleTank',
	name: 'Ripple Tank',
	role: 'transient',
	blurb: 'Kicks drop stones at the corners; real waves carry each hit around the ring.',
	taste: {
		energy: 3,
		sections: ['groove', 'breakdown', 'build', 'drop'],
		minBars: 2,
		maxBars: 32,
		peakReserved: false,
		kit: 'any'
	},
	params: [
		INTENSITY,
		param('viscosity', 'Ripple decay', 0.35),
		param('spread', 'Wave speed', 0.5)
	],
	create(g) {
		const ring = ringsFor(g).perimeter;
		const n = ring.length;
		const cur = new Float32Array(n);
		const prev = new Float32Array(n);
		const next = new Float32Array(n);

		// The corners are where consecutive ring positions belong to different strips; a
		// 5 x 4 room has them off the quarter marks, so they are found rather than assumed.
		const corners: number[] = [];
		for (let i = 0; i < n; i++) {
			const here = g.strip[ring.map[i]];
			const before = g.strip[ring.map[(i - 1 + n) % n]];
			if (here !== before) corners.push(i);
		}
		if (corners.length === 0) corners.push(0);
		const centres = corners.map((c, k) => {
			const nextCorner = corners[(k + 1) % corners.length];
			const span = (nextCorner - c + n) % n || n;
			return (c + (span >> 1)) % n;
		});

		let debt = 0;
		let kickSeq = 0;
		let snareSeq = 0;
		let hatSeq = 0;

		const drop = (at: number, amp: number, width: number) => {
			for (let d = -width; d <= width; d++) {
				const i = (at + d + n) % n;
				const w = 1 - Math.abs(d) / (width + 1);
				cur[i] += amp * w * w;
			}
		};

		return {
			reset() {
				cur.fill(0);
				prev.fill(0);
				next.fill(0);
				debt = 0;
				kickSeq = 0;
				snareSeq = 0;
				hatSeq = 0;
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;

				// Impulse height goes with the square of the envelope (LedFx's water measure:
				// linear reads flat, squared reads like weight), and each voice owns a home.
				if (f.kick) {
					drop(corners[kickSeq++ % corners.length], 0.9 * f.kickEnv * f.kickEnv + 0.15, 3);
				}
				if (f.snare) {
					drop(centres[snareSeq++ % centres.length], 0.55 * f.snareEnv * f.snareEnv + 0.1, 2);
				}
				if (f.hat) {
					drop(Math.floor(hash01(hatSeq++) * n), 0.18 * f.hatEnv + 0.05, 1);
				}

				// The wave equation, at fixed substeps. `spread` widens the stencil's reach per
				// step by mixing the neighbour average harder; damping is applied per step so
				// viscosity means the same thing at every frame rate. Motion scales TIME here -
				// a legal use, because the sim is not a clock: pausing it holds the water still.
				debt += f.dt * Math.max(0.05, motion);
				let steps = 0;
				while (debt >= SUBSTEP && steps < MAX_STEPS) {
					debt -= SUBSTEP;
					steps++;
					const c = 0.35 + p.spread * 0.6;
					const damp = 1 - (0.002 + p.viscosity * 0.02);
					for (let i = 0; i < n; i++) {
						const left = cur[(i - 1 + n) % n];
						const right = cur[(i + 1) % n];
						next[i] = (c * (left + right) + 2 * (1 - c) * cur[i] - prev[i]) * damp;
					}
					prev.set(cur);
					cur.set(next);
				}
				if (debt > SUBSTEP * MAX_STEPS) debt = 0;

				const gain = 0.55 + p.intensity * 1.3;
				out.fill(0);
				for (let r = 0; r < n; r++) {
					const h = cur[r];
					const a = Math.abs(h);
					if (a < 0.01) continue;
					// Crests heat toward white, troughs sink toward deep: the water has a
					// lit side and a shadowed side in one hue family.
					const slot =
						h > 0
							? lerp(SLOT.base, SLOT.white, clamp(h * 0.7))
							: lerp(SLOT.base, SLOT.deep, clamp(a * 0.9));
					addSample(out, ring.map[r], palette, slot + hueShift, clamp(a * gain));
				}
			}
		};
	}
};
