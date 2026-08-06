import { describe, expect, it } from 'vitest';
import { SECTION_KINDS, barTimeAt } from '@mv/core';
import { analyzeTrack } from './analyze.ts';
import { detectBeats } from './beats.ts';
import { extractFeatures } from './features.ts';
import { measureLoudness } from './loudness.ts';
import { analyseStereo } from './stereo.ts';
import { ARRANGEMENT, fMeasure, synthesise } from './fixture.ts';

const fixture = synthesise();
const analysis = analyzeTrack({
	mono: fixture.mono,
	sampleRate: fixture.sampleRate,
	duration: fixture.duration,
	hash: 'test',
	trackId: 'file-000000000000',
	title: 'Synthetic Arrangement'
});

describe('tempo', () => {
	it('recovers the true bpm to within a tenth', () => {
		expect(Math.abs(analysis.tempo.bpm - fixture.bpm)).toBeLessThan(0.1);
	});

	it('does not settle on a multiple or a fraction of it', () => {
		expect(analysis.tempo.bpm).toBeGreaterThan(fixture.bpm * 0.8);
		expect(analysis.tempo.bpm).toBeLessThan(fixture.bpm * 1.25);
	});

	it('locks phase within 30 ms of a real beat', () => {
		const period = 60 / fixture.bpm;
		const phase = analysis.tempo.firstBeat % period;
		expect(Math.min(phase, period - phase)).toBeLessThan(0.03);
	});

	it('holds the grid to the end of the track', () => {
		// A period error is what accumulates; a phase offset is a constant and is checked above.
		const beats = Math.floor(fixture.duration / (60 / fixture.bpm));
		const drift = Math.abs(beats * (60 / analysis.tempo.bpm - 60 / fixture.bpm));
		expect(drift).toBeLessThan(0.03);
	});

	it('reports the grid as constant on programmed material', () => {
		expect(analysis.tempo.constant).toBe(true);
	});

	it('finds the beats themselves, not just the tempo', () => {
		const truth: number[] = [];
		for (let t = 0; t < fixture.duration; t += 60 / fixture.bpm) truth.push(t);
		expect(fMeasure(truth, analysis.beats, 0.07).f).toBeGreaterThan(0.9);
	});

	it('counts four beats to the bar', () => {
		expect(analysis.tempo.beatsPerBar).toBe(4);
	});
});

describe('bar table', () => {
	it('covers the track at one row per bar', () => {
		const expected = ARRANGEMENT.reduce((n, s) => n + s.bars, 0);
		expect(analysis.bars.length).toBeGreaterThanOrEqual(expected - 2);
		expect(analysis.bars.length).toBeLessThanOrEqual(expected + 1);
	});

	it('agrees with the tempo grid about where each bar starts', () => {
		for (const row of analysis.bars.slice(0, 40)) {
			expect(Math.abs(row.t - barTimeAt(analysis.tempo, row.bar))).toBeLessThan(0.05);
		}
	});

	it('normalises energy across the whole track so a peak exists', () => {
		const energies = analysis.bars.map((b) => b.energy);
		expect(Math.max(...energies)).toBeGreaterThan(80);
		expect(Math.min(...energies)).toBeLessThan(20);
	});

	it('emits only known event tags', () => {
		const known = new Set([
			'drop_downbeat',
			'crash',
			'riser',
			'snare_roll',
			'silence',
			'kick_in',
			'kick_out',
			'bass_in',
			'bass_out',
			'filter_sweep'
		]);
		for (const row of analysis.bars) for (const e of row.events) expect(known.has(e)).toBe(true);
	});

	it('counts more kicks where the kick plays than where it does not', () => {
		const perBar = (rows: typeof analysis.bars) =>
			rows.reduce((n, b) => n + b.kicks, 0) / Math.max(1, rows.length);
		const drop = analysis.bars.filter((b) => b.section === 'drop');
		const quiet = analysis.bars.filter((b) => b.section === 'intro' || b.section === 'breakdown');
		expect(perBar(drop)).toBeGreaterThan(3);
		expect(perBar(quiet)).toBeLessThan(perBar(drop) * 0.5);
	});
});

