import type { Moment, SectionKind, SectionSpan, TrackAnalysis } from '@mv/core';
import { SECTION_KINDS, barAtTime, barTimeAt } from '@mv/core';
import type { JudgedSection } from './judge.ts';

/**
 * The analysis re-sectioned along the owner's hand-drawn map, for an ephemeral preview.
 *
 * A shallow copy with `sections` and `moments` replaced is exactly deep enough: the engine
 * only reads section-derived structure through those two fields, and it never mutates what
 * it is handed, so bars, tempo and the rest can stay shared with the cached blob.
 */
export function applyHandSections(analysis: TrackAnalysis, hand: JudgedSection[]): TrackAnalysis {
	const sections = rebuildSections(analysis, hand);
	return {
		...analysis,
		sections,
		moments: rebuildMoments(analysis.moments, sections)
	};
}

/**
 * Hand maps keep `kind` a plain string so old maps survive vocabulary changes; a word the
 * current vocabulary does not know reads as the neutral middle of it.
 */
function coerceKind(kind: string): SectionKind {
	return (SECTION_KINDS as readonly string[]).includes(kind) ? (kind as SectionKind) : 'groove';
}

function rebuildSections(analysis: TrackAnalysis, hand: JudgedSection[]): SectionSpan[] {
	const barCount = analysis.bars.length;
	const drawn = [...hand].sort((a, b) => a.startTime - b.startTime);

	// Boundaries between consecutive drawn sections, snapped to the nearest bar. Times are the
	// authoritative coordinate on a hand map (its stored bars are fractional, and pinned to
	// whatever grid the map was drawn over), while the engine addresses cues by whole bars, so
	// the map rounds onto the current grid here. The first and last boundaries are forced to
	// the track's edges: the engine expects sections to cover every bar with no gaps.
	const bounds = drawn.map((s, i) =>
		i === 0 ? 0 : Math.max(0, Math.min(barCount, Math.round(barAtTime(analysis.tempo, s.startTime))))
	);
	bounds.push(barCount);

	const spans: SectionSpan[] = [];
	let cursor = 0;
	for (let i = 0; i < drawn.length; i++) {
		const endBar = Math.min(barCount, bounds[i + 1]);
		// A sliver that rounded to nothing on the bar grid has nothing to light; its bars
		// belong to the neighbour that absorbed the boundary.
		if (endBar <= cursor) continue;

		let sum = 0;
		let peak = 0;
		for (let b = cursor; b < endBar; b++) {
			const e = analysis.bars[b].energy;
			sum += e;
			if (e > peak) peak = e;
		}
		const len = endBar - cursor;
		spans.push({
			index: spans.length,
			kind: coerceKind(drawn[i].kind),
			startBar: cursor,
			endBar,
			startTime: barTimeAt(analysis.tempo, cursor),
			endTime: barTimeAt(analysis.tempo, endBar),
			lengthBars: len,
			meanEnergy: Math.round(sum / len),
			peakEnergy: peak,
			energyRank: 0,
			group: -1,
			repeatOf: null
		});
		cursor = endBar;
	}

	// Preview-grade repeat grouping: same kind within a bar of the same length reads as the
	// same material. The analyser matches material by audio self-similarity, which a hand map
	// does not carry, so this is approximate on purpose. It only has to be right enough for
	// the picker to repeat a look across the obvious repeats, such as identical choruses.
	let nextGroup = 0;
	for (const s of spans) {
		const kin = spans.find(
			(o) => o.index < s.index && o.kind === s.kind && Math.abs(o.lengthBars - s.lengthBars) <= 1
		);
		if (kin) {
			s.group = kin.group;
			s.repeatOf = spans.find((o) => o.group === kin.group)!.index;
		} else {
			s.group = nextGroup++;
		}
	}

	// Ranked by mean, not peak, mirroring the analyser: a long mid-energy section containing
	// one loud bar must not outrank a short section that is loud the whole way through.
	[...spans]
		.sort((a, b) => b.meanEnergy - a.meanEnergy || b.peakEnergy - a.peakEnergy)
		.forEach((s, i) => {
			spans[s.index].energyRank = i + 1;
		});

	return spans;
}

/**
 * Only the section_start rows are section-derived; the event moments come from the bars,
 * which a hand map does not move, so they carry over unchanged. The note text mirrors the
 * analyser's format, so anything reading the preview analysis sees the same shape.
 */
function rebuildMoments(moments: Moment[], sections: SectionSpan[]): Moment[] {
	const out: Moment[] = moments.filter((m) => m.kind !== 'section_start');
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
	out.sort((a, b) => a.t - b.t || a.bar - b.bar);
	return out;
}
