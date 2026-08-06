import { describe, expect, it } from 'vitest';
import { analyzeTrack } from './analyze.ts';
import { fitBeatGrid, refineGrid } from './beatgrid.ts';
import { conditionNovelty, mergeOnsets, pickPeaks } from './onsets.ts';
import { extractFeatures } from './features.ts';

const SR = 44100;

interface Stage {
	bars: number;
	kick: number;
	bass: number;
	hat: number;
	pad: number;
	/** Rising white-noise riser. */
	riser: boolean;
	silent?: boolean;
}

/**
 * Synthesise a full arrangement rather than a click track. Real thresholds only mean
 * something against material that has an intro, a build, a void and two drops.
 */
function synth(bpm: number, stages: Stage[]): { mono: Float32Array; duration: number } {
	const beatPeriod = 60 / bpm;
	const barLength = beatPeriod * 4;
	const totalBars = stages.reduce((n, s) => n + s.bars, 0);
	const duration = totalBars * barLength;
	const mono = new Float32Array(Math.ceil(duration * SR));

	let bar = 0;
	let rngState = 12345;
	const rand = () => {
		rngState = (Math.imul(rngState, 1664525) + 1013904223) >>> 0;
		return rngState / 4294967296 - 0.5;
	};

	for (const stage of stages) {
		for (let b = 0; b < stage.bars; b++, bar++) {
			const barStart = bar * barLength;
			if (stage.silent) continue;

			for (let beat = 0; beat < 4; beat++) {
				const t0 = barStart + beat * beatPeriod;
				const i0 = Math.floor(t0 * SR);

				if (stage.kick > 0) {
					const len = Math.floor(0.14 * SR);
					for (let i = 0; i < len && i0 + i < mono.length; i++) {
						const env = Math.exp((-i / SR) * 34);
						mono[i0 + i] += Math.sin((2 * Math.PI * 55 * i) / SR) * env * stage.kick;
					}
				}

				// Snare on 2 and 4: filtered noise burst.
				if (beat % 2 === 1 && stage.kick > 0) {
					const len = Math.floor(0.08 * SR);
					for (let i = 0; i < len && i0 + i < mono.length; i++) {
						const env = Math.exp((-i / SR) * 52);
						mono[i0 + i] += rand() * env * 0.45 * stage.kick;
					}
				}

				if (stage.hat > 0) {
					const hi = Math.floor((t0 + beatPeriod / 2) * SR);
					const len = Math.floor(0.03 * SR);
					for (let i = 0; i < len && hi + i < mono.length; i++) {
						const env = Math.exp((-i / SR) * 150);
						mono[hi + i] += rand() * env * stage.hat;
					}
				}
			}

			// Bassline on 8ths, one octave above the kick fundamental.
			if (stage.bass > 0) {
				for (let e = 0; e < 8; e++) {
					const t0 = barStart + e * (beatPeriod / 2);
					const i0 = Math.floor(t0 * SR);
					const len = Math.floor(0.2 * SR);
					for (let i = 0; i < len && i0 + i < mono.length; i++) {
						const env = Math.exp((-i / SR) * 12);
						mono[i0 + i] += Math.sin((2 * Math.PI * 110 * i) / SR) * env * stage.bass * 0.5;
					}
				}
			}

			// Sustained pad, so the upper bands have content and the centroid means something.
			if (stage.pad > 0) {
				const i0 = Math.floor(barStart * SR);
				const len = Math.floor(barLength * SR);
				for (let i = 0; i < len && i0 + i < mono.length; i++) {
					const t = i / SR;
					mono[i0 + i] +=
						(Math.sin(2 * Math.PI * 440 * t) + Math.sin(2 * Math.PI * 660 * t)) *
						0.09 *
						stage.pad;
				}
			}

			if (stage.riser) {
				const i0 = Math.floor(barStart * SR);
				const len = Math.floor(barLength * SR);
				const climb = b / Math.max(1, stage.bars - 1);
				for (let i = 0; i < len && i0 + i < mono.length; i++) {
					mono[i0 + i] += rand() * 0.30 * (0.25 + climb);
				}
			}
		}
	}

	for (let i = 0; i < mono.length; i++) mono[i] = Math.max(-1, Math.min(1, mono[i]));
	return { mono, duration };
}

