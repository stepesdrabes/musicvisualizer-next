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
