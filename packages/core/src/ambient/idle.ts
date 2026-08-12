import type { ShowFrame } from '../contracts/frame.ts';
import { createShowFrame } from '../contracts/frame.ts';
import { sinewave } from '../dsl/wave.ts';
import { BARS_PER_PHRASE } from '../grid.ts';

/**
 * A resting pulse rather than a tempo. Forty is the slow end of a heartbeat and half the slowest
 * music anyone plays, so an effect deriving its time constants from `beatPeriod` runs about three
 * times slower here than it would on a track.
 */
const IDLE_BPM = 40;
const BEATS_PER_BAR = 4;

/**
 * How loud the room says it is when nothing is playing.
 *
 * Not zero, and not a measurement of anything. Half the catalog scales itself by `energy` because
 * it is asking "how loud is this passage for this track", and answering nothing at all makes every
 * one of them render a room at its noise floor. This is the answer a quiet passage would give, so
 * they behave as though they were lighting one, which is what a room at rest is.
 */
const IDLE_ENERGY = 0.28;
const IDLE_SWELL = 0.06;
/** Seconds for one breath in and out. */
const IDLE_SWELL_PERIOD = 26;

/**
 * The frame for a room with nothing playing.
 *
 * `bands` and `spectrum` stay at zero throughout. There is nothing to measure, and synthesising a
 * measurement is the one thing this codebase does not do anywhere else: an effect reading the
 * spectrum in here would be answering an invention. What it does supply is a grid, which is what
 * lets most of the calm catalog work with no music at all - `wash` breathes once a bar, `discoBall`
 * sweeps every four, `breathe` runs a two-bar cycle, and none of them need a note to be playing.
 *
 * Everything comes off an accumulated clock rather than off wall time, so two of these fed
 * the same `dt` sequence produce the same frames, and the room is reproducible like everything else.
 */
export class IdleClock {
	readonly frame: ShowFrame = createShowFrame();

	private t = 0;
	private lastBeat = Number.NaN;
	private lastBar = Number.NaN;
	private lastPhrase = Number.NaN;

	constructor() {
		this.reset();
	}

	update(dt: number): ShowFrame {
		this.t += dt;
		this.write(dt);
		return this.frame;
	}

	reset(): void {
		this.t = 0;
		this.write(0);
		// Filled, but with the edges still owed. The first `update` fires beat, downbeat and
		// phrase, exactly as the show player's first frame does: an effect waiting on a downbeat to
		// begin should begin, not sit dark until the second bar.
		this.lastBeat = Number.NaN;
		this.lastBar = Number.NaN;
		this.lastPhrase = Number.NaN;
	}

	private write(dt: number): void {
		const f = this.frame;
		const beatPeriod = 60 / IDLE_BPM;

		f.t = this.t;
		f.dt = dt;

		const beatsF = this.t / beatPeriod;
		const barsF = beatsF / BEATS_PER_BAR;
		const phrasesF = barsF / BARS_PER_PHRASE;

		const beatIndex = Math.floor(beatsF);
		const barIndex = Math.floor(barsF);
		const phraseIndex = Math.floor(phrasesF);

		// By index change, never by a phase threshold, for the same reason the player does it that
		// way: a slow frame must not skip a beat and a fast one must not fire it twice.
		f.beat = beatIndex !== this.lastBeat;
		f.downbeat = barIndex !== this.lastBar;
		f.phraseStart = phraseIndex !== this.lastPhrase;
		this.lastBeat = beatIndex;
		this.lastBar = barIndex;
		this.lastPhrase = phraseIndex;

		f.beatIndex = beatIndex;
		f.barIndex = barIndex;
		f.beatPhase = beatsF - beatIndex;
		f.barPhase = barsF - barIndex;
		f.phrasePhase = phrasesF - phraseIndex;
		f.beatPeriod = beatPeriod;
		f.bpm = IDLE_BPM;

		f.section = 'intro';
		// A section is a passage of a track and there is no track, so the two structural readings
		// that only mean something inside one are held at their nothing-is-happening values.
		f.sectionProgress = 0;
		f.buildProgress = 0;
		f.timeToDrop = Infinity;
		f.timeSinceDrop = Infinity;

		f.energy = IDLE_ENERGY + IDLE_SWELL * (sinewave(this.t / IDLE_SWELL_PERIOD) - 0.5) * 2;
		f.bands.fill(0);
		f.spectrum.fill(0);

		f.pan = 0;
		f.panWidth = 0;
		f.kick = false;
		f.snare = false;
		f.hat = false;
		f.kickEnv = 0;
		f.snareEnv = 0;
		f.hatEnv = 0;
	}
}
