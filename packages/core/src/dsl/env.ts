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
