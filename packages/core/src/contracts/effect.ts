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
	 *
	 * The quiet probe cannot decide this: it rewards bytes of movement, and a flash moves the
	 * most bytes of anything while being dark most of every bar. Any effect that is an event
	 * with darkness between - a slam, a burst, a strobe - declares `carries: false` however
	 * high its measured `quiet` comes out.
	 */
	carries?: boolean;
	/**
	 * True for a master that renders black until the player arms `trigger` from a hit.
	 *
	 * These are punctuation, not looks: placed in a cue's master layer with no hit behind
	 * them they are a no-op, so the planner's reserved-peak choice must never land on one.
	 */
	hitOnly?: boolean;
	/**
	 * What kind of gesture this is, declared only where a genre may need to refuse it.
	 *
	 * `flash` is light as interruption - strobes and shutters, dark between frames. `impact`
	 * is light as a blow - slams, blinders, bursts. The families whose flash allowance is
	 * zero forbid both as effects exactly as they forbid them as hits; everything else is
	 * ungoverned and leaves this absent.
	 */
	character?: 'flash' | 'impact';
	/**
	 * The drum stream this effect IS the answer to, declared only where that is the whole
	 * gesture: an effect that spawns on `f.kick` renders black in a passage with no kicks,
	 * and a grid pulse that reads as the kit keeps pounding through a sung verse the drums
	 * sat out. The picker refuses both where the slot's stream is silent - dead layers and
	 * lying ones are the same mistake from the room's side.
	 *
	 * `any` means kick or snare. Effects that merely season themselves with an envelope -
	 * a bed with a kick bump in it - leave this absent and degrade gracefully.
	 */
	kit?: 'kick' | 'snare' | 'hat' | 'any';
	/**
	 * How much this moves over a quiet passage, as a share of its own mean level.
	 *
	 * Bytes of delivered movement, measured by substituting the effect into the quiet cues of a
	 * cached corpus and rendering them. NOT a synthetic journey's `quiet` column: that spreads a
	 * wandering peak across every band where a real sparse intro has content in a handful and
	 * silence in the rest, and it reverses the ranking. Chosen by the synthetic number, `nebula`
	 * leads the beds and delivers 1.02 on real tracks; chosen by this one, `spectrumBed` leads
	 * and delivers 4.41. Only the beds and accents that can appear in a quiet section declare it;
	 * absent means it has never been asked to hold one.
	 *
	 * These are stored measurements from `bench/quietprobe.ts`, and nothing asserts them
	 * because measuring needs the audio cache and a test may not depend on it. Changing an
	 * effect in the quiet pool, the spectrum or the house floor invalidates whatever it
	 * declares here; re-run the probe and paste its numbers back.
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