describe('sections', () => {
	it('tiles the track with no gaps or overlaps', () => {
		expect(analysis.sections[0].startBar).toBe(0);
		for (let i = 1; i < analysis.sections.length; i++) {
			expect(analysis.sections[i].startBar).toBe(analysis.sections[i - 1].endBar);
		}
		expect(analysis.sections.at(-1)!.endBar).toBe(analysis.bars.length);
	});

	it('starts every non-void section on the phrase grid', () => {
		// The linter errors on an off-phrase cue, so an off-phrase section boundary would put
		// the analyser and the linter in direct contradiction.
		const anchor = analysis.tempo.phraseAnchorBar;
		const off = analysis.sections
			.filter((s) => s.kind !== 'void' && s.startBar > 0)
			.filter((s) => (((s.startBar - anchor) % 4) + 4) % 4 !== 0)
			.map((s) => `${s.kind}@${s.startBar}`);
		expect(off).toEqual([]);
	});

	it('emits no section shorter than two bars except a void', () => {
		const runts = analysis.sections
			.filter((s) => s.kind !== 'void' && s.lengthBars < 2)
			.map((s) => `${s.kind}@${s.startBar}`);
		expect(runts).toEqual([]);
	});

	it('agrees with the bar table about which section each bar is in', () => {
		for (const s of analysis.sections) {
			for (let b = s.startBar; b < s.endBar; b++) expect(analysis.bars[b].section).toBe(s.kind);
		}
	});

	it('uses only known section kinds', () => {
		for (const s of analysis.sections) expect(SECTION_KINDS).toContain(s.kind);
	});

	it('ranks exactly one section as the peak', () => {
		expect(analysis.sections.filter((s) => s.energyRank === 1).length).toBe(1);
	});

	it('gives the peak rank to the loudest arrangement stage', () => {
		const peak = analysis.sections.find((s) => s.energyRank === 1)!;
		// Stage 5 is the sixteen-bar drop; the peak has to fall inside it.
		const dropStart = fixture.stageBars[5];
		const dropEnd = dropStart + ARRANGEMENT[5].bars;
		expect(peak.startBar).toBeGreaterThanOrEqual(dropStart - 2);
		expect(peak.startBar).toBeLessThan(dropEnd);
	});

	it('finds the two silent bars as the quietest in the track', () => {
		const voidStart = fixture.stageBars[4];
		const quietest = analysis.bars
			.filter((b) => b.bar >= voidStart - 1 && b.bar < voidStart + 2)
			.reduce((a, b) => (b.energy < a.energy ? b : a));
		const drop = analysis.bars.filter((b) => b.section === 'drop');
		const dropEnergy = drop.reduce((n, b) => n + b.energy, 0) / Math.max(1, drop.length);
		expect(quietest.energy).toBeLessThan(dropEnergy * 0.5);
	});

	it('reads quiet sections as quieter than loud ones', () => {
		const loud = analysis.sections.filter((s) => s.kind === 'drop' || s.kind === 'groove');
		const quiet = analysis.sections.filter((s) => s.kind === 'breakdown' || s.kind === 'intro');
		if (quiet.length === 0 || loud.length === 0) return;
		expect(Math.max(...quiet.map((s) => s.meanEnergy))).toBeLessThan(
			Math.max(...loud.map((s) => s.meanEnergy))
		);
	});

	it('points repeats at an earlier section', () => {
		for (const s of analysis.sections) {
			if (s.repeatOf === null) continue;
			expect(s.repeatOf).toBeLessThan(s.index);
		}
	});
});

describe('onsets', () => {
	it('finds the kick pattern', () => {
		expect(fMeasure(fixture.kick, analysis.onsets.kick, 0.05).f).toBeGreaterThan(0.8);
	});

	it('finds the hat pattern', () => {
		expect(fMeasure(fixture.hat, analysis.onsets.hat, 0.05).f).toBeGreaterThan(0.7);
	});

	it('finds most of the snares', () => {
		// The weakest of the three, and the literature agrees: a snare shares its noise burst
		// with a hat and its body with a bass note, and every published system without a neural
		// net scores it well below kick and hat. This bar is where the detector actually sits,
		// so it catches a regression without claiming an accuracy it does not have.
		expect(fMeasure(fixture.snare, analysis.onsets.snare, 0.05).recall).toBeGreaterThan(0.6);
	});

	it('keeps every onset inside the track', () => {
		for (const list of [analysis.onsets.kick, analysis.onsets.snare, analysis.onsets.hat]) {
			for (const t of list) {
				expect(t).toBeGreaterThanOrEqual(0);
				expect(t).toBeLessThanOrEqual(analysis.duration);
			}
		}
	});

	it('reports onsets in time order', () => {
		for (const list of [analysis.onsets.kick, analysis.onsets.snare, analysis.onsets.hat]) {
			for (let i = 1; i < list.length; i++) expect(list[i]).toBeGreaterThanOrEqual(list[i - 1]);
		}
	});
});

