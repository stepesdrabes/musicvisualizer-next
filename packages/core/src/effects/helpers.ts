import type { ParamSpec } from '../contracts/effect.ts';

export function param(
	key: string,
	label: string,
	def: number,
	min = 0,
	max = 1,
	step = 0.01
): ParamSpec {
	return { key, label, min, max, step, default: def };
}

export const INTENSITY = param('intensity', 'Intensity', 0.7);

/** Release time expressed in beats, so an effect retimes itself with the tempo. */
export function beatRelease(beatPeriod: number, beats = 0.6): number {
	return Math.max(beatPeriod * beats, 0.02);
}

/** Rising-edge detector for the player-driven `trigger` param. */
export class Edge {
	private prev = false;

	update(v: boolean): boolean {
		const fired = v && !this.prev;
		this.prev = v;
		return fired;
	}

	reset(): void {
		this.prev = false;
	}
}
