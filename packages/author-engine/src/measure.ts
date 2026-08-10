import type { EffectDef, Geometry, SectionKind, Show, TrackAnalysis } from '@mv/core';
import { EffectRegistry, Mixer, ShowPlayer, barTimeAt } from '@mv/core';
import { MAX_VOID_BARS } from './lint.ts';

/**
 * What a finished show actually delivers to the LEDs.
 *
 * The linter judges a show against the grid and the craft rules without ever rendering it, so a
 * show can lint clean and still hand the room a black intro or a drop indistinguishable from the
 * groove before it. This plays it through the same `ShowPlayer` and `Mixer` the wire is fed from
 * and reports what came out, in bytes: gamma 2.2 sends an authoring value of 0.2 to byte 8 and
 * 0.6 to byte 84, so the authoring domain cannot answer whether a passage is visible.
 *
 * Reported per cue rather than per section, because the cue is what an author can change.
 */
export interface CueReading {
	bar: number;
	endBar: number;
	/** The cue's own label, which may disagree with the detector's. */
	section: SectionKind;
	/** Mean delivered byte over the cue, across the whole room. */
	level: number;
	/** Share of LEDs above byte 8, roughly where a pixel stops reading as off in a dark room. */
	lit: number;
	/**
	 * The dimmest strip's mean against the brightest strip's, 0 to 1.
	 *
	 * Not mean absolute deviation across the frame, which cannot tell structure from patchiness:
	 * a bright beam over dark walls scores high on it. This asks the question a five-strip room
	 * actually poses - is any wall being left out - and a flat wash scores 1.
	 */
	spread: number;
	/** Movement across a phrase, with frame-rate shimmer already removed. */
	drift: number;
	/** Movement at frame scale: the room shimmering rather than moving. */
	ripple: number;
}

export interface HitReading {
	bar: number;
	kind: Show['hits'][number]['kind'];
	/** False when the room never did what the hit asked inside its own span. */
	fired: boolean;
}

export interface ShowReading {
	fps: number;
	cues: CueReading[];
	/** Mean delivered byte in the drops against the mean in the intro, outro and breakdowns. */
	contrast: number;
	hits: HitReading[];
	/**
	 * Bars the room is dark in without having been asked to be.
	 *
	 * A void and a blackout are both explicit instructions to cut the light, so neither is
	 * reported while it stays inside the length the craft rules allow: this is for the bar
	 * nobody meant to lose.
	 */
	darkBars: number[];
}

/** Where a pixel stops reading as off in a dark room. */
const VISIBLE = 8;
/**
 * Two references per pixel, which is what separates the two complaints a room actually gets.
 *
 * One high-pass cannot: subtracting a single running mean keeps everything faster than its time
 * constant, so a shimmer and a swell land in the same number. The fast average removes the
 * shimmer, leaving `drift` as what moved between roughly 0.3 and 2 Hz - a phrase - and the
 * residual against that same fast average is `ripple`, the shimmer on its own.
 */
const FAST_TAU = 0.08;
const SLOW_TAU = 0.5;

/** Which kinds the contrast ratio is taken between: the loudest against the three quiet ones. */
const LOUD: ReadonlySet<SectionKind> = new Set<SectionKind>(['drop']);
const QUIET: ReadonlySet<SectionKind> = new Set<SectionKind>(['breakdown', 'intro', 'outro']);

interface Accumulator {
	level: number;
	lit: number;
	spread: number;
	drift: number;
	ripple: number;
	n: number;
}

export interface MeasureOptions {
	/**
	 * Frames per second. 60 is the wire rate and the default.
	 *
	 * Halving it halves the cost and is not the same picture: the slew, the flash limiter and
	 * every envelope in an effect integrate per frame, so a passage that flickers renders up to
	 * a fifth dimmer at 30. A still cue agrees within a byte. Use the cheap rate to look at
	 * levels and coverage, never to judge how a drop reads.
	 */
	fps?: number;
}