const ARRANGEMENT: Stage[] = [
	{ bars: 4, kick: 0, bass: 0, hat: 0, pad: 0.6, riser: false },
	{ bars: 8, kick: 0.9, bass: 0.7, hat: 0.2, pad: 0.5, riser: false },
	{ bars: 6, kick: 0, bass: 0, hat: 0.15, pad: 0.8, riser: false },
	{ bars: 4, kick: 0.5, bass: 0, hat: 0.3, pad: 0.7, riser: true },
	{ bars: 1, kick: 0, bass: 0, hat: 0, pad: 0, riser: false, silent: true },
	{ bars: 8, kick: 1.0, bass: 0.9, hat: 0.35, pad: 0.6, riser: false },
	{ bars: 8, kick: 0.9, bass: 0.7, hat: 0.25, pad: 0.5, riser: false },
	{ bars: 4, kick: 0, bass: 0, hat: 0.1, pad: 0.4, riser: false }
];

const BPM = 128;
const track = synth(BPM, ARRANGEMENT);
const analysis = analyzeTrack({
	mono: track.mono,
	sampleRate: SR,
	duration: track.duration,
	hash: 'test',
	integratedLufs: -14,
	trackId: 'file-000000000000',
	title: 'Synthetic Arrangement'
});

describe('tempo', () => {
	it('recovers the true bpm within 0.5', () => {
		expect(Math.abs(analysis.tempo.bpm - BPM)).toBeLessThan(0.5);
	});

	it('does not double or halve the tempo', () => {
		expect(analysis.tempo.bpm).toBeGreaterThan(BPM * 0.75);
		expect(analysis.tempo.bpm).toBeLessThan(BPM * 1.25);
	});

	it('locks phase within 30 ms of a real beat', () => {
		const beatPeriod = 60 / BPM;
		const phase = analysis.tempo.firstBeat % beatPeriod;
		const err = Math.min(phase, beatPeriod - phase);
		expect(err).toBeLessThan(0.03);
	});

	it('does not drift more than 35 ms by the end of the track', () => {
		// Period error only. A phase offset is a constant, not drift, and is asserted above.
		const trueBeats = Math.floor(track.duration / (60 / BPM));
		const drift = Math.abs(trueBeats * (60 / analysis.tempo.bpm - 60 / BPM));
		expect(drift).toBeLessThan(0.035);
	});

	it('reports usable confidence on unambiguous material', () => {
		expect(analysis.tempo.confidence).toBeGreaterThan(0.5);
	});
});

