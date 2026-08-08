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
	/**
	 * False when this cannot hold a room on its own.
	 *
	 * A bed is the floor of a cue, and most beds are written to sit under something: some are
	 * spatially sparse, some scale themselves by the very energy the cue's intensity is already
	 * scaling. Either way they emit almost nothing in a quiet passage, and gamma 2.2 sends
	 * anything under 0.08 to byte zero, so a cue whose only substantial layer is one of these
	 * comes out black rather than dim. Absent means it carries.
	 */
	carries?: boolean;
	/**
	 * How much this moves over a quiet passage, as a share of its own mean level.
	 *
	 * Bytes of delivered movement, from `bench/quietprobe.ts`, which substitutes the effect into
	 * the quiet cues of the cached corpus and renders them. NOT from `effectprobe`'s synthetic
	 * `quiet` column: that journey spreads a wandering peak across every band where a real sparse
	 * intro has content in a handful and silence in the rest, and it reverses the ranking. Chosen
	 * by the synthetic number, `nebula` leads the beds and delivers 1.02 on real tracks; chosen by
	 * this one, `spectrumBed` leads and delivers 4.41. Only the beds and accents that can appear
	 * in a quiet section declare it; absent means it has never been asked to hold one.
	 *
	 * Nothing asserts these, because the probe needs the audio cache and a test may not. Regenerate
	 * with `node bench/quietprobe.ts` after any change to an effect in the quiet pool, to the
	 * spectrum, or to the house floor - all three move the numbers.
	 *
	 * The planner prefers a high one where there is nothing else happening. Measured on a real
	 * intro, the pair the picker chose delivered 1.27 bytes of movement where the two most
	 * spectrum-led candidates in the same pool delivered 2.24 across 2.7x the spatial spread. The
	 * catalog already had the answer; nothing was choosing it.
	 */
	quiet?: number;
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
