import { describe, expect, it } from 'vitest';
import type { BarRow, SectionSpan, TrackAnalysis } from '@mv/core';
import { BUILT_IN_EFFECTS, HIT_RULES, LAYER_ROLES, PHRASE_BARS, barDurationAt } from '@mv/core';
import { composeShow } from './plan.ts';
import { lintShow } from './lint.ts';

/**
 * Boundaries sit on the 4-bar grid because the analyser guarantees that, and the engine reads
 * it as given. The void is the one exception: it is phrase-terminal, so it starts wherever the
 * silence does and it is the drop after it that has to land on the grid.
 */
const PLAN: [number, number, SectionSpan['kind']][] = [
	[0, 8, 'intro'],
	[8, 24, 'groove'],
	[24, 32, 'breakdown'],
	[32, 38, 'build'],
	[38, 40, 'void'],
	[40, 72, 'drop'],
	[72, 88, 'groove'],
	[88, 96, 'build'],
	[96, 120, 'drop'],
	[120, 128, 'outro']
];

function fixture(bpm = 128, drift = 0): TrackAnalysis {
	const beatPeriod = 60 / bpm;
	const barLength = beatPeriod * 4;
	// Deterministic, and irrational enough per bar that no two neighbours are alike.
	const barTimeOf = (bar: number) => {
		let t = 0;
		for (let i = 0; i < bar; i++) t += barLength * (1 + drift * Math.sin(i * 2.399));
		return t;
	};
	const energyOf = (kind: SectionSpan['kind']) =>
		({ intro: 20, groove: 62, breakdown: 30, build: 55, void: 4, drop: 92, outro: 18 })[kind];

	const bars: BarRow[] = [];
	for (const [from, to, kind] of PLAN) {
		for (let b = from; b < to; b++) {
			bars.push({
				bar: b,
				t: barTimeOf(b),
				section: kind,
				energy: energyOf(kind),
				sub: energyOf(kind),
				low: energyOf(kind),
				mid: 40,
				air: kind === 'build' ? 80 : 35,
				kicks: kind === 'drop' || kind === 'groove' ? 4 : 0,
				snares: 2,
				hats: 8,
				events: []
			});
		}
	}

	const sections: SectionSpan[] = PLAN.map(([from, to, kind], index) => ({
		index,
		kind,
		startBar: from,
		endBar: to,
		startTime: barTimeOf(from),
		endTime: barTimeOf(to),
		lengthBars: to - from,
		meanEnergy: energyOf(kind),
		peakEnergy: energyOf(kind),
		// The second drop is the peak; the first is the same kind but ranks below it.
		energyRank: kind === 'drop' ? (from === 96 ? 1 : 2) : 5,
		group: 0,
		repeatOf: null
	}));

	return {
		version: 2,
		hash: 'deadbeefcafe0001',
		trackId: 'file-000000000000',
		title: 'Engine Fixture',
		duration: 128 * barLength,
		sampleRate: 22050,
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
			meterConfidence: 0.9,
			ambiguous: false,
			alternativeBpm: [],
			// `drift` jitters each bar a few per cent either way, which is what a real grid does
			// and what a smooth ramp does not: the caps are read off this table, and a planner
			// that sizes a hit at one bar and places it at another only fails where neighbouring
			// bars fall on OPPOSITE sides of a cap.
			barTimes: Array.from({ length: 129 }, (_, i) => barTimeOf(i))
		},
		key: { tonic: 9, name: 'A minor', mode: 'minor', confidence: 0.8 },
		bars,
		sections,
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
		integratedLufs: -8,
		loudnessRange: 5,
		peakToLoudness: 11
	};
}

const analysis = fixture();
const effects = new Map(BUILT_IN_EFFECTS.map((e) => [e.id, e]));
const show = composeShow(analysis);
const verdict = lintShow(show, { analysis, effects });

const stackOf = (cue: (typeof show.cues)[number]) =>
	LAYER_ROLES.filter((r) => cue.layers[r])
		.map((r) => `${r}:${cue.layers[r]!.effect}`)
		.join(' ');

