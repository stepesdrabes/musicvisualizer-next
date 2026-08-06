import type { SectionKind } from './frame.ts';

export const ANALYSIS_VERSION = 4;

export interface TempoGrid {
	/** Median over the track. For display and for a default time constant, never for timing. */
	bpm: number;
	/** 0..1. How much of the track's onset energy the grid actually lands on. */
	confidence: number;
	/** Time of beat 0, seconds. */
	firstBeat: number;
	/** Median beat period. See `bpm`: this describes the track, it does not locate anything. */
	beatPeriod: number;
	beatsPerBar: number;
	/** Which beat index mod beatsPerBar is the downbeat. */
	downbeatPhase: number;
	phraseAnchorBar: number;
	barsPerPhrase: number;
	/**
	 * False when the track's tempo moves enough that one period cannot describe it.
	 *
	 * It is a description of the music, not a switch: `barTimes` is the authority either way,
	 * so nothing downstream has to branch on this and nothing downstream may.
	 */
	constant: boolean;
	/** 0..1, separately from `confidence`: the beat grid can be certain and the meter not. */
	meterConfidence: number;
	/**
	 * Start time of every bar, seconds, plus the end of the last one: length is barCount + 1.
	 *
	 * This is the only thing that says where a bar is. The scalars above reconstruct it exactly
	 * only when the tempo never moves, and a track whose tempo moves by a per cent or two
	 * accumulates whole beats of error over four minutes, which is why they are not used for it.
	 * `bars[].t` is written from this array rather than alongside it, so the two cannot drift
	 * apart.
	 */
	barTimes: number[];
}

export interface KeyEstimate {
	/** Pitch class of the tonic, 0 = C. */
	tonic: number;
	/** Human-readable, e.g. "F# minor". */
	name: string;
	mode: 'major' | 'minor';
	/** 0..1. Below about 0.6 the reading is a guess. */
	confidence: number;
}

export type EventTag =
	| 'drop_downbeat'
	| 'crash'
	| 'riser'
	| 'snare_roll'
	| 'silence'
	| 'kick_in'
	| 'kick_out'
	| 'bass_in'
	| 'bass_out'
	| 'filter_sweep';

/** One row per bar. This is the granularity every cue is authored at. */
export interface BarRow {
	bar: number;
	t: number;
	section: SectionKind;
	/** 0..100, normalised across the whole track so relative judgement is trivial. */
	energy: number;
	sub: number;
	low: number;
	mid: number;
	air: number;
	kicks: number;
	snares: number;
	hats: number;
	events: EventTag[];
}

export interface SectionSpan {
	index: number;
	kind: SectionKind;
	startBar: number;
	endBar: number;
	startTime: number;
	endTime: number;
	lengthBars: number;
	meanEnergy: number;
	peakEnergy: number;
	/** 1 = the biggest section in the track. Makes "which moment is the peak" a fact. */
	energyRank: number;
	/**
	 * Which material this is. Sections sharing an id are the same passage of the song, so a
	 * show can light every chorus alike without being told which ones those are. Negative when
	 * the section was carved out rather than detected, such as a void.
	 */
	group: number;
	/** Index of the first section carrying this group, or null when this is that one. */
	repeatOf: number | null;
}

export interface Moment {
	bar: number;
	beat: number;
	t: number;
	kind: EventTag | 'section_start';
	note: string;
}

/**
 * Where the sound sits across the room, over time. Sampled rather than per-bar because the
 * gesture worth reacting to - a vocal thrown hard left and right - moves on every sixteenth.
 */
export interface StereoImage {
	fps: number;
	/** -1 hard left, +1 hard right. */
	pan: number[];
	/** 0 when the channels are identical, 1 when they share nothing. */
	width: number[];
}

export interface TrackAnalysis {
	version: number;
	/** Of the decoded audio. A show pinned to a stale hash is rejected. */
	hash: string;
	trackId: string;
	title: string;
	duration: number;
	sampleRate: number;
	tempo: TempoGrid;
	key: KeyEstimate;
	bars: BarRow[];
	sections: SectionSpan[];
	moments: Moment[];
	/** Every tracked beat, seconds. Exact even where the constant grid is only a fit. */
	beats: number[];
	stereo: StereoImage;
	/** Onset times in seconds. */
	onsets: {
		kick: number[];
		snare: number[];
		hat: number[];
	};
	integratedLufs: number;
	/** EBU R128 loudness range, LU. */
	loudnessRange: number;
	/**
	 * Peak minus integrated loudness, LU. Under about 8 the master is heavily limited, so
	 * per-bar level barely moves and a show has to take its dynamics from somewhere else.
	 */
	peakToLoudness: number;
}
