import type { BlendMode } from './contracts/effect.ts';
import { alphaFor, clamp } from './dsl/math.ts';

export function blend(
	dst: Float32Array,
	src: Float32Array,
	mode: BlendMode,
	opacity: number
): void {
	if (opacity <= 0) return;
	const n = dst.length;
	switch (mode) {
		case 'add':
			for (let i = 0; i < n; i++) dst[i] += src[i] * opacity;
			return;
		case 'max':
			for (let i = 0; i < n; i++) {
				const v = src[i] * opacity;
				if (v > dst[i]) dst[i] = v;
			}
			return;
		case 'screen':
			for (let i = 0; i < n; i++) {
				const s = src[i] * opacity;
				dst[i] = dst[i] + s - dst[i] * s;
			}
			return;
		case 'multiply':
			for (let i = 0; i < n; i++) dst[i] *= 1 - opacity + src[i] * opacity;
			return;
		default:
			for (let i = 0; i < n; i++) dst[i] += (src[i] - dst[i]) * opacity;
	}
}

/** Uniform scale of all three channels, so hue and saturation survive exactly. */
export function compressHighlights(buf: Float32Array, knee = 0.78, desat = 0.05): void {
	const range = 1 - knee;
	for (let i = 0; i < buf.length; i += 3) {
		const max = Math.max(buf[i], buf[i + 1], buf[i + 2]);
		if (max <= knee) continue;
		const over = max - knee;
		const compressed = knee + (range * over) / (range + over);
		const k = compressed / max;
		buf[i] *= k;
		buf[i + 1] *= k;
		buf[i + 2] *= k;
		if (desat > 0) {
			const lift = desat * (1 - k);
			buf[i] += lift * (compressed - buf[i]);
			buf[i + 1] += lift * (compressed - buf[i + 1]);
			buf[i + 2] += lift * (compressed - buf[i + 2]);
		}
	}
}

const MEAN_TARGET = 0.36;
/**
 * How far auto-exposure may move, and how fast.
 *
 * Both were set as if this were a camera pointed at a room, and the show is not a room: it is
 * a composition whose dynamics are the point. At a range of 0.45 to 3.2 with a one-second
 * attack the gain fully tracked every section change, and an authored eight-to-one drop against
 * breakdown reached the wall as two-to-one - three quarters of the loudest structural gesture
 * a show has, removed after it was written.
 *
 * The job auto-exposure is actually for is the other one: an effect whose absolute output
 * happens to sit low should not make the whole track dim. That is a property of the track, so
 * the time constant belongs at the scale of a track and not of a section. Half a minute is
 * longer than any section and shorter than any set.
 *
 * It may now only ever lift. Once the mixer has a house floor there is a defined level the room
 * sits at, and an exposure that pulls a correctly lit room back toward its own target is just
 * undoing that decision somewhere the show cannot see.
 */
const MEAN_MIN_GAIN = 1;
const MEAN_MAX_GAIN = 1.7;
const MEAN_TAU_DOWN = 12;
const MEAN_TAU_UP = 30;

/**
 * Auto-exposure both ways, so a track whose effects sit dim still fills the room.
 *
 * Frozen while `alive` is false: a silent passage would otherwise be pumped back up to
 * the target and stop reading as silence.
 */
export class MeanLevel {
	gain = 1;
	private readonly target: number;
	private readonly minGain: number;
	private readonly maxGain: number;

	constructor(target = MEAN_TARGET, minGain = MEAN_MIN_GAIN, maxGain = MEAN_MAX_GAIN) {
		this.target = target;
		this.minGain = minGain;
		this.maxGain = maxGain;
	}

	apply(buf: Float32Array, dt: number, alive: boolean): number {
		let sum = 0;
		for (let i = 0; i < buf.length; i += 3) {
			sum += Math.max(buf[i], buf[i + 1], buf[i + 2]);
		}
		const mean = sum / (buf.length / 3);

		if (alive) {
			const wanted = mean > 1e-4 ? clamp(this.target / mean, this.minGain, this.maxGain) : 1;
			const tau = wanted < this.gain ? MEAN_TAU_DOWN : MEAN_TAU_UP;
			this.gain += (wanted - this.gain) * alphaFor(dt, tau);
		}

		if (this.gain !== 1) for (let i = 0; i < buf.length; i++) buf[i] *= this.gain;
		return mean;
	}

	reset(): void {
		this.gain = 1;
	}
}

/** Per-LED limit on how fast brightness may fall. Stops flicker reading as noise. */
export class BrightnessSlew {
	private prev: Float32Array;
	private readonly maxFallPerSecond: number;

	constructor(length: number, maxFallPerSecond = 25) {
		this.prev = new Float32Array(length);
		this.maxFallPerSecond = maxFallPerSecond;
	}

	apply(buf: Float32Array, dt: number): void {
		const maxFall = this.maxFallPerSecond * dt;
		for (let i = 0; i < buf.length; i++) {
			const floor = this.prev[i] - maxFall;
			if (buf[i] < floor) buf[i] = floor;
			this.prev[i] = buf[i];
		}
	}

	reset(): void {
		this.prev.fill(0);
	}
}

// 8-entry bit-reversal sequence, static across frames. Temporal dither reads as sparkle
// in peripheral vision, which is worse than the banding it fixes.
// In code units, not fractions of full scale, and added after the scale to 0..255. Folding
// it in beforehand costs a float32 rounding that lands a full-scale pixel on 254.
const DITHER = [0, 4, 2, 6, 1, 5, 3, 7].map((v) => v / 8 - 0.5);

/**
 * Authoring domain to 8-bit PWM, with gamma and ordered dither. Applied exactly once, here.
 *
 * The exponent is `gamma`, not `1/gamma`. An LED's output is close to linear in its PWM duty
 * while the eye's response is close to a power law, so a value that is meant to read as half
 * as bright has to be driven at 0.5^2.2, about 22 per cent duty. Encoding it the other way
 * round - the sRGB direction, which is what a monitor wants - drives that same value at 73 per
 * cent, and the whole show comes out washed out and pale with nothing left at the top.
 *
 * 2.2 rather than Adafruit's 2.8: at 2.8 every input from 1 to 27 maps to byte 0, so deep
 * shades vanish entirely, and that dead zone is exactly where slow fades live. WLED's realtime
 * path disables its own gamma by default precisely so the host can own this step.
 */
export function quantize(buf: Float32Array, out: Uint8Array, gamma = 2.2): void {
	for (let i = 0; i < buf.length; i++) {
		const v = buf[i] <= 0 ? 0 : buf[i] >= 1 ? 1 : buf[i];
		// An explicit floor with a half-code bias: without it a full-scale pixel lands on 254
		// for half the dither positions and white visibly shimmers.
		const byte = Math.floor(Math.pow(v, gamma) * 255 + DITHER[i & 7] + 0.5);
		out[i] = byte < 0 ? 0 : byte > 255 ? 255 : byte;
	}
}