describe('coverage', () => {
	it('opens at bar 0 and runs in order', () => {
		expect(show.cues[0].bar).toBe(0);
		for (let i = 1; i < show.cues.length; i++) {
			expect(show.cues[i].bar).toBeGreaterThan(show.cues[i - 1].bar);
		}
	});

	it('leaves no bar dark', () => {
		expect(show.cues.at(-1)!.bar).toBeLessThan(analysis.bars.length);
		for (const cue of show.cues) expect(cue.layers).not.toEqual({});
	});

	it('names only effects that exist, in their own role', () => {
		for (const cue of show.cues) {
			for (const role of LAYER_ROLES) {
				const spec = cue.layers[role];
				if (!spec) continue;
				const def = effects.get(spec.effect);
				expect(def, `${spec.effect} at bar ${cue.bar}`).toBeDefined();
				expect(def!.role).toBe(role);
			}
		}
	});

	it('gives every cue a section that matches the analysis', () => {
		for (const cue of show.cues) expect(cue.section).toBe(analysis.bars[cue.bar].section);
	});
});

describe('the linter', () => {
	it('accepts the show without errors', () => {
		expect(verdict.errors.map((e) => `${e.rule}: ${e.message}`)).toEqual([]);
	});

	it('warns about nothing except the effects only a model can write', () => {
		expect(verdict.warnings.map((w) => w.rule)).toEqual(['few-generated-effects']);
	});
});

describe('the arrangement', () => {
	it('changes section only on the phrase grid', () => {
		for (let i = 1; i < show.cues.length; i++) {
			const cue = show.cues[i];
			if (cue.section === show.cues[i - 1].section || cue.section === 'void') continue;
			expect(cue.bar % PHRASE_BARS).toBe(0);
		}
	});

	it('uses the full intensity range', () => {
		const levels = show.cues.map((c) => c.intensity ?? show.defaults.intensity);
		expect(Math.min(...levels)).toBeLessThan(0.35);
		expect(Math.max(...levels)).toBe(1);
	});

	it('spends the top of that range inside the peak section', () => {
		const peak = analysis.sections.find((s) => s.energyRank === 1)!;
		const brightest = show.cues.reduce((a, b) =>
			(b.intensity ?? 0) > (a.intensity ?? 0) ? b : a
		);
		expect(brightest.bar).toBeGreaterThanOrEqual(peak.startBar);
		expect(brightest.bar).toBeLessThan(peak.endBar);
	});

	it('snaps the cues that have to arrive on the downbeat', () => {
		for (const cue of show.cues) {
			if (cue.section === 'drop' || cue.section === 'void') expect(cue.fadeBeats).toBe(0);
		}
	});

	it('holds layers back in a build so the drop has something to add', () => {
		for (let i = 0; i < show.cues.length - 1; i++) {
			if (show.cues[i].section !== 'build') continue;
			const drop = show.cues.slice(i + 1).find((c) => c.section === 'drop');
			if (!drop) continue;
			const count = (c: (typeof show.cues)[number]) => LAYER_ROLES.filter((r) => c.layers[r]).length;
			expect(count(show.cues[i])).toBeLessThan(count(drop));
		}
	});

	it('climbs through a build rather than sitting at one level', () => {
		const builds = show.cues.filter((c) => c.section === 'build');
		for (let i = 1; i < builds.length; i++) {
			if (builds[i].bar - builds[i - 1].bar > 16) continue;
			expect(builds[i].intensity ?? 0).toBeGreaterThanOrEqual(builds[i - 1].intensity ?? 0);
		}
	});

	it('never plays the same stack twice running', () => {
		for (let i = 1; i < show.cues.length; i++) {
			expect(stackOf(show.cues[i])).not.toBe(stackOf(show.cues[i - 1]));
		}
	});

	it('changes the bed often enough that the room changes character', () => {
		const beds = new Set(show.cues.map((c) => c.layers.bed?.effect).filter(Boolean));
		expect(beds.size).toBeGreaterThan(2);
	});

	it('leaves the drum layer out of most cues', () => {
		// One light event per audio event reads as mechanical however well timed it is.
		const withTransient = show.cues.filter((c) => c.layers.transient).length;
		expect(withTransient / show.cues.length).toBeLessThan(0.8);
	});
});

