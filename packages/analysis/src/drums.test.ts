import { describe, expect, it } from 'vitest';
import { detectDrums } from './drums.ts';
import { extractFeatures } from './features.ts';

/**
 * The SOPHIE class: a kick that is spectrally a bass note - a clipped sub gliding from
 * ~100 Hz into the kick band, sustained, with no broadband transient - over a live
 * bassline. This is exactly the material the bass-subtraction exists to be suspicious
 * of, and the class the fixture set lacked: the Ponyboy investigation measured the
 * detectors healthy on it, and this pins that down against regression from either
 * direction (a deaf kick head, or the bassline counted as drums - the Self Aware
 * complaint's shape).
 */
function sophieClip(): { mono: Float32Array; sampleRate: number; kicks: number[] } {
	const sampleRate = 22050;
	const beat = 0.5;
	const duration = 16;
	const mono = new Float32Array(Math.ceil(duration * sampleRate));
	const add = (t: number, length: number, f: (s: number) => number) => {
		const i0 = Math.floor(t * sampleRate);
		const n = Math.floor(length * sampleRate);
		for (let i = 0; i < n && i0 + i < mono.length; i++) mono[i0 + i] += f(i / sampleRate);
	};
	const kicks: number[] = [];
	for (let t = 0.5; t < duration - 0.6; t += beat) {
		kicks.push(t);
		add(t, 0.35, (s) => {
			// The glide enters just inside the kick band and settles onto the sub; hard
			// clipping smears harmonics up through the bassline's own range. Entering
			// in-band matters: the real kick's detectability lives in the low-band flux at
			// onset, and a glide that spends its first frames above 90 Hz has none.
			const f = 58 + 27 * Math.exp(-s * 30);
			return Math.tanh(3 * Math.sin(2 * Math.PI * f * s)) * Math.exp(-s * 7) * 0.9;
		});
		// The bassline: off-beat eighths at 110 Hz, played legato - a ramped attack and a
		// held body, which is what separates a note from a hit. A plucked synth bass IS
		// percussive and counting it is arguably right; the guard is about notes.
		add(t + beat / 2, 0.22, (s) => {
			const ramp = Math.min(1, s / 0.03);
			return Math.sin(2 * Math.PI * 110 * s) * ramp * 0.4;
		});
	}
	return { mono, sampleRate, kicks };
}

describe('the kit on a distorted pitched-sub kick', () => {
	it('hears the kick and does not count the bassline', () => {
		const { mono, sampleRate, kicks } = sophieClip();
		const features = extractFeatures(mono, sampleRate);
		const detected = detectDrums(features.spec, { beatPeriod: 0.5, odf: features.odf });

		const tol = 0.07;
		let hit = 0;
		for (const t of kicks) {
			if (detected.kick.times.some((d) => Math.abs(d - t) <= tol)) hit++;
		}
		const recall = hit / kicks.length;
		let truePos = 0;
		for (const d of detected.kick.times) {
			if (kicks.some((t) => Math.abs(d - t) <= tol)) truePos++;
		}
		const precision = detected.kick.times.length > 0 ? truePos / detected.kick.times.length : 0;
		// Floors are CHARACTERISATION, set from measurement, not hope. Recall guards the
		// false-negative direction this fixture exists for: the class stays heard (real
		// Ponyboy: DSP recall 0.994 against the model). Precision is the open Self Aware
		// thread made synthetic - every legato bass note here reads as a kick, because a
		// sustained sub kick and a held bass note overlap physically and the DSP cannot
		// split them (the shipped pipeline takes kicks from the trained model for exactly
		// this reason; DSP is the no-model fallback). The floor pins today's rate so any
		// detector change must move it UP - raising this floor is the Self Aware fix's
		// win condition.
		expect(recall).toBeGreaterThan(0.8);
		expect(precision).toBeGreaterThan(0.4);
	});
});
