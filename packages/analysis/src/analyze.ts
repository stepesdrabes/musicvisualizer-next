import {
	ANALYSIS_VERSION,
	NUM_BANDS,
	type BarRow,
	type Moment,
	type SectionSpan,
	type TrackAnalysis
} from '@mv/core';
import { arrange } from './arrange.ts';
import { detectBeats, type BeatGrid } from './beats.ts';
import { beatSynchronous } from './beatsync.ts';
import { chromagram, estimateKey } from './chroma.ts';
import { detectDrums } from './drums.ts';
import { extractFeatures } from './features.ts';
import { detectMeter, type Meter } from './downbeats.ts';
import { assessMetricalLevel } from './metricalLevel.ts';
import { measureLoudness } from './loudness.ts';
import { quantiseOnsets } from './quantise.ts';
import { analyseStereo } from './stereo.ts';
import { barSynchronous, groupSegments, segmentBars, similarityMatrix } from './structure.ts';

export interface AnalyzeInput {
	mono: Float32Array;
	/** Both channels, when the caller has them. Without these there is no stereo image. */
	left?: Float32Array;
	right?: Float32Array;
	sampleRate: number;
	duration: number;
	/** Of the decoded audio, so a show can be pinned to the exact bytes it was written for. */
	hash: string;
	trackId: string;
	title: string;
	/** Constrain the tempo search to within 6% of a known value. */
	bpmHint?: number;
	/**
	 * Beat and downbeat times from a tracker that has already run, seconds.
	 *
	 * Passed in rather than fetched here because the model is asynchronous and this is not, and
	 * because the caller is the right place to decide whether a 79 MB graph is worth loading.
	 * When absent the in-repo tracker runs instead, so the pipeline still works with no model
	 * on disk.
	 */
	beats?: readonly number[];
	downbeats?: readonly number[];
}

const TARGET_LUFS = -14;
/** What a silent track reports rather than negative infinity, which is not JSON. */
const SILENCE_LUFS = -70;
const BARS_PER_PHRASE = 8;