export function measureShow(
	show: Show,
	analysis: TrackAnalysis,
	effects: Map<string, EffectDef>,
	geometry: Geometry,
	opts: MeasureOptions = {}
): ShowReading {
	const fps = opts.fps ?? 60;
	const dt = 1 / fps;

	const registry = new EffectRegistry();
	for (const def of effects.values()) registry.add(def);

	const mixer = new Mixer(geometry);
	const player = new ShowPlayer(mixer, registry);
	player.load(analysis, show);
	player.reset();

	const cues = [...show.cues].sort((a, b) => a.bar - b.bar);
	const lastBar = analysis.bars.length - 1;
	const cueAt = cueIndexPerBar(cues, analysis.bars.length);

	const pixels = geometry.count;
	const fast = new Float32Array(pixels);
	const slow = new Float32Array(pixels);
	const level = new Float32Array(pixels);

	const totals: Accumulator[] = cues.map(() => ({
		level: 0,
		lit: 0,
		spread: 0,
		drift: 0,
		ripple: 0,
		n: 0
	}));
	const barLevel = new Float64Array(analysis.bars.length);
	const barFrames = new Float64Array(analysis.bars.length);

	// A hit has fired when the room does what it asks inside its own span: a blackout when the
	// intensity collapses, anything else when its effect is the one installed in the master.
	const windows = show.hits.map((h) => {
		const start = barTimeAt(analysis.tempo, h.bar);
		const beat = (barTimeAt(analysis.tempo, h.bar + 1) - start) / analysis.tempo.beatsPerBar;
		const from = start + (h.beat ?? 0) * beat;
		return { from, to: from + h.beats * beat, kind: h.kind, bar: h.bar };
	});
	const fired = new Set<number>();

	const aFast = 1 - Math.exp(-dt / FAST_TAU);
	const aSlow = 1 - Math.exp(-dt / SLOW_TAU);
	let first = true;

	for (let t = 0; t < analysis.duration; t += dt) {
		const f = player.update(t, dt);
		mixer.render(f);

		let sum = 0;
		let lit = 0;
		let drift = 0;
		let ripple = 0;

		for (let k = 0; k < pixels; k++) {
			const i = k * 3;
			const v = Math.max(mixer.bytes[i], mixer.bytes[i + 1], mixer.bytes[i + 2]);
			level[k] = v;
			sum += v;
			if (v >= VISIBLE) lit++;
			if (first) {
				fast[k] = v;
				slow[k] = v;
			} else {
				fast[k] += (v - fast[k]) * aFast;
				slow[k] += (v - slow[k]) * aSlow;
			}
			drift += Math.abs(fast[k] - slow[k]);
			ripple += Math.abs(v - fast[k]);
		}
		first = false;

		let dimmest = Infinity;
		let brightest = 0;
		for (const strip of geometry.strips) {
			let total = 0;
			for (let k = 0; k < strip.count; k++) total += level[strip.offset + k];
			const mean = total / Math.max(1, strip.count);
			if (mean < dimmest) dimmest = mean;
			if (mean > brightest) brightest = mean;
		}

		const bar = Math.min(Math.max(f.barIndex, 0), lastBar);
		const cell = totals[cueAt[bar]];
		if (cell) {
			cell.level += sum / pixels;
			cell.lit += lit / pixels;
			cell.spread += brightest > 0 ? dimmest / brightest : 1;
			cell.drift += drift / pixels;
			cell.ripple += ripple / pixels;
			cell.n++;
		}

		barLevel[bar] += sum / pixels;
		barFrames[bar]++;

		for (let i = 0; i < windows.length; i++) {
			const w = windows[i];
			if (t < w.from || t >= w.to || fired.has(i)) continue;
			const master = mixer.layers.master;
			const ok =
				w.kind === 'blackout'
					? mixer.intensity < 0.1
					: master.effect !== null && master.params.trigger > 0.5;
			if (ok) fired.add(i);
		}
	}

	const readings: CueReading[] = cues.map((cue, i) => {
		const cell = totals[i];
		const n = Math.max(1, cell.n);
		return {
			bar: cue.bar,
			endBar: cues[i + 1]?.bar ?? lastBar + 1,
			section: cue.section,
			level: cell.level / n,
			lit: cell.lit / n,
			spread: cell.spread / n,
			drift: cell.drift / n,
			ripple: cell.ripple / n
		};
	});

	const asked = darknessAskedFor(analysis, show, cues);
	const darkBars: number[] = [];
	for (let bar = 0; bar < barLevel.length; bar++) {
		if (barFrames[bar] === 0 || asked[bar]) continue;
		if (barLevel[bar] / barFrames[bar] < VISIBLE) darkBars.push(bar);
	}

	return {
		fps,
		cues: readings,
		contrast: ratio(readings, LOUD, QUIET),
		hits: windows.map((w, i) => ({ bar: w.bar, kind: w.kind, fired: fired.has(i) })),
		darkBars
	};
}

/** Weighted by how long each cue holds the room, or a one-bar drop counts as much as a chorus. */
function ratio(
	cues: readonly CueReading[],
	loud: ReadonlySet<SectionKind>,
	quiet: ReadonlySet<SectionKind>
): number {
	const mean = (which: ReadonlySet<SectionKind>) => {
		let sum = 0;
		let bars = 0;
		for (const c of cues) {
			if (!which.has(c.section)) continue;
			const length = Math.max(1, c.endBar - c.bar);
			sum += c.level * length;
			bars += length;
		}
		return bars > 0 ? sum / bars : 0;
	};
	const lo = mean(quiet);
	return lo > 0 ? mean(loud) / lo : 0;
}