describe('bar table', () => {
	it('covers the track at one row per bar', () => {
		const expected = ARRANGEMENT.reduce((n, s) => n + s.bars, 0);
		expect(analysis.bars.length).toBeGreaterThanOrEqual(expected - 2);
		expect(analysis.bars.length).toBeLessThanOrEqual(expected + 1);
	});

	it('normalises energy across the whole track so a peak exists', () => {
		const energies = analysis.bars.map((b) => b.energy);
		expect(Math.max(...energies)).toBeGreaterThan(80);
		expect(Math.min(...energies)).toBeLessThan(20);
	});

	it('counts far more kicks where the kick is playing than where it is not', () => {
		const intro = analysis.bars.filter((b) => b.section === 'intro');
		const drop = analysis.bars.filter((b) => b.section === 'drop');
		const perBar = (rows: typeof intro) =>
			rows.reduce((n, b) => n + b.kicks, 0) / Math.max(1, rows.length);
		expect(perBar(drop)).toBeGreaterThan(3);
		expect(perBar(intro)).toBeLessThan(perBar(drop) * 0.25);
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
});

describe('structure', () => {
	it('finds at least one drop', () => {
		expect(analysis.sections.filter((s) => s.kind === 'drop').length).toBeGreaterThanOrEqual(1);
	});

	it('locates the silent bar as a void', () => {
		const voids = analysis.sections.filter((s) => s.kind === 'void');
		expect(voids.length).toBeGreaterThanOrEqual(1);
		// The synthesised silence is bar 22 (4+8+6+4).
		expect(Math.abs(voids[0].startBar - 22)).toBeLessThanOrEqual(2);
	});

	it('ranks exactly one section as the peak', () => {
		expect(analysis.sections.filter((s) => s.energyRank === 1).length).toBe(1);
	});

	it('gives the peak rank to a drop', () => {
		const peak = analysis.sections.find((s) => s.energyRank === 1);
		expect(peak?.kind).toBe('drop');
	});

	it('starts every non-void section on the 4-bar phrase grid', () => {
		// The linter errors on off-phrase cues, so an off-phrase section boundary would put the
		// analyser and the linter in direct contradiction.
		const anchor = analysis.tempo.phraseAnchorBar;
		const off = analysis.sections
			.filter((s) => s.kind !== 'void' && s.startBar > 0)
			.filter((s) => (((s.startBar - anchor) % 4) + 4) % 4 !== 0)
			.map((s) => `${s.kind}@${s.startBar}`);
		expect(off).toEqual([]);
	});

	it('emits no non-void section shorter than two bars', () => {
		const runts = analysis.sections
			.filter((s) => s.kind !== 'void' && s.lengthBars < 2)
			.map((s) => `${s.kind}@${s.startBar}`);
		expect(runts).toEqual([]);
	});

	it('agrees with the bar table about which section each bar is in', () => {
		for (const s of analysis.sections) {
			for (let b = s.startBar; b < s.endBar; b++) {
				expect(analysis.bars[b]?.section ?? s.kind).toBe(s.kind);
			}
		}
	});

	it('tiles the track with no gaps or overlaps', () => {
		for (let i = 1; i < analysis.sections.length; i++) {
			expect(analysis.sections[i].startBar).toBe(analysis.sections[i - 1].endBar);
		}
		expect(analysis.sections[0].startBar).toBe(0);
	});

	it('reads breakdowns as quieter than drops', () => {
		const drops = analysis.sections.filter((s) => s.kind === 'drop');
		const quiet = analysis.sections.filter((s) => s.kind === 'breakdown' || s.kind === 'intro');
		if (quiet.length === 0) return;
		const loudest = Math.max(...quiet.map((s) => s.meanEnergy));
		const softest = Math.min(...drops.map((s) => s.meanEnergy));
		expect(loudest).toBeLessThan(softest);
	});
});

describe('onsets', () => {
	it('finds roughly one kick per beat during the drop', () => {
		const dropStart = analysis.sections.find((s) => s.kind === 'drop')!.startTime;
		const dropEnd = dropStart + 8 * analysis.tempo.beatPeriod;
		const inDrop = analysis.onsets.kick.filter((t) => t >= dropStart && t < dropEnd).length;
		expect(inDrop).toBeGreaterThanOrEqual(6);
		// Some slack: a bassline sharing the sub band inflates the count a little, which is
		// visually harmless. Twice the beat count would not be.
		expect(inDrop).toBeLessThanOrEqual(14);
	});

	it('reads the bar tagged silent as darkness next to the drop', () => {
		// Energy, not onset counts: an analysis bar can straddle the last fraction of the
		// build, so a leaked onset there is a grid-alignment artefact. What has to hold is
		// that the void reads dark, because that is what the lighting acts on.
		const silent = analysis.bars.filter((b) => b.events.includes('silence'));
		expect(silent.length).toBeGreaterThan(0);
		const quietest = silent.reduce((a, b) => (b.energy < a.energy ? b : a));
		const dropBars = analysis.bars.filter((b) => b.section === 'drop');
		const dropEnergy = dropBars.reduce((n, b) => n + b.energy, 0) / dropBars.length;
		expect(quietest.energy).toBeLessThan(dropEnergy * 0.5);
	});

	it('counts kicks track-wide within 50% of the true number', () => {
		const trueKicks = ARRANGEMENT.reduce((n, s) => n + (s.kick > 0 ? s.bars * 4 : 0), 0);
		expect(analysis.onsets.kick.length).toBeGreaterThan(trueKicks * 0.8);
		expect(analysis.onsets.kick.length).toBeLessThan(trueKicks * 1.5);
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
});

describe('half-tempo material', () => {
	it('does not double the tempo of a 92 bpm boom-bap pattern', () => {
		const slow = synth(92, [
			{ bars: 4, kick: 0, bass: 0, hat: 0, pad: 0.5, riser: false },
			{ bars: 16, kick: 0.9, bass: 0.8, hat: 0.25, pad: 0.5, riser: false }
		]);
		const features = extractFeatures(slow.mono, SR);
		const noveltyN = conditionNovelty(features.novelty, features.featureRate);
		const merged = mergeOnsets(
			[
				{ peaks: pickPeaks(features.kickFlux, features.featureRate, 0.06), weight: 1 },
				{ peaks: pickPeaks(noveltyN, features.featureRate, 0.05), weight: 0.5 }
			],
			features.featureRate
		);
		const coarse = fitBeatGrid(merged.times, merged.weights, slow.duration);
		const env = new Float32Array(features.frameCount);
		for (let f = 0; f < features.frameCount; f++) {
			env[f] = features.kickFlux[f] + 0.1 * noveltyN[f];
		}
		const refined = refineGrid(env, features.featureRate, coarse.bpm, slow.duration);
		expect(Math.abs(refined.bpm - 92)).toBeLessThan(1.5);
	});
});
