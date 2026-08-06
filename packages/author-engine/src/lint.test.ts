import { describe, expect, it } from 'vitest';
import type { BarRow, EffectDef, SectionSpan, Show, TrackAnalysis } from '@mv/core';
import { BUILT_IN_EFFECTS } from '@mv/core';
import { lintShow, type LintResult } from './lint.ts';

const effects = new Map<string, EffectDef>(BUILT_IN_EFFECTS.map((e) => [e.id, e]));

/** 64 bars at 128 bpm: intro 0-7, groove 8-23, build 24-30, void 31, drop 32-55, outro 56-63. */
function fixture(): TrackAnalysis {
	const beatPeriod = 60 / 128;
	const barLength = beatPeriod * 4;
	const plan: [number, number, SectionSpan['kind']][] = [
		[0, 8, 'intro'],
		[8, 24, 'groove'],
		[24, 31, 'build'],
		[31, 32, 'void'],
		[32, 56, 'drop'],
		[56, 64, 'outro']
	];

	const bars: BarRow[] = [];
	for (const [from, to, kind] of plan) {
		for (let b = from; b < to; b++) {
			const energy = kind === 'drop' ? 95 : kind === 'groove' ? 60 : kind === 'build' ? 55 : 8;
			bars.push({
				bar: b,
				t: b * barLength,
				section: kind,
				energy,
				sub: kind === 'drop' ? 98 : 40,
				low: 50,
				mid: 50,
				air: kind === 'build' ? 90 : 40,
				kicks: kind === 'void' || kind === 'intro' ? 0 : 4,
				snares: 2,
				hats: 8,
				events: kind === 'void' ? ['silence'] : []
			});
		}
	}

	const sections: SectionSpan[] = plan.map(([from, to, kind], index) => ({
		index,
		kind,
		startBar: from,
		endBar: to,
		startTime: from * barLength,
		endTime: to * barLength,
		lengthBars: to - from,
		meanEnergy: bars[from].energy,
		peakEnergy: bars[from].energy,
		energyRank: kind === 'drop' ? 1 : index + 2,
		repeatOf: null
	}));

	return {
		version: 2,
		hash: 'deadbeef',
		trackId: 'file-000000000000',
		title: 'Fixture',
		duration: 64 * barLength,
		sampleRate: 44100,
		tempo: {
			bpm: 128,
			confidence: 0.8,
			firstBeat: 0,
			beatPeriod,
			beatsPerBar: 4,
			downbeatPhase: 0,
			phraseAnchorBar: 0,
			barsPerPhrase: 8,
			constant: true,
			meterConfidence: 0.9
		},
		key: { tonic: 0, name: 'C minor', mode: 'minor', confidence: 0.7 },
		bars,
		sections,
		moments: [],
		beats: [],
		stereo: { fps: 25, pan: [], width: [] },
		onsets: { kick: [], snare: [], hat: [] },
		integratedLufs: -14,
		loudnessRange: 6,
		peakToLoudness: 12
	};
}

const analysis = fixture();

