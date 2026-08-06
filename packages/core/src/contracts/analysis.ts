import type { SectionKind } from './frame.ts';

export const ANALYSIS_VERSION = 1;

export interface TempoGrid {
	bpm: number;
	confidence: number;
	/** Time of beat 0, seconds. */
	firstBeat: number;
	beatPeriod: number;
	beatsPerBar: number;
	/** Which beat index mod beatsPerBar is the downbeat. */
	downbeatPhase: number;
	phraseAnchorBar: number;
	barsPerPhrase: number;
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
	/** Index of an earlier section this one repeats, when detected. */
	repeatOf: number | null;
}

export interface Moment {
	bar: number;
	beat: number;
	t: number;
	kind: EventTag | 'section_start';
	note: string;
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
	bars: BarRow[];
	sections: SectionSpan[];
	moments: Moment[];
	/** Onset times in seconds. */
	onsets: {
		kick: number[];
		snare: number[];
		hat: number[];
	};
	integratedLufs: number;
}