describe('moments', () => {
	it('are sorted by time and inside the track', () => {
		for (let i = 1; i < analysis.moments.length; i++) {
			expect(analysis.moments[i].t).toBeGreaterThanOrEqual(analysis.moments[i - 1].t);
		}
		for (const m of analysis.moments) {
			expect(m.t).toBeGreaterThanOrEqual(0);
			expect(m.t).toBeLessThanOrEqual(analysis.duration + 1);
		}
	});

	it('name the peak section', () => {
		expect(analysis.moments.some((m) => m.note.includes('the peak of the track'))).toBe(true);
	});

	it('address every moment by a bar that exists', () => {
		for (const m of analysis.moments) {
			expect(m.bar).toBeGreaterThanOrEqual(0);
			expect(m.bar).toBeLessThan(analysis.bars.length);
		}
	});
});

describe('loudness', () => {
	it('reads a -23 dBFS sine as -23 LUFS', () => {
		// EBU Tech 3341 case 1. The K-weighting is flat enough at 1 kHz that the -0.691 offset
		// should cancel it exactly.
		const sampleRate = 22050;
		const signal = new Float32Array(sampleRate * 10);
		const amplitude = Math.pow(10, -23 / 20) * Math.SQRT2;
		for (let i = 0; i < signal.length; i++) {
			signal[i] = amplitude * Math.sin((2 * Math.PI * 997 * i) / sampleRate);
		}
		expect(measureLoudness(signal, sampleRate).integrated).toBeCloseTo(-23, 1);
	});

	it('gates out silence rather than averaging it in', () => {
		const sampleRate = 22050;
		const signal = new Float32Array(sampleRate * 20);
		const amplitude = Math.pow(10, -23 / 20) * Math.SQRT2;
		// Ten seconds of tone, ten of silence: gating means the answer is still -23.
		for (let i = 0; i < sampleRate * 10; i++) {
			signal[i] = amplitude * Math.sin((2 * Math.PI * 997 * i) / sampleRate);
		}
		expect(measureLoudness(signal, sampleRate).integrated).toBeCloseTo(-23, 0);
	});

	it('reports a loudness range and a peak-to-loudness ratio', () => {
		expect(analysis.loudnessRange).toBeGreaterThan(0);
		expect(analysis.peakToLoudness).toBeGreaterThan(0);
	});
});

describe('determinism', () => {
	it('produces an identical analysis from an identical input', () => {
		const again = analyzeTrack({
			mono: fixture.mono,
			sampleRate: fixture.sampleRate,
			duration: fixture.duration,
			hash: 'test',
			trackId: 'file-000000000000',
			title: 'Synthetic Arrangement'
		});
		expect(JSON.stringify(again)).toBe(JSON.stringify(analysis));
	});

	it('does not consume the caller’s buffer', () => {
		const before = fixture.mono.slice(0, 1000);
		analyzeTrack({
			mono: fixture.mono,
			sampleRate: fixture.sampleRate,
			duration: fixture.duration,
			hash: 'test',
			trackId: 'file-000000000000',
			title: 'x'
		});
		expect(Array.from(fixture.mono.slice(0, 1000))).toEqual(Array.from(before));
	});
});

describe('tempo hints', () => {
	it('honours a hint that contradicts the detected reading', () => {
		const half = synthesise(96);
		const features = extractFeatures(half.mono, half.sampleRate);
		const hinted = detectBeats(features.odf, features.curves.fps, half.duration, { bpmHint: 144 });
		expect(hinted.bpm).toBeGreaterThan(144 * 0.94);
		expect(hinted.bpm).toBeLessThan(144 * 1.06);
	});
});