function goodShow(): Show {
	return {
		version: 2,
		trackId: analysis.trackId,
		title: analysis.title,
		analysisHash: analysis.hash,
		brief: 'Magenta room, cyan drop. Void at 31 is cut hard. Slam reserved for bar 32.',
		palette: { base: 320, accent: 185, sat: 0.94, shade: 0.08, white: 0.06 },
		defaults: { intensity: 0.8, motion: 1, fadeBeats: 8 },
		generatedEffects: [],
		cues: [
			{
				bar: 0,
				section: 'intro',
				layers: { bed: { effect: 'wash' } },
				intensity: 0.3,
				note: 'Barely there.'
			},
			{
				bar: 8,
				section: 'groove',
				layers: { bed: { effect: 'wash' }, rhythm: { effect: 'pump' } },
				intensity: 0.7,
				note: 'Sidechain duck is the groove.'
			},
			{
				bar: 16,
				section: 'groove',
				layers: {
					bed: { effect: 'wash' },
					rhythm: { effect: 'chase' },
					accent: { effect: 'sparkle' }
				},
				intensity: 0.75,
				note: 'Lift into the build.'
			},
			{
				bar: 24,
				section: 'build',
				layers: { rhythm: { effect: 'riser' } },
				intensity: 0.8,
				note: 'Strip to one layer; the ring is the progress bar.'
			},
			{
				bar: 31,
				section: 'void',
				layers: { bed: { effect: 'blackout' } },
				intensity: 0.02,
				fadeBeats: 0,
				note: 'Cut with the bass.'
			},
			{
				bar: 32,
				section: 'drop',
				layers: {
					bed: { effect: 'wash' },
					rhythm: { effect: 'pump' },
					transient: { effect: 'shockwave' },
					accent: { effect: 'sparkle' }
				},
				palette: 'swap',
				intensity: 1,
				fadeBeats: 0,
				note: 'Everything, in cyan, on the downbeat.'
			},
			{
				bar: 40,
				section: 'drop',
				layers: {
					bed: { effect: 'wash' },
					rhythm: { effect: 'comet' },
					transient: { effect: 'splash' }
				},
				palette: 'swap',
				intensity: 0.95,
				note: 'Same energy, different shape.'
			},
			{
				bar: 56,
				section: 'outro',
				layers: { bed: { effect: 'wash' } },
				intensity: 0.25,
				note: 'Let it go.'
			}
		],
		hits: [
			{ bar: 32, beat: 0, kind: 'slam', beats: 1, note: 'The blinder.' },
			{ bar: 48, beat: 0, kind: 'strobe', beats: 2, params: { perBeat: 2 }, note: 'Second peak.' }
		]
	};
}

function rules(result: LintResult): string[] {
	return [...result.errors, ...result.warnings].map((f) => f.rule);
}

describe('a well-formed show', () => {
	const result = lintShow(goodShow(), { analysis, effects });

	it('passes with no errors', () => {
		expect(result.errors).toEqual([]);
	});

	it('does not warn about the things it got right', () => {
		const noisy = rules(result).filter((r) =>
			['too-many-hues', 'palette-no-contrast', 'peak-not-brightest', 'no-brief'].includes(r)
		);
		expect(noisy).toEqual([]);
	});
});

describe('grid rules', () => {
	it('rejects a bar outside the analysed grid', () => {
		const show = goodShow();
		show.cues[1].bar = 900;
		expect(rules(lintShow(show, { analysis, effects }))).toContain('bar-out-of-grid');
	});

	it('rejects a stale analysis hash', () => {
		const show = goodShow();
		show.analysisHash = 'notthehash';
		expect(rules(lintShow(show, { analysis, effects }))).toContain('stale-analysis');
	});

	it('rejects a section change off the 4-bar grid', () => {
		const show = goodShow();
		show.cues[3].bar = 25;
		expect(rules(lintShow(show, { analysis, effects }))).toContain('off-phrase-change');
	});

	it('rejects two cues on one bar', () => {
		const show = goodShow();
		show.cues[2].bar = 8;
		expect(rules(lintShow(show, { analysis, effects }))).toContain('duplicate-bar');
	});
});

describe('effect rules', () => {
	it('rejects an unknown effect', () => {
		const show = goodShow();
		show.cues[1].layers.rhythm = { effect: 'discoInferno' };
		expect(rules(lintShow(show, { analysis, effects }))).toContain('unknown-effect');
	});

	it('rejects a bed effect in the rhythm slot', () => {
		const show = goodShow();
		show.cues[1].layers.rhythm = { effect: 'wash' };
		expect(rules(lintShow(show, { analysis, effects }))).toContain('role-mismatch');
	});

	it('warns when an effect is used outside its intended sections', () => {
		const show = goodShow();
		show.cues[0].layers.rhythm = { effect: 'riser' };
		expect(rules(lintShow(show, { analysis, effects }))).toContain('effect-out-of-place');
	});

	it('warns about an unknown param', () => {
		const show = goodShow();
		show.cues[1].layers.rhythm = { effect: 'pump', params: { sparkliness: 1 } };
		expect(rules(lintShow(show, { analysis, effects }))).toContain('unknown-param');
	});

	it('warns when adjacent cues repeat an identical stack', () => {
		const show = goodShow();
		show.cues[2].layers = { ...show.cues[1].layers };
		expect(rules(lintShow(show, { analysis, effects }))).toContain('repeated-stack');
	});
});

