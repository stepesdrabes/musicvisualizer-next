import type { AmbientSettings, ColourSource } from '@mv/core';

/** Mirrors @mv/analysis TrackMeta. Duplicated because SvelteKit blocks server imports on
    the client, even for types. */
export interface TrackMeta {
	id: string;
	title: string;
	uploader: string;
	thumbnail: string;
	/** Dominant hue of the cover, degrees, or null when it has none worth taking. */
	artHue?: number | null;
	webpageUrl: string;
	source: string;
	/** Seconds. Absent on tracks analysed before the field existed. */
	duration?: number;
}

/**
 * Which author a track already has, if any.
 *
 * One definition rather than one per consumer: the queue row, the search candidate and the
 * library entry all carry it, and when DeepSeek was added only two of the three learned about
 * it. The backends are named individually for the reason `Show.authoredBy` gives.
 */
export type Authored = 'none' | 'engine' | 'claude' | 'deepseek';

/** Mirrors @mv/analysis LibraryEntry. The family is one of GenreFamily, or null until enriched. */
export interface LibraryEntry extends TrackMeta {
	analysed: boolean;
	authored: Authored;
	genreFamily: string | null;
	updatedAt: number;
}

/** Mirrors @mv/analysis Song, plus the watch URL the search route attaches. */
export interface SearchResult {
	id: string;
	/** The track alone. YouTube Music keeps the artist out of it, unlike an upload title. */
	title: string;
	artist: string;
	album: string | null;
	/** Seconds. */
	duration: number;
	thumbnail: string;
	webpageUrl: string;
}

export type Phase =
	| 'idle'
	| 'resolving'
	| 'downloading'
	| 'analysing'
	| 'authoring'
	| 'ready'
	| 'error';

export interface LoadState {
	phase: Phase;
	message: string;
	/** 0..1 when known, otherwise null for an indeterminate bar. */
	progress: number | null;
}

/** Mirrors @mv/author-ai BackendId. */
export type AuthorBackend = 'claude' | 'deepseek';

/** Mirrors PublicSettings from the server. The key itself never crosses this boundary. */
export interface Settings {
	hasDeepseekKey: boolean;
	authorBackend: AuthorBackend;
	/** How far ahead of the audio the strips run, milliseconds. Positive is early. */
	outputOffsetMs: number;
	/** Whether the radio keeps the queue from running out. */
	autopilot: boolean;
	/** Calm scenes instead of the authored show, while a track is playing. */
	lounge: boolean;
	/** Whether the room drifts into ambient when nothing is playing, rather than freezing. */
	rest: boolean;
	/**
	 * How the resting room looks. `AmbientSettings` is a `core` type rather than a mirror: it is
	 * the shape the renderer is driven with, and the browser runs its own copy of the renderer.
	 */
	ambient: AmbientSettings;
}

/**
 * What `PUT /api/settings` accepts, which is flat where `Settings` is nested.
 *
 * Mirrors the route's own whitelist by hand, like everything else across this boundary. It is flat
 * because a patch names the fields it is changing, and a nested object would mean sending the whole
 * ambient block to move one slider.
 */
export interface SettingsPatch {
	deepseekApiKey?: string;
	authorBackend?: AuthorBackend;
	outputOffsetMs?: number;
	autopilot?: boolean;
	lounge?: boolean;
	rest?: boolean;
	ambientColour?: ColourSource;
	ambientHue?: number;
	ambientSat?: number;
	ambientBrightness?: number;
	ambientDrift?: number;
	ambientDwell?: number;
}

/** One line in the authoring activity feed. */
export interface Step {
	id: string;
	kind: 'phase' | 'tool' | 'think' | 'note';
	label: string;
	detail?: string;
	result?: string;
	state: 'pending' | 'done' | 'failed';
}

/** Mirrors @mv/author AuthorEvent. Duplicated so the client does not import the server. */
export type AuthorEvent =
	| { type: 'phase'; phase: string; label: string }
	| { type: 'thinking'; text: string }
	| { type: 'tool'; id: string; name: string; detail: string }
	| { type: 'result'; id: string; name: string; summary: string; ok: boolean }
	| { type: 'brief'; brief: string }
	| { type: 'analysis'; analysis: unknown; reason: string }
	| { type: 'note'; text: string };
