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