describe('safety rules', () => {
	it('does not limit the flash rate, the strobe length or the strobe budget', () => {
		// Deliberate: this room is one person's, and a linter that refuses the biggest card in
		// the deck is a linter people route around. Anyone fitting this in a public space owns
		// that decision.
		const show = goodShow();
		show.hits = [
			{ bar: 40, kind: 'strobe', beats: 32, params: { perBeat: 8 }, note: 'as fast and long as it likes' },
			{ bar: 44, kind: 'strobe', beats: 16, params: { perBeat: 8 }, note: 'and again' }
		];
		const found = rules(lintShow(show, { analysis, effects }));
		expect(found).not.toContain('flash-rate');
		expect(found).not.toContain('flash-danger-band');
		expect(found).not.toContain('strobe-too-long');
		expect(found).not.toContain('strobe-budget');
		expect(found).not.toContain('strobe-too-frequent');
	});

	it('warns about spending the blinder in the first 16 bars', () => {
		const show = goodShow();
		show.hits[0].bar = 4;
		expect(rules(lintShow(show, { analysis, effects }))).toContain('early-punctuation');
	});

	it('rejects a blackout longer than two bars', () => {
		const show = goodShow();
		show.hits.push({ bar: 31, kind: 'blackout', beats: 20 });
		expect(rules(lintShow(show, { analysis, effects }))).toContain('blackout-too-long');
	});

	it('warns about a blackout dropped into a drop', () => {
		const show = goodShow();
		show.hits.push({ bar: 40, kind: 'blackout', beats: 1 });
		expect(rules(lintShow(show, { analysis, effects }))).toContain('blackout-placement');
	});
});

describe('taste rules', () => {
	it('warns when the brightest cue is not in the peak section', () => {
		const show = goodShow();
		show.cues[1].intensity = 1;
		show.cues[5].intensity = 0.6;
		show.cues[6].intensity = 0.6;
		expect(rules(lintShow(show, { analysis, effects }))).toContain('peak-not-brightest');
	});

	it('warns when a build runs as many layers as its drop', () => {
		const show = goodShow();
		show.cues[3].layers = {
			bed: { effect: 'wash' },
			rhythm: { effect: 'riser' },
			transient: { effect: 'splash' },
			accent: { effect: 'sparkle' }
		};
		expect(rules(lintShow(show, { analysis, effects }))).toContain('build-not-stripped');
	});

	it('warns once the room has visited too many hues to have one of its own', () => {
		const show = goodShow();
		show.palette.third = 60;
		show.cues[1].palette = { base: 30, accent: 210, third: 120 };
		show.cues[2].palette = { base: 15, accent: 195, third: 105 };
		expect(rules(lintShow(show, { analysis, effects }))).toContain('too-many-hues');
	});

	it('warns when base and accent have no contrast', () => {
		const show = goodShow();
		show.palette = { base: 320, accent: 330 };
		expect(rules(lintShow(show, { analysis, effects }))).toContain('palette-no-contrast');
	});

	it('warns when transients fire in nearly every cue', () => {
		const show = goodShow();
		for (const cue of show.cues) cue.layers.transient = { effect: 'splash' };
		expect(rules(lintShow(show, { analysis, effects }))).toContain('monotonous-transients');
	});

	it('warns when no cue documents itself', () => {
		const show = goodShow();
		for (const cue of show.cues) cue.note = '';
		expect(rules(lintShow(show, { analysis, effects }))).toContain('undocumented-cue');
	});

	it('warns when the brief rambles', () => {
		const show = goodShow();
		show.brief = 'x'.repeat(2000);
		expect(rules(lintShow(show, { analysis, effects }))).toContain('brief-too-long');
	});

	it('warns when cue notes run long', () => {
		const show = goodShow();
		show.cues[1].note = 'This cue exists because '.repeat(8);
		expect(rules(lintShow(show, { analysis, effects }))).toContain('notes-too-long');
	});

	it('warns when barely any effects were written for the track', () => {
		expect(rules(lintShow(goodShow(), { analysis, effects }))).toContain(
			'few-generated-effects'
		);
	});

	it('warns about a missing brief', () => {
		const show = goodShow();
		show.brief = '';
		expect(rules(lintShow(show, { analysis, effects }))).toContain('no-brief');
	});
});
