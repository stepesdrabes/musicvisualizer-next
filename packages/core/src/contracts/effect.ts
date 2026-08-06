import type { Geometry } from './room.ts';
import type { SectionKind, ShowFrame } from './frame.ts';
import type { Palette } from './palette.ts';

export type LayerRole = 'bed' | 'rhythm' | 'transient' | 'accent' | 'master';

export const LAYER_ROLES: readonly LayerRole[] = [
	'bed',
	'rhythm',
	'transient',
	'accent',
	'master'
];

export type BlendMode = 'over' | 'add' | 'screen' | 'max' | 'multiply';

export interface ParamSpec {
	key: string;
	label: string;
	min: number;
	max: number;
	step: number;
	default: number;
}

export type Params = Record<string, number>;

export interface RenderCtx {
	g: Geometry;
	f: ShowFrame;
	/** This layer's parameter values. */
	p: Params;
	/** Already cross-faded by the player. */
	palette: Palette;
	hueShift: number;
	/** Cue-level speed scale. Effects multiply their own speeds by this. */
	motion: number;
}

/**
 * `out` is the effect's own scratch buffer, persistent across frames and never cleared
 * by the mixer, which is what lets trails and decay work. Stateless spatial effects must
 * therefore write every pixel every frame.
 *
 * Never allocate in `render`. Read only from `ctx`: no Date.now, no Math.random, so
 * recordings and exports reproduce exactly.
 */
export interface Effect {
	reset(): void;
	render(out: Float32Array, ctx: RenderCtx): void;
}

/** Metadata that makes restraint structural rather than something the author must remember. */
export interface EffectTaste {
	/** 1 = ambient, 5 = peak-of-the-track. */
	energy: 1 | 2 | 3 | 4 | 5;
	sections: readonly SectionKind[];
	minBars: number;
	maxBars: number;
	/** Usable at most once per show. */
	peakReserved: boolean;
}

export interface EffectDef {
	readonly id: string;
	readonly name: string;
	readonly role: LayerRole;
	readonly blurb: string;
	readonly taste: EffectTaste;
	readonly params: readonly ParamSpec[];
	create(g: Geometry): Effect;
}
