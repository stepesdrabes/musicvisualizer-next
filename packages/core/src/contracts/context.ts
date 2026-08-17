/**
 * What the track IS, as far as free metadata can say: resolved identity, genre family,
 * published tempo, synced lyrics. Gathered once at ingest from keyless web APIs, cached
 * beside the analysis, and absent-tolerant throughout - every field can be null and the
 * pipeline still runs, so an offline ingest degrades to exactly what it was before this
 * existed.
 *
 * Lives in core because the author-engine reads it and core is the only package it may
 * import. The implementation that fills it lives in the analysis package, which is the
 * one place with network access.
 */

export const CONTEXT_VERSION = 3;

/**
 * The lighting vocabulary of genres, not the record shop's. Each family names a distinct
 * way a room is lit - a palette discipline, a flash budget, a blackout grammar - so two
 * genres that are lit the same way share a family however far apart the music sits.
 */
export type GenreFamily =
	| 'techno'
	| 'house'
	| 'edm'
	| 'trance'
	| 'bass'
	| 'pop'
	| 'rock'
	| 'metal'
	| 'punk'
	| 'hiphop'
	| 'rnb'
	| 'ballad'
	| 'ambient'
	| 'latin'
	| 'disco';

export interface LyricLine {
	/** Seconds from the start of the track. */
	t: number;
	text: string;
}

export interface TrackContext {
	version: number;
	/** Clean identity, or null when nothing could resolve one. */
	artist: string | null;
	title: string | null;
	/** Which step settled the identity: 'ytmeta', 'odesli', 'deezer', 'titleparse'. */
	resolvedBy: string | null;
	isrc: string | null;
	/**
	 * A published tempo, bpm, or null. A hypothesis rather than an answer: it settles a
	 * metrical-level coin toss, it never overrides a grid that already agrees with it.
	 */
	publishedBpm: number | null;
	/** Raw genre strings as the sources gave them, for the inspector and for re-mapping. */
	/**
	 * Genre names from METADATA sources only (Discogs, Deezer, YouTube). The audio
	 * classifier's labels live in `audioGenres`, never here: mixing them let a context
	 * re-vote read the model's own echo back as evidence, so the vote could never change
	 * its mind (Get Lucky wore "ballad" for a week on its own reflection).
	 */
	genres: string[];
	/** The audio classifier's own top labels, kept apart from the metadata's - see `genres`. */
	audioGenres: string[];
	genreFamily: GenreFamily | null;
	/** 0..1, share of the genre evidence that voted for the winning family. */
	genreConfidence: number;
	/** Line-synced lyrics, ascending by time, or null when none were found. */
	lyrics: LyricLine[] | null;
	/** True when a lyrics source positively says the track has no words. */
	instrumental: boolean | null;
	/** ISO timestamp of the lookup run. An empty `sources` plus an old date invites a retry. */
	fetchedAt: string;
	/** Which services answered at all, e.g. ['ytmeta', 'deezer', 'lrclib']. */
	sources: string[];
}

/** A context that says nothing, for offline ingest and failed lookups. */
export function emptyContext(): TrackContext {
	return {
		version: CONTEXT_VERSION,
		artist: null,
		title: null,
		resolvedBy: null,
		isrc: null,
		publishedBpm: null,
		genres: [],
		audioGenres: [],
		genreFamily: null,
		genreConfidence: 0,
		lyrics: null,
		instrumental: null,
		fetchedAt: new Date(0).toISOString(),
		sources: []
	};
}
