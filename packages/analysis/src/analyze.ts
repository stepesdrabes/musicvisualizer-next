import {
	ANALYSIS_VERSION,
	NUM_BANDS,
	type BarRow,
	type Moment,
	type SectionSpan,
	type TrackAnalysis
} from '@mv/core';
import { extractFeatures } from './features.ts';
import { conditionNovelty, mergeOnsets, peakTimes, pickPeaks, suppressNear } from './onsets.ts';
import {
	MAX_BPM,
	MIN_BPM,
	detectDownbeat,
	fitBeatGrid,
	fitPhraseAnchor,
	refineGrid
} from './beatgrid.ts';
import { barTime, detectStructure, extractBarFeatures, footeNovelty } from './sections.ts';

export interface AnalyzeInput {
	mono: Float32Array;
	sampleRate: number;
	duration: number;
	hash: string;
	integratedLufs: number;
	trackId: string;
	title: string;
	/** Constrain the tempo search to within 5% of a known value. */
	bpmHint?: number;
}

const BEATS_PER_BAR = 4;
const BARS_PER_PHRASE = 8;

export function analyzeTrack(input: AnalyzeInput): TrackAnalysis {
	const { mono, sampleRate, duration } = input;
	const features = extractFeatures(mono, sampleRate);
	const fr = features.featureRate;
	const noveltyN = conditionNovelty(features.novelty, fr);

	// Two passes. A fixed refractory cannot serve both a 90 bpm boom-bap kick and a 175 bpm
	// gabber one, and on a loud limited master a short refractory lets the detector fire at
	// its own limit: the modal gap becomes the refractory itself, which is not a rhythm. So
	// pass one only has to land the tempo within a factor or so, and pass two uses a
	// refractory derived from that beat.
	const roughKicks = pickPeaks(features.kickFlux, fr, 0.12, 0.34);
	const roughMerged = mergeOnsets(
		[
			{ peaks: roughKicks, weight: 1 },
			{ peaks: pickPeaks(noveltyN, fr, 0.05, 0.16), weight: 0.5 }
		],
		fr
	);
	const roughTempo = fitBeatGrid(roughMerged.times, roughMerged.weights, duration);
	const roughBeat = 60 / (input.bpmHint ?? roughTempo.bpm);

	// A hint narrows the search rather than overriding it, so the refiner still finds the exact
	// value and the phase, but cannot wander back to the reading being corrected.
	const minBpm = input.bpmHint ? input.bpmHint * 0.95 : MIN_BPM;
	const maxBpm = input.bpmHint ? input.bpmHint * 1.05 : MAX_BPM;

	// 0.45 of a beat: two kicks per beat is common, three is not, and sixteenth-note kick
	// patterns are rare enough that resolving them is not worth the false positives.
	const kickPeaks = pickPeaks(features.kickFlux, fr, Math.max(0.09, roughBeat * 0.45), 0.34);
	const snarePeaks = pickPeaks(features.snareFlux, fr, Math.max(0.1, roughBeat * 0.45), 0.3);
	// Distorted kicks carry huge high-frequency content, and a snare's own crack sits in the
	// air band, so both would otherwise register as hats.
	const hatPeaks = suppressNear(
		suppressNear(pickPeaks(features.hatFlux, fr, 0.05, 0.16), kickPeaks, fr, 0.03),
		snarePeaks,
		fr,
		0.03
	);
	const broadband = pickPeaks(noveltyN, fr, 0.05, 0.16);

	// Kicks at full weight, broadband at half: broadband catches snare rolls and stabs the
	// kick path is blind to, which stabilises the fit on sparse intros.
	const merged = mergeOnsets(
		[
			{ peaks: kickPeaks, weight: 1 },
			{ peaks: broadband, weight: 0.5 }
		],
		fr
	);

	const coarse = fitBeatGrid(merged.times, merged.weights, duration, minBpm, maxBpm);
	const supportEnvelope = new Float32Array(features.frameCount);
	for (let f = 0; f < features.frameCount; f++) {
		supportEnvelope[f] = features.kickFlux[f] + 0.1 * noveltyN[f];
	}
	const refined = refineGrid(supportEnvelope, fr, coarse.bpm, duration, minBpm, maxBpm);

	const bpm = refined.bpm;
	const beatPeriod = 60 / bpm;
	const firstBeat = refined.firstBeat;
	const beatCount = Math.max(1, Math.floor((duration - firstBeat) / beatPeriod));

	const downbeatPhase = detectDownbeat(
		noveltyN,
		features.snareFlux,
		features.bandDb,
		fr,
		firstBeat,
		beatPeriod,
		beatCount,
		features.frameCount
	);

	const onsets = {
		kick: peakTimes(kickPeaks, fr),
		snare: peakTimes(snarePeaks, fr),
		hat: peakTimes(hatPeaks, fr)
	};

	const bars = extractBarFeatures(
		features,
		noveltyN,
		onsets,
		firstBeat,
		beatPeriod,
		BEATS_PER_BAR,
		downbeatPhase,
		duration
	);

	const phraseAnchorBar = fitPhraseAnchor(footeNovelty(bars), BARS_PER_PHRASE);
	const structure = detectStructure(bars, phraseAnchorBar);

	const barRows: BarRow[] = [];
	for (let b = 0; b < bars.count; b++) {
		const segment = structure.segments.find((s) => b >= s.startBar && b < s.endBar);
		barRows.push({
			bar: b,
			t: round3(bars.time[b]),
			section: segment?.kind ?? 'groove',
			energy: pct(structure.energy[b]),
			sub: pct(structure.bands[b * NUM_BANDS]),
			low: pct(structure.bands[b * NUM_BANDS + 1]),
			mid: pct(structure.bands[b * NUM_BANDS + 2]),
			air: pct(structure.bands[b * NUM_BANDS + 3]),
			kicks: bars.kicks[b],
			snares: bars.snares[b],
			hats: bars.hats[b],
			events: structure.events[b]
		});
	}

	const sections: SectionSpan[] = structure.segments.map((s, index) => {
		let sum = 0;
		let peak = 0;
		for (let b = s.startBar; b < s.endBar; b++) {
			sum += structure.energy[b];
			if (structure.energy[b] > peak) peak = structure.energy[b];
		}
		const len = Math.max(1, s.endBar - s.startBar);
		return {
			index,
			kind: s.kind,
			startBar: s.startBar,
			endBar: s.endBar,
			startTime: round3(bars.time[s.startBar]),
			endTime: round3(
				s.endBar < bars.count
					? bars.time[s.endBar]
					: barTime(firstBeat, beatPeriod, BEATS_PER_BAR, downbeatPhase, s.endBar)
			),
			lengthBars: len,
			meanEnergy: pct(sum / len),
			peakEnergy: pct(peak),
			energyRank: 0,
			repeatOf: null
		};
	});

	// Ranked by MEAN, not peak: a long mid-energy verse containing one loud bar would otherwise
	// outrank a short chorus that is loud the whole way through.
	[...sections]
		.sort((a, b) => b.meanEnergy - a.meanEnergy || b.peakEnergy - a.peakEnergy)
		.forEach((s, i) => {
			sections[s.index].energyRank = i + 1;
		});

	markRepeats(sections, bars);

	const moments = buildMoments(barRows, sections);

	return {
		version: ANALYSIS_VERSION,
		hash: input.hash,
		trackId: input.trackId,
		title: input.title,
		duration: round3(duration),
		sampleRate,
		tempo: {
			bpm: round3(bpm),
			confidence: round3(coarse.confidence),
			firstBeat: round3(firstBeat),
			beatPeriod: round3(beatPeriod),
			beatsPerBar: BEATS_PER_BAR,
			downbeatPhase,
			phraseAnchorBar: structure.phraseAnchorBar,
			barsPerPhrase: BARS_PER_PHRASE
		},
		bars: barRows,
		sections,
		moments,
		onsets: {
			kick: onsets.kick.map(round3),
			snare: onsets.snare.map(round3),
			hat: onsets.hat.map(round3)
		},
		integratedLufs: round1(input.integratedLufs)
	};
}

