import {
	ANALYSIS_VERSION,
	BARS_PER_PHRASE,
	NUM_BANDS,
	type BarRow,
	type Moment,
	type OnsetStream,
	type SectionSpan,
	type TrackAnalysis,
	type TrackContext
} from '@mv/core';
import { arrange, bandLevels, levelEnvelopes } from './arrange.ts';
import { spectrumTrack } from './spectrum.ts';
import { detectBeats, type BeatGrid } from './beats.ts';
import { beatSynchronous } from './beatsync.ts';
import { chromagram, estimateKey } from './chroma.ts';
import { detectDrums, type DrumStream } from './drums.ts';
import { extractFeatures } from './features.ts';
import { detectMeter, type Meter } from './downbeats.ts';
import { assessMetricalLevel } from './metricalLevel.ts';
import { measureLoudness } from './loudness.ts';
import { barGroups, quantiseOnsets } from './quantise.ts';
import { analyseStereo } from './stereo.ts';
import {
	DEFAULT_TUNING,
	barSynchronous,
	groupSegments,
	refineBoundaries,
	rephaseToPins,
	segmentBars,
	similarityMatrix,
	type BoundaryMove,
	type StructureTuning
} from './structure.ts';
import {
	chorusSpansFromLyrics,
	demoteVersesFromLyrics,
	fourOnFloor,
	promoteChorusesFromLyrics,
	speaksClub,
	toSongVocabulary
} from './vocabulary.ts';

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
	 * Re-read the beats at a different metrical level: 2 doubles the tempo, 0.5 halves it, 1.5
	 * reads three where the tracker read two. Applied to whatever grid is used, so it corrects
	 * the model and the in-repo tracker alike.
	 */
	metricalLevel?: number;
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
	/**
	 * What the track is, from free metadata: genre family for the section vocabulary, synced
	 * lyrics for chorus location. Optional, and an empty context changes nothing.
	 */
	context?: TrackContext;
	/**
	 * False disables the compound-meter octave guard. Set internally when the guard has
	 * already fired, so a re-read cannot recurse.
	 */
	octaveGuard?: boolean;
	/**
	 * Structure-stage dials, for the bench to sweep against annotated corpora. Shipping code
	 * never passes this; the defaults ARE the tuned values, and they are tuned there rather
	 * than argued about here.
	 */
	tuning?: StructureTuning;
}