describe('colour', () => {
	it('keeps one identity: a handful of hues, base and accent genuinely apart', () => {
		const hues = new Set<number>([show.palette.base, show.palette.accent]);
		for (const cue of show.cues) {
			if (!cue.palette || cue.palette === 'swap' || cue.palette === 'inherit') continue;
			hues.add(cue.palette.base);
			hues.add(cue.palette.accent);
			if (cue.palette.third !== undefined) hues.add(cue.palette.third);
		}
		expect(hues.size).toBeLessThanOrEqual(6);

		const raw = Math.abs(show.palette.base - show.palette.accent);
		expect(Math.min(raw, 360 - raw)).toBeGreaterThanOrEqual(90);
	});

	it('makes every drop a colour event, and a later one a different event', () => {
		const drops = show.cues.filter((c) => c.section === 'drop' && c.palette !== undefined);
		expect(drops.length).toBeGreaterThan(0);
		for (const cue of drops) expect(cue.palette).not.toBe('inherit');
		// The first inverts; a later one promotes the third hue instead, so it tops the first
		// rather than repeating it.
		const opening = drops.filter((c, i) => i === 0 || drops[i - 1].bar + 16 < c.bar);
		if (opening.length > 1) expect(opening[0].palette).not.toEqual(opening[1].palette);
	});
});

describe('punctuation', () => {
	it('cuts the light in every void', () => {
		for (const span of analysis.sections) {
			if (span.kind !== 'void' || span.startBar < 16) continue;
			expect(show.hits.some((h) => h.kind === 'blackout' && h.bar === span.startBar)).toBe(true);
		}
	});

	it('keeps blackouts where darkness reads as deliberate', () => {
		for (const hit of show.hits) {
			if (hit.kind !== 'blackout') continue;
			expect(['void', 'breakdown', 'outro', 'build']).toContain(analysis.bars[hit.bar].section);
		}
	});

	it('spends nothing big in the opening bars', () => {
		for (const hit of show.hits) expect(hit.bar).toBeGreaterThanOrEqual(16);
	});

	it('strobes out of every build, not just the one before the peak', () => {
		const strobes = show.hits.filter((h) => h.kind === 'strobe');
		const drops = analysis.sections.filter((s) => s.kind === 'drop' && s.startBar >= 16);
		expect(strobes.length).toBeGreaterThanOrEqual(drops.length - 1);
		for (const hit of strobes) expect(hit.params?.perBeat).toBeGreaterThan(0);
	});

	it('slams on every drop downbeat', () => {
		for (const span of analysis.sections) {
			if (span.kind !== 'drop') continue;
			expect(show.hits.some((h) => h.kind === 'slam' && h.bar === span.startBar)).toBe(true);
		}
	});

	it('reports hits in time order', () => {
		for (let i = 1; i < show.hits.length; i++) {
			expect(show.hits[i].bar).toBeGreaterThanOrEqual(show.hits[i - 1].bar);
		}
	});

	it('counts every hit in whole beats and touches a downbeat at one end', () => {
		const { beatsPerBar } = analysis.tempo;
		for (const hit of show.hits) {
			expect(Number.isInteger(hit.beats)).toBe(true);
			const beat = hit.beat ?? 0;
			const end = hit.bar + (beat + hit.beats) / beatsPerBar;
			expect(beat === 0 || Number.isInteger(end)).toBe(true);
		}
	});

	it('runs the held breath before a drop all the way to its downbeat', () => {
		const { beatsPerBar } = analysis.tempo;
		const drops = new Set(analysis.sections.filter((s) => s.kind === 'drop').map((s) => s.startBar));
		for (const hit of show.hits) {
			// Only the ones cut from a build and aimed at a drop. A blackout inside a void is
			// already surrounded by darkness, so where it stops decides nothing.
			if (hit.kind !== 'blackout' || analysis.bars[hit.bar]?.section === 'void') continue;
			if (![...drops].some((b) => b > hit.bar && b - hit.bar <= 2)) continue;
			expect(drops.has(hit.bar + ((hit.beat ?? 0) + hit.beats) / beatsPerBar)).toBe(true);
		}
	});

	it('keeps a blackout short enough to read as a breath rather than a fault', () => {
		for (const hit of show.hits) {
			if (hit.kind !== 'blackout') continue;
			const beat = barDurationAt(analysis.tempo, hit.bar) / analysis.tempo.beatsPerBar;
			expect(hit.beats * beat).toBeLessThanOrEqual(HIT_RULES.blackout.maxSeconds ?? Infinity);
		}
	});

	it('keeps a strobe short enough to still read as punctuation', () => {
		for (const hit of show.hits) {
			if (hit.kind !== 'strobe') continue;
			const bars = hit.beats / analysis.tempo.beatsPerBar;
			expect(bars * barDurationAt(analysis.tempo, hit.bar)).toBeLessThanOrEqual(
				HIT_RULES.strobe.maxSeconds ?? Infinity
			);
		}
	});
});

