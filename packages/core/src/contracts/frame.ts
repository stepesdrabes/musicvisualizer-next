/**
 * `void` is a section rather than a modifier: the bar of near-silence before a drop is
 * the strongest move in the vocabulary, and naming it lets the linter require that the
 * blackout there is deliberate and bounded.
 */
export type SectionKind =
	| 'intro'
	| 'groove'
	| 'breakdown'
	| 'build'
	| 'void'
	| 'drop'
	| 'outro';

export const SECTION_KINDS: readonly SectionKind[] = [
	'intro',
	'groove',
	'breakdown',
	'build',
	'void',
	'drop',
	'outro'
];

/** Sub: chest thump. Low: kick body and bass. Mid: vocals and leads. Air: hats and risers. */
export const Band = { Sub: 0, Low: 1, Mid: 2, Air: 3 } as const;
export type Band = (typeof Band)[keyof typeof Band];

export const NUM_BANDS = 4;
export const BAND_EDGES_HZ = [20, 100, 400, 2600, 16000] as const;
export const BAND_NAMES = ['sub', 'low', 'mid', 'air'] as const;

/** Mutated in place by the player. Never retain a reference across frames. */
export interface ShowFrame {
	t: number;
	/** Always use this; never assume 1/60. */
	dt: number;

	/** Edge-detected by index change, so they never double-fire. */
	beat: boolean;
	downbeat: boolean;
	phraseStart: boolean;

	beatIndex: number;
	/** The number every cue is addressed by. */
	barIndex: number;

	beatPhase: number;
	barPhase: number;
	phrasePhase: number;

	/** Effects derive time constants from this, never from bpm. */
	beatPeriod: number;
	bpm: number;

	section: SectionKind;
	sectionProgress: number;
	/** 0 outside builds; reaches exactly 1.0 on the drop downbeat. */
	buildProgress: number;
	/** Infinity when there is no next/previous drop. */
	timeToDrop: number;
	timeSinceDrop: number;

	/** Normalised across the whole track, so a breakdown reads dark. */
	energy: number;
	/** Length NUM_BANDS. Index with `Band`. */
	bands: Float32Array;

	kick: boolean;
	snare: boolean;
	hat: boolean;

	/**
	 * Instant attack, brief hold, fast release. Drive brightness from these, not the
	 * booleans: a one-frame flash sits below the eye's integration window, so it reads
	 * as a dim blip whose brightness depends on where the frame boundary fell.
	 */
	kickEnv: number;
	snareEnv: number;
	hatEnv: number;
}

export function createShowFrame(): ShowFrame {
	return {
		t: 0,
		dt: 0,
		beat: false,
		downbeat: false,
		phraseStart: false,
		beatIndex: 0,
		barIndex: 0,
		beatPhase: 0,
		barPhase: 0,
		phrasePhase: 0,
		beatPeriod: 0.5,
		bpm: 120,
		section: 'intro',
		sectionProgress: 0,
		buildProgress: 0,
		timeToDrop: Infinity,
		timeSinceDrop: Infinity,
		energy: 0,
		bands: new Float32Array(NUM_BANDS),
		kick: false,
		snare: false,
		hat: false,
		kickEnv: 0,
		snareEnv: 0,
		hatEnv: 0
	};
}