export function analyzeTrack(input: AnalyzeInput): TrackAnalysis {
	const { sampleRate, duration } = input;

	// Loudness is measured on the mono stream that is actually analysed. Measuring the stereo
	// original instead, which is what asking ffmpeg would give, is up to 3 dB out depending on
	// how correlated the channels are.
	const loudness = measureLoudness(input.mono, sampleRate);

	// Normalise before anything else, so a threshold means the same thing on a track mastered
	// in 1996 as on one mastered last week.
	const mono = Float32Array.from(input.mono);
	const gain = Math.pow(10, (TARGET_LUFS - loudness.integrated) / 20);
	if (Number.isFinite(gain) && Math.abs(gain - 1) > 0.01) {
		const g = Math.min(gain, 40);
		for (let i = 0; i < mono.length; i++) mono[i] *= g;
	}

	const stereo =
		input.left && input.right
			? analyseStereo(input.left, input.right, sampleRate)
			: { fps: 25, pan: new Float32Array(0), width: new Float32Array(0) };

	const features = extractFeatures(mono, sampleRate);
	const chroma = chromagram(mono, sampleRate);
	const grid =
		input.beats && input.beats.length > 8
			? gridFromBeats(input.beats, features.odf, features.curves.fps)
			: detectBeats(features.odf, features.curves.fps, duration, { bpmHint: input.bpmHint });

	const beatFeatures = beatSynchronous(
		features.spec,
		chroma,
		features.curves,
		features.odf,
		grid.beats,
		duration
	);
	// A tracker that emits downbeats has already answered the question `detectMeter` asks, and
	// answers it far better: 0.722 downbeat F against 0.498 on the same 100 annotated tracks.
	const meter =
		input.downbeats && input.downbeats.length > 2
			? meterFromDownbeats(grid.beats, input.downbeats)
			: detectMeter(beatFeatures);
	const bars = barSynchronous(beatFeatures, meter.beatsPerBar, meter.phase);

	const detected = detectDrums(features.spec, { beatPeriod: grid.beatPeriod });
	// Snapped to the grid and completed, because a missed kick reads as a missed flash and the
	// music put it exactly where the grid says.
	const quantise = (times: number[]) =>
		quantiseOnsets(times, {
			beats: grid.beats,
			beatsPerBar: meter.beatsPerBar,
			downbeatPhase: meter.phase,
			duration
		});
	const drums = {
		kick: quantise(detected.kick).times,
		snare: quantise(detected.snare).times,
		hat: quantise(detected.hat).times
	};
	const kicks = countPerBar(drums.kick, bars.time, bars.count);
	const snares = countPerBar(drums.snare, bars.time, bars.count);
	const hats = countPerBar(drums.hat, bars.time, bars.count);

	const sim = similarityMatrix(bars);
	const bounds = segmentBars(sim, bars.count);
	const groups = groupSegments(sim, bars.count, bounds);

	const plan = arrange(
		features.spec,
		bars,
		bounds,
		groups,
		loudness.shortTerm,
		loudness.shortTermFps,
		kicks,
		snares
	);

	// One array decides where every bar is. `bars[].t` is written from it below rather than
	// computed alongside it, because two independent copies of the same timing is exactly how
	// the grid and the bar table came to disagree by eight beats on a track that speeds up.
	const barTimes = Array.from(bars.time.subarray(0, bars.count + 1), round3);

	const barRows: BarRow[] = [];
	for (let b = 0; b < bars.count; b++) {
		const segment = plan.segments.find((s) => b >= s.startBar && b < s.endBar);
		barRows.push({
			bar: b,
			t: barTimes[b],
			section: segment?.kind ?? 'groove',
			energy: pct(plan.energy[b]),
			sub: pct(plan.bands[b * NUM_BANDS]),
			low: pct(plan.bands[b * NUM_BANDS + 1]),
			mid: pct(plan.bands[b * NUM_BANDS + 2]),
			air: pct(plan.bands[b * NUM_BANDS + 3]),
			kicks: kicks[b],
			snares: snares[b],
			hats: hats[b],
			events: plan.events[b]
		});
	}

	const sections: SectionSpan[] = plan.segments.map((s, index) => {
		let sum = 0;
		let peak = 0;
		for (let b = s.startBar; b < s.endBar; b++) {
			sum += plan.energy[b];
			if (plan.energy[b] > peak) peak = plan.energy[b];
		}
		const len = Math.max(1, s.endBar - s.startBar);
		return {
			index,
			kind: s.kind,
			startBar: s.startBar,
			endBar: s.endBar,
			startTime: barTimes[s.startBar],
			endTime: barTimes[Math.min(s.endBar, bars.count)],
			lengthBars: len,
			meanEnergy: pct(sum / len),
			peakEnergy: pct(peak),
			energyRank: 0,
			group: s.group,
			// Derived here from the group rather than carried through arrange(), because every
			// fold, merge and void splice shifts the indices and the old stored value silently
			// came to point at a different section.
			repeatOf: null
		};
	});

	const firstOfGroup = new Map<number, number>();
	for (const s of sections) {
		if (s.group < 0) continue;
		const first = firstOfGroup.get(s.group);
		if (first === undefined) firstOfGroup.set(s.group, s.index);
		else s.repeatOf = first;
	}

	// Ranked by mean, not peak: a long mid-energy verse containing one loud bar would
	// otherwise outrank a short chorus that is loud the whole way through.
	[...sections]
		.sort((a, b) => b.meanEnergy - a.meanEnergy || b.peakEnergy - a.peakEnergy)
		.forEach((s, i) => {
			sections[s.index].energyRank = i + 1;
		});

	const key = estimateKey(chroma);

	return {
		version: ANALYSIS_VERSION,
		hash: input.hash,
		trackId: input.trackId,
		title: input.title,
		duration: round3(duration),
		sampleRate,
		tempo: {
			bpm: round3(grid.bpm),
			confidence: round2(grid.confidence),
			// Six decimals, not three. The player multiplies the period by the bar index, so a
			// millisecond of rounding is eighty by the end of a four-minute track, which is a
			// visible desync arriving gradually enough that nothing looks obviously broken.
			firstBeat: round6(grid.firstBeat),
			beatPeriod: round6(grid.beatPeriod),
			beatsPerBar: meter.beatsPerBar,
			downbeatPhase: meter.phase,
			phraseAnchorBar: plan.phraseAnchorBar,
			barsPerPhrase: BARS_PER_PHRASE,
			constant: grid.constant,
			meterConfidence: round2(meter.confidence),
			barTimes
		},
		key: {
			tonic: key.tonic,
			name: key.name,
			mode: key.mode,
			confidence: round2(key.confidence)
		},
		bars: barRows,
		sections,
		moments: buildMoments(barRows, sections),
		beats: Array.from(grid.beats, round3),
		stereo: {
			fps: round3(stereo.fps),
			pan: Array.from(stereo.pan, round2),
			width: Array.from(stereo.width, round2)
		},
		onsets: {
			kick: drums.kick.map(round3),
			snare: drums.snare.map(round3),
			hat: drums.hat.map(round3)
		},
		integratedLufs: round1(Math.max(loudness.integrated, SILENCE_LUFS)),
		loudnessRange: round1(loudness.range),
		peakToLoudness: round1(Number.isFinite(loudness.peakToLoudness) ? loudness.peakToLoudness : 0)
	};
}