/**
 * The engine and the linter are the same codebase, so a show the engine writes and the linter
 * refuses is not a difference of opinion, it is a bug. It is also the worst kind: the app
 * discards a rejected show, so the room goes dark with nothing on screen to say why. This
 * happened for real on a 79 bpm track, because the planner sized a strobe against one bar and
 * placed it at another.
 */
describe('the engine never writes a show its own linter refuses', () => {
	const effectMap = new Map(BUILT_IN_EFFECTS.map((e) => [e.id, e]));

	// Slow tempos are where the seconds caps bite, and a drifting grid is where sizing a hit at
	// the wrong bar shows up. 58 bpm with 2% drift is inside the range real tracks reach.
	// 80 bpm puts one bar at exactly the 3 s strobe cap and 110 puts two bars there, which is
	// where an off-by-one-bar measurement shows up at all.
	for (const bpm of [58, 70, 80, 96, 110, 128, 175]) {
		for (const drift of [0, 0.03]) {
			it(`at ${bpm} bpm${drift ? ' on a drifting grid' : ''}`, () => {
				const track = fixture(bpm, drift);
				for (let seed = 0; seed < 12; seed++) {
					const verdict = lintShow(composeShow(track, { seed: 1 + seed * 7919 }), {
						analysis: track,
						effects: effectMap
					});
					expect(verdict.errors.map((e) => `${e.rule}: ${e.message}`)).toEqual([]);
				}
			});
		}
	}
});

describe('determinism', () => {
	it('gives the same show for the same track, every time', () => {
		expect(JSON.stringify(composeShow(analysis))).toBe(JSON.stringify(show));
	});

	it('gives a different show for a different track', () => {
		const other = composeShow({ ...analysis, hash: 'deadbeefcafe0002' });
		expect(JSON.stringify(other)).not.toBe(JSON.stringify(show));
	});

	it('pins the show to the grid it was written against', () => {
		expect(show.analysisHash).toBe(analysis.hash);
	});
});

describe('prose', () => {
	it('writes a brief short enough to read', () => {
		expect(show.brief.length).toBeGreaterThan(80);
		expect(show.brief.length).toBeLessThan(1100);
	});

	it('says why every cue exists, briefly', () => {
		for (const cue of show.cues) {
			expect(cue.note.trim().length).toBeGreaterThan(0);
			expect(cue.note.length).toBeLessThanOrEqual(90);
		}
	});
});

describe('degenerate input', () => {
	it('survives a track with one section', () => {
		const flat: TrackAnalysis = {
			...analysis,
			sections: [{ ...analysis.sections[1], index: 0, startBar: 0, endBar: 128, lengthBars: 128, energyRank: 1 }],
			bars: analysis.bars.map((b) => ({ ...b, section: 'groove' as const }))
		};
		const plain = composeShow(flat);
		expect(plain.cues.length).toBeGreaterThan(0);
		expect(lintShow(plain, { analysis: flat, effects }).errors).toEqual([]);
	});

	it('survives a track with no sections at all', () => {
		const empty: TrackAnalysis = { ...analysis, sections: [], bars: [] };
		const plain = composeShow(empty);
		expect(plain.cues).toEqual([]);
		expect(plain.hits).toEqual([]);
	});
});