const TARGET_LUFS = -14;
/** What a silent track reports rather than negative infinity, which is not JSON. */
const SILENCE_LUFS = -70;

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

	if (input.metricalLevel && Math.abs(input.metricalLevel - 1) > 1e-6) {
		relevel(grid, input.metricalLevel);
	}

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
		(input.downbeats && input.downbeats.length > 2
			? meterFromDownbeats(grid.beats, input.downbeats)
			: null) ?? detectMeter(beatFeatures);

	// Three beats to a bar above 130 bpm is not a fast waltz, it is compound time heard at
	// the subdivision: a 6/8 ballad notated at the eighth reads as ~150 in 3, and every
	// beat-derived time constant then runs at eighth-note nervousness. Re-read at the dotted
	// quarter - the pulse a listener actually taps - once, and only when nobody upstream
	// (a listener's correction, a published-tempo re-level) has already chosen a level.
	// Catalogues cannot settle this one: Deezer publishes the same fast level.
	if (
		(input.octaveGuard ?? true) &&
		input.metricalLevel === undefined &&
		meter.beatsPerBar === 3 &&
		grid.bpm >= 130
	) {
		return analyzeTrack({ ...input, metricalLevel: 1 / 3, octaveGuard: false });
	}
	const bars = barSynchronous(beatFeatures, meter.beatsPerBar, meter.phase);

	// Detection before structure, because a boundary is refined onto the bar the kit returns
	// at. Only the QUANTISE step needs to know which bars repeat which, and it still runs
	// after the segmentation it depends on.
	const detected = detectDrums(features.spec, { beatPeriod: grid.beatPeriod, odf: features.odf });
	const rawKicks = countPerBar(detected.kick.times, bars.time, bars.count);

	const tuning = input.tuning ?? DEFAULT_TUNING;
	const sim = similarityMatrix(bars);
	const moves: BoundaryMove[] = [];
	const rough = refineBoundaries(segmentBars(sim, bars), bars, rawKicks, moves, tuning.refineFloor);
	// Only the decisive arrivals earn pin status; a marginal move may correct its own
	// boundary without getting a vote over everyone else's.
	const pinned = new Set(moves.filter((m) => m.score >= tuning.pinScore).map((m) => m.to));
	// The pinned arrivals know the track's phrase phase; boundaries that had only mush to
	// stand on are re-read onto it. This is what was arriving a bar early at the top of a
	// track whose own drop later proved where the phrases actually sit.
	const bounds = rephaseToPins(rough, pinned, bars.count, tuning);
	const groups = groupSegments(sim, bars.count, bounds);
	const barGroup = barGroups(bounds, groups.group, bars.count);

	const quantise = (stream: DrumStream) =>
		quantiseOnsets(stream, {
			beats: grid.beats,
			beatsPerBar: meter.beatsPerBar,
			downbeatPhase: meter.phase,
			barGroup,
			duration
		});
	const drums = {
		kick: quantise(detected.kick),
		snare: quantise(detected.snare),
		hat: quantise(detected.hat)
	};
	const kicks = countPerBar(drums.kick.times, bars.time, bars.count);
	const snares = countPerBar(drums.snare.times, bars.time, bars.count);
	const hats = countPerBar(drums.hat.times, bars.time, bars.count);

	const barsDb = bandLevels(features.spec, bars.time, bars.count);
	const plan = arrange(
		barsDb,
		bars,
		bounds,
		groups,
		loudness.shortTerm,
		loudness.shortTermFps,
		kicks,
		snares,
		pinned
	);

	// The vocabulary is chosen per track, after labelling: the structural machinery only
	// knows energy classes, and whether a loud repeated passage is a drop or a chorus is a
	// fact about the genre, not about the waveform. Song-family tracks re-read drop/groove
	// as chorus/verse, and synced lyrics then settle which loud section is THE chorus.
	const club = speaksClub(
		input.context?.genreFamily ?? null,
		fourOnFloor(kicks, plan.energy, meter.beatsPerBar)
	);
	if (!club) {
		toSongVocabulary(plan.segments);
		const lyrics = input.context?.lyrics;
		if (lyrics && lyrics.length > 0) {
			const spans = chorusSpansFromLyrics(lyrics, duration);
			const segEnergy = plan.segments.map((s) => {
				let acc = 0;
				for (let b = s.startBar; b < Math.min(s.endBar, bars.count); b++) acc += plan.energy[b];
				return acc / Math.max(1, Math.min(s.endBar, bars.count) - s.startBar);
			});
			const barTime = (bar: number) => bars.time[Math.max(0, Math.min(bars.count, bar))];
			promoteChorusesFromLyrics(plan.segments, segEnergy, barTime, spans);
			demoteVersesFromLyrics(plan.segments, barTime, spans);
		}
	}

	// One array decides where every bar is. `bars[].t` is written from it below rather than
	// computed alongside it, because two independent copies of the same timing is exactly how
	// the grid and the bar table came to disagree by eight beats on a track that speeds up.
	const barTimes = Array.from(bars.time.subarray(0, bars.count + 1), round3);

	// Synced lyrics become timing data: a per-bar coverage column and a 'vocal_in' event at
	// each entrance. Pure arithmetic over what ingest already cached - an offline track just
	// carries zeros - and the one thing the room most visibly answers in a song is when the
	// voice arrives, which until this column nothing downstream could see.
	const vocal = new Float64Array(bars.count);
	const vocalIn = new Set<number>();
	const lyricLines = input.context?.instrumental ? null : (input.context?.lyrics ?? null);
	if (lyricLines && lyricLines.length > 0) {
		const barAt = (t: number) => {
			let b = 0;
			while (b < bars.count - 1 && bars.time[b + 1] <= t) b++;
			return b;
		};
		for (let i = 0; i < lyricLines.length; i++) {
			const start = lyricLines[i].t;
			// A line carries only its start; it lasts until the next one, capped at a sung
			// phrase's worth so an instrumental gap stays a gap.
			const end = Math.min(lyricLines[i + 1]?.t ?? start + 4, start + 4, duration);
			for (let b = barAt(start); b < bars.count && bars.time[b] < end; b++) {
				const len = bars.time[b + 1] - bars.time[b];
				if (len <= 0) continue;
				const overlap = Math.min(end, bars.time[b + 1]) - Math.max(start, bars.time[b]);
				if (overlap > 0) vocal[b] += overlap / len;
			}
		}
		let silentBars = 2;
		for (let b = 0; b < bars.count; b++) {
			if (vocal[b] >= 0.05) {
				if (silentBars >= 2) vocalIn.add(b);
				silentBars = 0;
			} else {
				silentBars++;
			}
		}
	}

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
			vocal: Math.round(Math.min(1, vocal[b]) * 100) / 100,
			events: vocalIn.has(b) ? [...plan.events[b], 'vocal_in'] : plan.events[b]
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

	// The light moves at beat resolution, not bar resolution. Same arithmetic, finer grid: a
	// per-bar mean hides between 12% and 43% of the band envelope's true variance, and reading
	// it by interpolating between bar centres also leads the audio by half a bar.
	const beatCount = Math.max(0, beatFeatures.count);
	const beatDb = bandLevels(features.spec, beatFeatures.time, beatCount);
	const beat = levelEnvelopes(
		beatDb,
		loudness.shortTerm,
		loudness.shortTermFps,
		beatFeatures.time,
		beatCount
	);

	// Assessed on the grid that is actually shipping, so a track corrected once does not keep
	// offering the correction it already took.
	const level = assessMetricalLevel(
		Array.from(grid.beats),
		features.odf,
		features.curves.fps
	);

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
			ambiguous: level.ambiguous,
			alternativeBpm: level.alternatives,
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
		envelopes: {
			energy: Array.from(beat.energy, pct),
			bands: Array.from(beat.bands, pct)
		},
		spectrum: spectrumTrack(features.spec, input.duration, (t) => {
			for (const s of sections) if (t >= s.startTime && t < s.endTime) return s.kind;
			return 'groove';
		}),
		stereo: {
			fps: round3(stereo.fps),
			pan: Array.from(stereo.pan, round2),
			width: Array.from(stereo.width, round2)
		},
		onsets: {
			kick: roundStream(drums.kick),
			snare: roundStream(drums.snare),
			hat: roundStream(drums.hat)
		},
		integratedLufs: round1(Math.max(loudness.integrated, SILENCE_LUFS)),
		loudnessRange: round1(loudness.range),
		peakToLoudness: round1(Number.isFinite(loudness.peakToLoudness) ? loudness.peakToLoudness : 0)
	};
}

