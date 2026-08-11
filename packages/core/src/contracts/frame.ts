/**
 * `void` is a section rather than a modifier: the bar of near-silence before a drop is
 * the strongest move in the vocabulary, and naming it lets the linter require that the
 * blackout there is deliberate and bounded.
 *
 * `verse` and `chorus` are the song-family reading of `groove` and `drop`: the same slots
 * in the cue grammar, different treatment. A chorus is an anthem to bloom, not an impact
 * to slam, and labelling it `drop` is how a pop song got a warehouse's strobe. The
 * analyser picks the vocabulary per track from what the track is; `sectionBase` maps the
 * song kinds back onto their club ancestors wherever only the energy class matters.
 */
export type SectionKind =
	| 'intro'
	| 'groove'
	| 'verse'
	| 'breakdown'
	| 'build'
	| 'void'
	| 'drop'
	| 'chorus'
	| 'outro';

export const SECTION_KINDS: readonly SectionKind[] = [
	'intro',
	'groove',
	'verse',
	'breakdown',
	'build',
	'void',
	'drop',
	'chorus',
	'outro'
];

/**
 * The club ancestor of a song kind, itself for everything else.
 *
 * Effects declare `taste.sections` in either vocabulary: one written for choruses lists
 * 'chorus'; the rest of the catalog keeps its seven kinds and is eligible for a chorus
 * because a chorus is a drop-class passage. Pickers and linters compare through this.
 */
export function sectionBase(kind: SectionKind): SectionKind {
	return kind === 'verse' ? 'groove' : kind === 'chorus' ? 'drop' : kind;
}

/** Sub: chest thump. Low: kick body and bass. Mid: vocals and leads. Air: hats and risers. */
export const Band = { Sub: 0, Low: 1, Mid: 2, Air: 3 } as const;
export type Band = (typeof Band)[keyof typeof Band];

export const NUM_BANDS = 4;
export const BAND_EDGES_HZ = [20, 100, 400, 2600, 16000] as const;
export const BAND_NAMES = ['sub', 'low', 'mid', 'air'] as const;

/**
 * How many log-spaced bands the per-frame spectrum carries.
 *
 * Twenty over the analysed range is a little over two per octave: enough columns for a meter
 * to read as a measurement rather than as four lights, and few enough that each one still owns
 * a musically distinct slice. Effects address it through `bandAt`, so this number is an
 * implementation detail to everything except the analyser that fills it.
 */
export const SPECTRUM_BANDS = 20;

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
	/**
	 * The spectrum right now: `SPECTRUM_BANDS` log-spaced values 0..1, lowest band first.
	 *
	 * The reason an effect can be a spectrum analyser rather than a field modulated by four
	 * numbers, and the only thing in the frame with enough resolution to carry a melody. Reach
	 * for `bandAt(f, u)` rather than indexing it, so an effect keeps working if the band count
	 * ever moves.
	 *
	 * Each band is normalised against its own distribution across the track, exactly as `bands`
	 * is: a quiet track's top octave still reaches 1.0 when it is that track's brightest.
	 */
	spectrum: Float32Array;

	/**
	 * Where the music is sitting across the room right now: -1 hard left, +1 hard right, and
	 * `panWidth` 0 for mono through 1 for fully decorrelated.
	 *
	 * Use it to bias a position rather than to set one. It is a property of the mix, not of the
	 * room, so an effect that maps it straight onto a wall gets a lighting rig that lurches
	 * whenever a synth pad happens to be wide.
	 */
	pan: number;
	panWidth: number;


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
		spectrum: new Float32Array(SPECTRUM_BANDS),
		pan: 0,
		panWidth: 0,
		kick: false,
		snare: false,
		hat: false,
		kickEnv: 0,
		snareEnv: 0,
		hatEnv: 0
	};
}