describe('degenerate input', () => {
	const blank = new Float32Array(22050 * 5);

	it('survives silence without throwing or emitting NaN', () => {
		const quiet = analyzeTrack({
			mono: blank,
			sampleRate: 22050,
			duration: 5,
			hash: 'silent',
			trackId: 'file-000000000000',
			title: 'Silence'
		});
		expect(Number.isFinite(quiet.tempo.bpm)).toBe(true);
		expect(quiet.tempo.bpm).toBeGreaterThan(0);
		for (const row of quiet.bars) {
			expect(Number.isFinite(row.energy)).toBe(true);
			expect(row.energy).toBeGreaterThanOrEqual(0);
		}
		expect(JSON.stringify(quiet)).not.toContain('null,');
	});

	it('survives a track shorter than one bar', () => {
		const stub = analyzeTrack({
			mono: new Float32Array(2205),
			sampleRate: 22050,
			duration: 0.1,
			hash: 'stub',
			trackId: 'file-000000000000',
			title: 'Stub'
		});
		expect(Number.isFinite(stub.tempo.bpm)).toBe(true);
		expect(stub.sections.length).toBeGreaterThanOrEqual(0);
	});
});

describe('grid locking', () => {
	it('places every drum onset exactly on a sixteenth of the grid', () => {
		// A detector that finds four kicks in five is precise and still looks wrong in a room:
		// the eye reads the gap, not the accuracy. Everything is snapped so a flash driven by a
		// drum lands where the music put it.
		const step = analysis.tempo.beatPeriod / 4;
		for (const list of [analysis.onsets.kick, analysis.onsets.snare, analysis.onsets.hat]) {
			for (const t of list) {
				const slot = Math.round((t - analysis.tempo.firstBeat) / step);
				const off = Math.abs(t - (analysis.tempo.firstBeat + slot * step));
				expect(off).toBeLessThan(0.006);
			}
		}
	});

	it('carries enough tempo precision that the grid does not drift', () => {
		// The player multiplies the period by the bar index, so rounding it to three decimals is
		// eighty milliseconds of drift by the end of a four-minute track: nothing looks broken,
		// everything arrives late.
		const last = analysis.bars.length - 1;
		expect(Math.abs(barTimeAt(analysis.tempo, last) - analysis.bars[last].t)).toBeLessThan(0.01);
	});

	it('completes a kick pattern rather than leaving gaps in it', () => {
		const drop = analysis.sections.find((s) => s.kind === 'drop');
		if (!drop) return;
		const bars = analysis.bars.filter((b) => b.bar >= drop.startBar && b.bar < drop.endBar);
		const withKick = bars.filter((b) => b.kicks > 0).length;
		expect(withKick / bars.length).toBeGreaterThan(0.9);
	});
});

describe('stereo', () => {
	it('reports no image when the caller passes only a mono sum', () => {
		expect(analysis.stereo.pan).toEqual([]);
		expect(analysis.stereo.width).toEqual([]);
	});

	it('finds a hard-panned source and says which side it is on', () => {
		const sampleRate = 22050;
		const n = sampleRate * 4;
		const left = new Float32Array(n);
		const right = new Float32Array(n);
		for (let i = 0; i < n; i++) {
			// A 1 kHz tone that switches sides every half second, which is the gesture this
			// exists to see: it is identical in the mono sum and invisible to every other feature.
			const v = Math.sin((2 * Math.PI * 1000 * i) / sampleRate) * 0.5;
			if (Math.floor(i / (sampleRate / 2)) % 2 === 0) left[i] = v;
			else right[i] = v;
		}
		const image = analyseStereo(left, right, sampleRate);
		const at = (t: number) => image.pan[Math.round(t * image.fps)];
		expect(at(0.25)).toBeLessThan(-0.8);
		expect(at(0.75)).toBeGreaterThan(0.8);
		expect(at(1.25)).toBeLessThan(-0.8);
	});

	it('reads a centred mono source as centred', () => {
		const sampleRate = 22050;
		const n = sampleRate * 2;
		const both = new Float32Array(n);
		for (let i = 0; i < n; i++) both[i] = Math.sin((2 * Math.PI * 1000 * i) / sampleRate) * 0.5;
		const image = analyseStereo(both, Float32Array.from(both), sampleRate);
		for (let i = 5; i < image.pan.length - 5; i++) expect(Math.abs(image.pan[i])).toBeLessThan(0.05);
	});
});
