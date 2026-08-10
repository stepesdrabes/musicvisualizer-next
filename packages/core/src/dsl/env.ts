import { alphaFor, clamp } from './math.ts';

/** Fires to `strength`, then decays over a musical duration. The club pulse. */
export class PulseEnv {
	value = 0;

	fire(strength = 1): void {
		if (strength > this.value) this.value = strength;
	}

	decay(dt: number, beatPeriod: number, beats = 0.5): number {
		const tau = Math.max(beatPeriod * beats, 0.02) / 3;
		this.value *= 1 - alphaFor(dt, tau);
		if (this.value < 1e-4) this.value = 0;
		return this.value;
	}

	reset(): void {
		this.value = 0;
	}
}

/**
 * Instant attack, hold, then exponential release.
 *
 * The hold is the whole point: without it a hit lasts one frame, lands below the eye's
 * integration window, and its apparent brightness depends on where the frame boundary
 * fell relative to the onset.
 */
export class FlashEnvelope {
	value = 0;
	private held = 0;
	private readonly holdSeconds: number;
	private readonly releaseTau: number;

	constructor(holdSeconds = 0.035, releaseTau = 0.09) {
		this.holdSeconds = holdSeconds;
		this.releaseTau = releaseTau;
	}

	fire(strength = 1): void {
		if (strength > this.value) this.value = strength;
		this.held = this.holdSeconds;
	}

	update(dt: number): number {
		if (this.held > 0) {
			this.held -= dt;
			return this.value;
		}
		this.value *= 1 - alphaFor(dt, this.releaseTau);
		if (this.value < 1e-4) this.value = 0;
		return this.value;
	}

	reset(): void {
		this.value = 0;
		this.held = 0;
	}
}

/**
 * Follows a continuously moving signal: fast up, slower down, in seconds rather than in beats.
 *
 * What anything reading `f.spectrum` should pass through. The spectrum is a real 50 Hz
 * measurement resampled per frame, so it carries a few per cent of frame-to-frame noise, and an
 * effect wired straight to it shimmers. `BeatHold` removes that by sampling once a beat, which
 * also removes every guitar stab, cymbal and word that happens between beats - most of what
 * makes a room look like it is listening.
 *
 * An attack in the tens of milliseconds is under the eye's integration window, so a transient
 * arrives looking instant while noise, which alternates sign every frame or two, is averaged
 * away. The longer release is what stops the room strobing on the back of every note: the eye
 * forgives a slow decay and objects loudly to a fast one.
 *
 * Defaults are a compromise picked for level: 25 ms up reads as immediate, 140 ms down is about
 * a sixteenth at 110 bpm, so a chord rings out rather than snapping off. Pass a longer attack
 * for a position, which should never teleport, and a shorter one for a meter tip.
 */
export class Follower {
	value = 0;
	private readonly attackTau: number;
	private readonly releaseTau: number;
	private started = false;

	constructor(attackTau = 0.025, releaseTau = 0.14) {
		this.attackTau = attackTau;
		this.releaseTau = releaseTau;
	}

	update(target: number, dt: number): number {
		// Straight to the first reading. Rising from zero over the first frames of a cue is a
		// fade nobody asked for, and on a one-bar cue it is most of the cue.
		if (!this.started) {
			this.started = true;
			this.value = target;
			return this.value;
		}
		const tau = target > this.value ? this.attackTau : this.releaseTau;
		this.value += (target - this.value) * alphaFor(dt, tau);
		return this.value;
	}

	reset(): void {
		this.value = 0;
		this.started = false;
	}
}

/** Hysteresis, so a value hovering at a threshold does not chatter. */
export class Schmitt {
	private state: boolean;
	private readonly lo: number;
	private readonly hi: number;

	constructor(lo: number, hi: number, initial = false) {
		this.lo = lo;
		this.hi = hi;
		this.state = initial;
	}

	update(v: number): boolean {
		if (this.state) {
			if (v < this.lo) this.state = false;
		} else if (v > this.hi) {
			this.state = true;
		}
		return this.state;
	}

	get value(): boolean {
		return this.state;
	}

	reset(initial = false): void {
		this.state = initial;
	}
}

/** Rises over `riseTau`, collapses instantly when the target drops. */
export function ratchet(current: number, target: number, dt: number, riseTau: number): number {
	if (target <= current) return target;
	return clamp(current + (target - current) * alphaFor(dt, riseTau));
}

/**
 * Reads its input once per beat and holds it until the next one.
 *
 * What anything driven by the music should pass through before it reaches the room. The
 * spectrum moves continuously and its own frame-to-frame noise is several per cent, so an
 * effect that follows it directly shimmers at the frame rate against a beat it has no
 * relationship to. Latched here, every change the room makes lands ON a beat by construction,
 * and the ones between beats simply do not happen.
 *
 * The glide is a small fraction of a beat, not zero: a hard step is right for a colour and
 * wrong for a position, and at an eighth of a beat the arrival still reads as on the beat while
 * nothing in the room teleports. Pass 0 for a true sample and hold.
 */
export class BeatHold {
	private held = Number.NaN;
	private shown = Number.NaN;
	/** In beats. A constructor parameter property would not survive type stripping. */
	private readonly glide: number;

	constructor(glide = 0.12) {
		this.glide = glide;
	}

	reset(): void {
		this.held = Number.NaN;
		this.shown = Number.NaN;
	}

	update(target: number, beat: boolean, dt: number, beatPeriod: number): number {
		if (Number.isNaN(this.held)) {
			this.held = target;
			this.shown = target;
			return this.shown;
		}
		if (beat) this.held = target;
		if (this.glide <= 0) {
			this.shown = this.held;
			return this.shown;
		}
		this.shown += (this.held - this.shown) * alphaFor(dt, Math.max(1e-3, this.glide * beatPeriod));
		return this.shown;
	}
}
