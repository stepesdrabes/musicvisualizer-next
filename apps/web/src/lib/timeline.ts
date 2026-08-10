import { LAYER_ROLES, barTimeAt, type LayerRole, type Show, type TrackAnalysis } from '@mv/core';

export interface TimelineSection {
	index: number;
	kind: string;
	start: number;
	end: number;
	title: string;
	lines: string[];
}

export interface TimelineCue {
	bar: number;
	start: number;
	end: number;
	section: string;
	intensity: number;
	title: string;
	lines: string[];
}

export interface TimelineMarker {
	kind: 'strobe' | 'blackout' | 'slam' | 'bump';
	start: number;
	/** Where the hit stops. A two-bar strobe has to read as longer than a one-bar one. */
	end: number;
	title: string;
	lines: string[];
}

export interface Timeline {
	sections: TimelineSection[];
	cues: TimelineCue[];
	markers: TimelineMarker[];
}

const EMPTY: Timeline = { sections: [], cues: [], markers: [] };

/**
 * The show as a set of spans on one time axis, with the text each one shows on hover.
 *
 * Kept out of the component so the arithmetic can be tested: every span here is derived from
 * a bar index through the tempo grid, and an off-by-one in that is invisible on screen until
 * somebody notices the strobe marker sitting a bar after the strobe.
 */
export function buildTimeline(
	analysis: TrackAnalysis | null,
	show: Show | null,
	duration: number
): Timeline {
	if (!analysis || duration <= 0) return EMPTY;

	const beatPeriod = analysis.tempo.beatPeriod;

	const sections: TimelineSection[] = analysis.sections.map((s) => ({
		index: s.index,
		kind: s.kind,
		start: s.startTime,
		end: s.endTime,
		title: s.kind,
		lines: [
			`bars ${s.startBar}-${s.endBar} (${s.lengthBars})`,
			`energy ${s.meanEnergy}, rank ${s.energyRank}${s.energyRank === 1 ? ' - the peak' : ''}`,
			s.repeatOf !== null ? `repeats section ${s.repeatOf}` : ''
		].filter(Boolean)
	}));

	if (!show) return { sections, cues: [], markers: [] };

	// A cue runs until the next one starts, so the list has to be in bar order before the ends
	// can be read off it. The show is not required to store them sorted.
	const sorted = [...show.cues].sort((a, b) => a.bar - b.bar);
	const cues: TimelineCue[] = sorted.map((cue, i) => {
		const next = sorted[i + 1];
		const intensity = cue.intensity ?? show.defaults.intensity;
		const layers = LAYER_ROLES.filter((r: LayerRole) => cue.layers[r]).map(
			(r: LayerRole) => `${r}: ${cue.layers[r]!.effect}`
		);
		return {
			bar: cue.bar,
			start: barTimeAt(analysis.tempo, cue.bar),
			end: next ? barTimeAt(analysis.tempo, next.bar) : duration,
			section: cue.section,
			intensity,
			title: `bar ${cue.bar} - ${cue.section}`,
			lines: [`intensity ${intensity.toFixed(2)}`, ...layers, cue.note].filter(Boolean)
		};
	});

	const markers: TimelineMarker[] = show.hits
		.map((h) => {
			const start = barTimeAt(analysis.tempo, h.bar) + (h.beat ?? 0) * beatPeriod;
			return {
				kind: h.kind,
				start,
				end: start + h.beats * beatPeriod,
				title: h.kind,
				lines: [
					`bar ${h.bar}${h.beat ? ` beat ${h.beat}` : ''}, ${h.beats} beat${h.beats === 1 ? '' : 's'}`,
					h.params?.perBeat ? `${h.params.perBeat} per beat` : '',
					h.note ?? ''
				].filter(Boolean)
			};
		})
		.sort((a, b) => a.start - b.start);

	return { sections, cues, markers };
}

/**
 * The cue holding the room at a given bar, or undefined before the first one starts.
 *
 * A search rather than a reverse-and-find: nothing requires a show to store its cues in bar
 * order, and an agent's show is whatever JSON the model wrote. Taking the last one that starts
 * at or before the bar is only the live cue if the list happens to be sorted.
 */
export function activeCue(show: Show | null, bar: number): Show['cues'][number] | undefined {
	if (!show) return undefined;
	let best: Show['cues'][number] | undefined;
	for (const cue of show.cues) {
		if (cue.bar <= bar && (!best || cue.bar > best.bar)) best = cue;
	}
	return best;
}

/** Onsets counted into one bucket per pixel column, for a lane too short to draw them singly. */
export function densityColumns(
	times: readonly number[],
	duration: number,
	columns: number
): Uint16Array {
	const out = new Uint16Array(Math.max(1, columns));
	if (duration <= 0) return out;
	for (const t of times) {
		const x = Math.floor((t / duration) * columns);
		if (x >= 0 && x < out.length) out[x]++;
	}
	return out;
}
