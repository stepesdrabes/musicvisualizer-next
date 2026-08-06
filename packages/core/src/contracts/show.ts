import type { SectionKind } from './frame.ts';
import type { LayerRole, ParamSpec, Params } from './effect.ts';
import type { ShowPalette } from './palette.ts';

export const SHOW_VERSION = 1;

export interface LayerSpec {
	effect: string;
	opacity?: number;
	params?: Params;
}

/** 'swap' exchanges base and accent: the classic one-colour-event drop move. */
export type CuePalette = ShowPalette | 'swap' | 'inherit';

/**
 * Cues are addressed by bar, never by time. A model asked for wall-clock times reliably
 * answers "the drop is at 1:00"; a bar index either exists in the analysed grid or the
 * linter rejects it.
 */
export interface Cue {
	bar: number;
	section: SectionKind;
	layers: Partial<Record<LayerRole, LayerSpec>>;
	palette?: CuePalette;
	intensity?: number;
	motion?: number;
	/** Fade completes ON this cue's downbeat. 0 snaps, which is what voids and drops want. */
	fadeBeats?: number;
	note: string;
}

export interface Hit {
	bar: number;
	/** Beat within the bar, 0-indexed. Defaults to 0. */
	beat?: number;
	kind: 'slam' | 'strobe' | 'blackout';
	beats: number;
	/** Overrides on the hit's effect, e.g. strobe `perBeat`. The linter reads these. */
	params?: Params;
	note?: string;
}

/** Song-specific effect authored for this track, admitted only after passing the gate. */
export interface GeneratedEffect {
	id: string;
	name: string;
	role: LayerRole;
	blurb: string;
	params: ParamSpec[];
	/** ES module source exporting `create(g)`. Runs sandboxed. */
	source: string;
}

export interface Show {
	version: number;
	trackId: string;
	title: string;
	/** Must match TrackAnalysis.hash. */
	analysisHash: string;
	/** The design rationale, in prose. Read by humans, not the engine. */
	brief: string;
	palette: ShowPalette;
	defaults: {
		intensity: number;
		motion: number;
		fadeBeats: number;
	};
	generatedEffects: GeneratedEffect[];
	cues: Cue[];
	hits: Hit[];
}