/** Which cue covers each bar. Cues tile the track, so this is a walk rather than a search. */
function cueIndexPerBar(cues: Show['cues'], bars: number): Int32Array {
	const out = new Int32Array(bars);
	let cursor = 0;
	for (let bar = 0; bar < bars; bar++) {
		while (cursor + 1 < cues.length && bar >= cues[cursor + 1].bar) cursor++;
		out[bar] = bar < cues[0].bar ? 0 : cursor;
	}
	return out;
}

/**
 * Bars where darkness is the instruction rather than the fault.
 *
 * Three ways it can be asked for: a void the analysis measured, a void the cue itself declares -
 * which is what zeroes the house floor, so it is the instruction that actually produces the dark
 * room - and every bar a blackout touches. The held breath before a drop is a blackout on the
 * last bar of a build, and reporting it as a room accidentally lost is how a measurement teaches
 * an author to undo the strongest move in the vocabulary.
 *
 * A cue-declared void is only excused as far as `MAX_VOID_BARS`, which is where the linter
 * starts calling it too long anyway. Past that the two instruments agree rather than one of them
 * repeating the other, and a groove mislabelled `void` still shows up as the black room it is.
 */
function darknessAskedFor(analysis: TrackAnalysis, show: Show, cues: Show['cues']): Uint8Array {
	const out = new Uint8Array(analysis.bars.length);
	for (const span of analysis.sections) {
		if (span.kind !== 'void') continue;
		for (let bar = span.startBar; bar < span.endBar && bar < out.length; bar++) out[bar] = 1;
	}
	for (const [i, cue] of cues.entries()) {
		if (cue.section !== 'void') continue;
		const end = Math.min(cues[i + 1]?.bar ?? out.length, cue.bar + MAX_VOID_BARS);
		for (let bar = cue.bar; bar < end && bar < out.length; bar++) if (bar >= 0) out[bar] = 1;
	}
	for (const hit of show.hits) {
		if (hit.kind !== 'blackout') continue;
		const from = hit.bar;
		const to = hit.bar + Math.ceil(((hit.beat ?? 0) + hit.beats) / analysis.tempo.beatsPerBar);
		for (let bar = from; bar < to && bar < out.length; bar++) if (bar >= 0) out[bar] = 1;
	}
	return out;
}

/** The reading as the author reads it: one line per cue, then what needs answering. */
export function formatReading(reading: ShowReading): string {
	const lines: string[] = [
		`Rendered at ${reading.fps} fps through the same mixer that feeds the wire.`,
		'',
		'bars       section     level   lit  spread  drift  ripple'
	];

	for (const c of reading.cues) {
		lines.push(
			`${`${c.bar}-${c.endBar}`.padEnd(10)} ${c.section.padEnd(10)} ${c.level
				.toFixed(1)
				.padStart(6)} ${`${Math.round(100 * c.lit)}%`.padStart(5)} ${c.spread
				.toFixed(2)
				.padStart(7)} ${c.drift.toFixed(2).padStart(6)} ${c.ripple.toFixed(2).padStart(7)}`
		);
	}

	const missed = reading.hits.filter((h) => !h.fired);
	lines.push('');
	lines.push(
		`drop-to-quiet contrast ${reading.contrast.toFixed(2)}x · ${
			reading.hits.length - missed.length
		}/${reading.hits.length} hits fire`
	);
	if (missed.length > 0) {
		lines.push(
			`never reaches the room: ${missed
				.map((h) => `${h.kind} at bar ${h.bar}`)
				.join(', ')} - a bigger gesture is masking it, or nothing is installed under it`
		);
	}
	if (reading.darkBars.length > 0) {
		lines.push(`dark outside a void, bars: ${summariseRuns(reading.darkBars)}`);
	}

	lines.push('');
	lines.push('level is the mean byte 0-255 and lit the share of LEDs over byte 8. spread is the');
	lines.push('dimmest strip against the brightest, so 1.0 lights every wall and 0.2 leaves three of');
	lines.push('them out. drift is movement across a phrase, ripple is shimmer at frame rate: a quiet');
	lines.push('passage wants drift and not ripple.');
	return lines.join('\n');
}

/** 4, 5, 6, 9 as "4-6, 9". A list of ninety bar numbers is not a finding anyone can act on. */
function summariseRuns(bars: readonly number[]): string {
	const runs: string[] = [];
	let start = bars[0];
	let prev = bars[0];
	for (let i = 1; i <= bars.length; i++) {
		const bar = bars[i];
		if (bar === prev + 1) {
			prev = bar;
			continue;
		}
		runs.push(start === prev ? `${start}` : `${start}-${prev}`);
		start = bar;
		prev = bar;
	}
	return runs.join(', ');
}
