import { describe, expect, it } from 'vitest';
import type { Show, TrackAnalysis } from '@mv/core';
import { activeCue, buildTimeline, densityColumns } from './timeline.ts';

const beatPeriod = 60 / 120;

function analysis(): TrackAnalysis {
	return {
		version: 4,
		hash: 'h',
		trackId: 'file-000000000000',
		title: 'T',
		duration: 64 * beatPeriod * 4,
		sampleRate: 22050,
		tempo: {
			bpm: 120,
			confidence: 0.9,
			firstBeat: 0,
			beatPeriod,
			beatsPerBar: 4,
			downbeatPhase: 0,
			phraseAnchorBar: 0,
			barsPerPhrase: 8,
			constant: true,
			meterConfidence: 0.9,
			ambiguous: false,
			alternativeBpm: [],
			barTimes: Array.from({ length: 65 }, (_, i) => i * beatPeriod * 4)
		},
		key: { tonic: 0, name: 'C minor', mode: 'minor', confidence: 0.7 },
		bars: [],
		sections: [
			{
				index: 0,
				kind: 'groove',
				startBar: 0,
				endBar: 16,
				startTime: 0,
				endTime: 32,
				lengthBars: 16,
				meanEnergy: 60,
				peakEnergy: 70,
				energyRank: 2,
				group: 0,
				repeatOf: null
			},
			{
				index: 1,
				kind: 'drop',
				startBar: 16,
				endBar: 32,
				startTime: 32,
				endTime: 64,
				lengthBars: 16,
				meanEnergy: 95,
				peakEnergy: 99,
				energyRank: 1,
				group: 0,
				repeatOf: 0
			}
		],
		moments: [],
		beats: [],
		envelopes: { energy: [], bands: [] },
		spectrum: { fps: 50, bands: 0, centreHz: [], data: '' },
		stereo: { fps: 25, pan: [], width: [] },
		onsets: {
			kick: { times: [], levels: [] },
			snare: { times: [], levels: [] },
			hat: { times: [], levels: [] }
		},
		integratedLufs: -9,
		loudnessRange: 6,
		peakToLoudness: 12
	};
}

function show(): Show {
	return {
		version: 1,
		trackId: 'file-000000000000',
		title: 'T',
		analysisHash: 'h',
		brief: 'b',
		palette: { base: 200, accent: 20 },
		defaults: { intensity: 0.7, motion: 1, fadeBeats: 2 },
		generatedEffects: [],
		// Deliberately out of order: nothing promises the show stores them sorted.
		cues: [
			{ bar: 16, section: 'drop', layers: { bed: { effect: 'wash' } }, intensity: 1, note: 'drop' },
			{ bar: 0, section: 'groove', layers: { bed: { effect: 'aurora' } }, note: 'open' }
		],
		hits: [
			{ bar: 16, kind: 'slam', beats: 4, note: 'lands' },
			{ bar: 14, kind: 'strobe', beats: 8, params: { perBeat: 4 }, note: 'out of the build' }
		]
	};
}

describe('buildTimeline', () => {
	const t = buildTimeline(analysis(), show(), 128);

	it('puts cues in bar order whatever order the show stored them', () => {
		expect(t.cues.map((c) => c.bar)).toEqual([0, 16]);
	});

	it('runs each cue up to the next one, and the last to the end', () => {
		expect(t.cues[0].start).toBeCloseTo(0, 6);
		expect(t.cues[0].end).toBeCloseTo(t.cues[1].start, 6);
		expect(t.cues[1].end).toBe(128);
	});

	it('places a hit at its own bar, not at the cue that contains it', () => {
		const strobe = t.markers.find((m) => m.kind === 'strobe')!;
		// Bar 14 at 120 bpm in 4/4: 14 bars of two seconds each.
		expect(strobe.start).toBeCloseTo(28, 6);
	});

	it('gives a hit a length so a long strobe reads as long', () => {
		const strobe = t.markers.find((m) => m.kind === 'strobe')!;
		const slam = t.markers.find((m) => m.kind === 'slam')!;
		expect(strobe.end - strobe.start).toBeCloseTo(4, 6);
		expect(slam.end - slam.start).toBeCloseTo(2, 6);
	});

	it('orders markers by time', () => {
		expect(t.markers.map((m) => m.kind)).toEqual(['strobe', 'slam']);
	});

	it('names the peak in the section it belongs to', () => {
		expect(t.sections[1].lines.join(' ')).toContain('the peak');
		expect(t.sections[0].lines.join(' ')).not.toContain('the peak');
	});

	it('lists a cue’s layers and falls back to the show default intensity', () => {
		expect(t.cues[0].lines).toContain('bed: aurora');
		expect(t.cues[0].intensity).toBe(0.7);
		expect(t.cues[1].intensity).toBe(1);
	});

	it('says nothing at all without an analysis or a duration', () => {
		expect(buildTimeline(null, show(), 128).cues).toEqual([]);
		expect(buildTimeline(analysis(), show(), 0).sections).toEqual([]);
	});

	it('still describes the arrangement when no show exists yet', () => {
		const bare = buildTimeline(analysis(), null, 128);
		expect(bare.sections).toHaveLength(2);
		expect(bare.cues).toEqual([]);
	});
});

describe('activeCue', () => {
	it('finds the cue holding the room, not the one stored last', () => {
		// The fixture lists bar 16 before bar 0, which is what a reverse-and-find gets wrong.
		expect(activeCue(show(), 20)?.bar).toBe(16);
		expect(activeCue(show(), 4)?.bar).toBe(0);
	});

	it('takes the cue that starts exactly on the bar being asked about', () => {
		expect(activeCue(show(), 16)?.bar).toBe(16);
	});

	it('has no answer before the first cue, or without a show', () => {
		const early: Show = { ...show(), cues: [{ ...show().cues[0], bar: 8 }] };
		expect(activeCue(early, 4)).toBeUndefined();
		expect(activeCue(null, 4)).toBeUndefined();
	});
});

describe('densityColumns', () => {
	it('counts onsets into the column they fall in', () => {
		const counts = densityColumns([0, 0.05, 5, 9.99], 10, 10);
		expect(counts[0]).toBe(2);
		expect(counts[5]).toBe(1);
		expect(counts[9]).toBe(1);
	});

	it('drops anything outside the track rather than folding it to an edge', () => {
		const counts = densityColumns([-1, 11], 10, 10);
		expect(Array.from(counts).reduce((a, b) => a + b, 0)).toBe(0);
	});
});