/**
 * Re-read the same beats at a different metrical level, in place.
 *
 * A half-time reading is a subset of the true beats and a double-time reading is a superset, so
 * neither is a re-detection: the phase the tracker found is the reliable part and only how many
 * beats there are to a bar is in doubt. Resampling in beat-index space covers the two-against-
 * three case as well, which a half/double control alone cannot repair and which is exactly what
 * a listening test caught on one of the cached tracks.
 */
function relevel(grid: BeatGrid, level: number): void {
	const source = grid.beats;
	const last = source.length - 1;
	if (last < 1 || !(level > 0)) return;

	const out: number[] = [];
	for (let k = 0; ; k++) {
		const x = k / level;
		if (x > last) break;
		const i = Math.floor(x);
		const f = x - i;
		out.push(i >= last ? source[last] : source[i] + (source[i + 1] - source[i]) * f);
	}
	if (out.length < 2) return;

	grid.beats = Float64Array.from(out);
	grid.beatPeriod = (out[out.length - 1] - out[0]) / (out.length - 1);
	grid.bpm = grid.beatPeriod > 1e-6 ? 60 / grid.beatPeriod : grid.bpm;
	grid.firstBeat = out[0];
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

/**
 * Beats per bar and phase from a downbeat list, by the commonest spacing along the beats.
 *
 * Null when the spacing is degenerate - after a metrical re-read the model's downbeats can
 * land on every new beat, which says nothing about bars - so the caller falls back to the
 * evidence-based meter, which is what places a compound track's bars on its actual ones.
 */
function meterFromDownbeats(beats: Float64Array, downbeats: readonly number[]): Meter | null {
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
	if (best === 0) return null;
	// A downbeat every 8 or 6 beats is a 4- or 3-beat bar heard at double length, which is
	// what a metrical-level correction produces: doubling the beats doubles the model's
	// downbeat spacing, and an 8-beat bar is not a meter this repertoire has. Folding keeps
	// the phase valid because a downbeat 8 beats apart is still on the 4-beat grid.
	if (beatsPerBar === 8 || beatsPerBar === 12) beatsPerBar = 4;
	else if (beatsPerBar === 6) beatsPerBar = 3;

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
		case 'vocal_in':
			return 'the voice comes in';
		default:
			return '';
	}
}

function roundStream(stream: { times: number[]; levels: number[] }): OnsetStream {
	return { times: stream.times.map(round3), levels: stream.levels.map(round2) };
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