/**
 * A grid from beat times somebody else found.
 *
 * `constant` reports whether one period would describe the whole track, which is a description
 * of the music rather than a switch: `barTimes` is the authority either way. The threshold is
 * generous because a tracked sequence always has a little jitter that a fitted grid cannot.
 */
function gridFromBeats(beats: readonly number[], odf: Float32Array, fps: number): BeatGrid {
	const times = Float64Array.from(beats);
	const assessment = assessMetricalLevel(beats, odf, fps);
	const period = assessment.bpm > 0 ? 60 / assessment.bpm : 0.5;

	const local: number[] = [];
	for (let i = 0; i + 16 < times.length; i += 16) local.push((60 * 16) / (times[i + 16] - times[i]));
	local.sort((a, b) => a - b);
	const spread =
		local.length >= 4
			? (local[Math.floor(local.length * 0.9)] - local[Math.floor(local.length * 0.1)]) /
				local[local.length >> 1]
			: 0;

	return {
		bpm: assessment.bpm,
		beatPeriod: period,
		firstBeat: times[0] ?? 0,
		beats: times,
		constant: spread <= 0.01,
		// The level is the doubtful part, not the phase, so the assessment is what this reports.
		confidence: assessment.confidence
	};
}

/** Beats per bar and phase from a downbeat list, by the commonest spacing along the beats. */
function meterFromDownbeats(beats: Float64Array, downbeats: readonly number[]): Meter {
	const indexOf = (t: number): number => {
		let lo = 0;
		let hi = beats.length - 1;
		while (hi - lo > 1) {
			const mid = (lo + hi) >> 1;
			if (beats[mid] <= t) lo = mid;
			else hi = mid;
		}
		return Math.abs(beats[lo] - t) <= Math.abs(beats[hi] - t) ? lo : hi;
	};

	const indices = downbeats.map(indexOf).sort((a, b) => a - b);
	const gaps = new Map<number, number>();
	for (let i = 1; i < indices.length; i++) {
		const g = indices[i] - indices[i - 1];
		if (g >= 2 && g <= 12) gaps.set(g, (gaps.get(g) ?? 0) + 1);
	}
	let beatsPerBar = 4;
	let best = 0;
	for (const [g, n] of gaps) {
		if (n > best) {
			best = n;
			beatsPerBar = g;
		}
	}

	// The phase the most downbeats already agree with, which is the only thing a residue class
	// can mean once the spacing is fixed.
	const votes = new Int32Array(beatsPerBar);
	for (const i of indices) votes[((i % beatsPerBar) + beatsPerBar) % beatsPerBar]++;
	let phase = 0;
	for (let p = 1; p < beatsPerBar; p++) if (votes[p] > votes[phase]) phase = p;

	const total = indices.length || 1;
	return { beatsPerBar, phase, confidence: Math.max(0, Math.min(1, votes[phase] / total)) };
}

function countPerBar(times: readonly number[], barTime: Float64Array, count: number): Int32Array {
	const out = new Int32Array(count);
	let i = 0;
	for (let b = 0; b < count; b++) {
		const to = barTime[b + 1];
		while (i < times.length && times[i] < barTime[b]) i++;
		let n = 0;
		while (i + n < times.length && times[i + n] < to) n++;
		out[b] = n;
	}
	return out;
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

	// Risers and snare rolls are per-bar colour inside a build, not moments in their own
	// right; listing every one of them buries the handful that are worth a cue.
	for (const row of rows) {
		for (const ev of row.events) {
			if (ev === 'riser' || ev === 'snare_roll') continue;
			out.push({ bar: row.bar, beat: 0, t: row.t, kind: ev, note: describe(ev, row) });
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
		case 'filter_sweep':
			return `brightness opening, air ${row.air}`;
		default:
			return '';
	}
}

function pct(v: number): number {
	return Math.round(v * 100);
}

function round6(v: number): number {
	return Math.round(v * 1e6) / 1e6;
}

function round3(v: number): number {
	return Math.round(v * 1000) / 1000;
}

function round2(v: number): number {
	return Math.round(v * 100) / 100;
}

function round1(v: number): number {
	return Math.round(v * 10) / 10;
}