/** Cosine similarity on bar-mean spectra, so "chorus 2 repeats chorus 1" is stated. */
function markRepeats(sections: SectionSpan[], bars: ReturnType<typeof extractBarFeatures>): void {
	const profile = (s: SectionSpan): Float32Array => {
		const v = new Float32Array(NUM_BANDS);
		for (let b = s.startBar; b < s.endBar; b++) {
			for (let k = 0; k < NUM_BANDS; k++) v[k] += bars.bandDb[b * NUM_BANDS + k];
		}
		const len = Math.max(1, s.endBar - s.startBar);
		for (let k = 0; k < NUM_BANDS; k++) v[k] /= len;
		return v;
	};

	const profiles = sections.map(profile);
	for (let i = 1; i < sections.length; i++) {
		let bestJ = -1;
		let bestSim = 0.995;
		for (let j = 0; j < i; j++) {
			if (sections[j].kind !== sections[i].kind) continue;
			let dot = 0;
			let na = 0;
			let nb = 0;
			for (let k = 0; k < NUM_BANDS; k++) {
				dot += profiles[i][k] * profiles[j][k];
				na += profiles[i][k] ** 2;
				nb += profiles[j][k] ** 2;
			}
			const sim = dot / (Math.sqrt(na * nb) + 1e-9);
			if (sim > bestSim) {
				bestSim = sim;
				bestJ = j;
			}
		}
		if (bestJ >= 0) sections[i].repeatOf = bestJ;
	}
}

function buildMoments(rows: BarRow[], sections: SectionSpan[]): Moment[] {
	const out: Moment[] = [];

	for (const s of sections) {
		out.push({
			bar: s.startBar,
			beat: 0,
			t: s.startTime,
			kind: 'section_start',
			note: `${s.kind} begins, ${s.lengthBars} bars, energy ${s.meanEnergy}${
				s.energyRank === 1 ? ', the peak of the track' : ''
			}${s.repeatOf !== null ? `, repeats section ${s.repeatOf}` : ''}`
		});
	}

	for (const row of rows) {
		for (const ev of row.events) {
			if (ev === 'riser' || ev === 'snare_roll') continue;
			out.push({
				bar: row.bar,
				beat: 0,
				t: row.t,
				kind: ev,
				note: describe(ev, row)
			});
		}
	}

	out.sort((a, b) => a.t - b.t || a.bar - b.bar);
	return out;
}

function describe(ev: string, row: BarRow): string {
	switch (ev) {
		case 'drop_downbeat':
			return `energy ${row.energy}, sub ${row.sub}`;
		case 'silence':
			return 'near-silence: the void before the drop';
		case 'crash':
			return `cymbal crash, air ${row.air}`;
		case 'kick_in':
			return 'the kick arrives';
		case 'kick_out':
			return 'the kick drops out';
		case 'bass_in':
			return 'bass enters';
		case 'bass_out':
			return 'bass withdraws';
		default:
			return '';
	}
}

function pct(v: number): number {
	return Math.round(v * 100);
}

function round3(v: number): number {
	return Math.round(v * 1000) / 1000;
}

function round1(v: number): number {
	return Math.round(v * 10) / 10;
}
