import type { BarRow, TrackAnalysis, TempoGrid } from './contracts/analysis.ts';
import type { Cue, Hit, Show } from './contracts/show.ts';
import { LAYER_ROLES } from './contracts/effect.ts';
import type { Palette, ShowPalette } from './contracts/palette.ts';
import type { SectionKind, ShowFrame } from './contracts/frame.ts';
import { NUM_BANDS, createShowFrame } from './contracts/frame.ts';
import { blendPalettes, makePalette, swapped } from './color/palette.ts';
import { FlashEnvelope } from './dsl/env.ts';
import { clamp, frac } from './dsl/math.ts';
import { barTimeAt } from './grid.ts';
import type { Mixer } from './mixer.ts';
import type { EffectRegistry } from './effects/index.ts';

interface CompiledCue {
	start: number;
	end: number;
	bar: number;
	section: SectionKind;
	layers: Cue['layers'];
	palette: Palette;
	intensity: number;
	motion: number;
	fadeBeats: number;
}

interface CompiledHit {
	start: number;
	end: number;
	kind: Hit['kind'];
	effect: string | null;
	params: Hit['params'];
}

/** Build-progress span: reaches exactly 1.0 at the drop it points at. */
interface BuildSpan {
	start: number;
	end: number;
}

function resolvePalette(base: ShowPalette, cue: Cue): Palette {
	const p = cue.palette;
	if (!p || p === 'inherit') return makePalette(base);
	if (p === 'swap') return makePalette(swapped(base));
	return makePalette(p);
}

export class ShowPlayer {
	readonly frame: ShowFrame = createShowFrame();

	private analysis: TrackAnalysis | null = null;
	private show: Show | null = null;

	private cues: CompiledCue[] = [];
	private hits: CompiledHit[] = [];
	private buildSpans: BuildSpan[] = [];
	private dropTimes: number[] = [];

	private panCurve = new Float32Array(0);
	private widthCurve = new Float32Array(0);
	private stereoFps = 25;

	private barEnergy = new Float32Array(0);
	private barBands = new Float32Array(0);
	private barSection: SectionKind[] = [];
	private sectionBounds: { start: number; end: number }[] = [];

	private readonly kickEnv = new FlashEnvelope();
	private readonly snareEnv = new FlashEnvelope();
	private readonly hatEnv = new FlashEnvelope(0.03, 0.07);
	private kickCursor = 0;
	private snareCursor = 0;
	private hatCursor = 0;

	private lastBeatIndex = Number.NaN;
	private lastBarIndex = Number.NaN;
	private lastPhraseIndex = Number.NaN;
	private lastT = -1;

	private cueCursor = 0;
	private appliedCue = -1;
	private readonly paletteScratch: Palette = makePalette({ base: 0, accent: 180 });
	private activeHitMaster: string | null = null;

	private readonly mixer: Mixer;
	private readonly registry: EffectRegistry;

	constructor(mixer: Mixer, registry: EffectRegistry) {
		this.mixer = mixer;
		this.registry = registry;
	}

	get currentCue(): CompiledCue | null {
		return this.cues[this.cueCursor] ?? null;
	}

	get loaded(): { analysis: TrackAnalysis; show: Show } | null {
		return this.analysis && this.show ? { analysis: this.analysis, show: this.show } : null;
	}

	load(analysis: TrackAnalysis, show: Show): void {
		this.analysis = analysis;
		this.show = show;

		const tempo = analysis.tempo;
		const nBars = analysis.bars.length;

		this.barEnergy = new Float32Array(nBars);
		this.barBands = new Float32Array(nBars * NUM_BANDS);
		this.barSection = new Array<SectionKind>(nBars);
		for (let i = 0; i < nBars; i++) {
			const row: BarRow = analysis.bars[i];
			this.barEnergy[i] = row.energy / 100;
			const o = i * NUM_BANDS;
			this.barBands[o] = row.sub / 100;
			this.barBands[o + 1] = row.low / 100;
			this.barBands[o + 2] = row.mid / 100;
			this.barBands[o + 3] = row.air / 100;
			this.barSection[i] = row.section;
		}

		this.panCurve = Float32Array.from(analysis.stereo?.pan ?? []);
		this.widthCurve = Float32Array.from(analysis.stereo?.width ?? []);
		this.stereoFps = analysis.stereo?.fps || 25;

		this.sectionBounds = analysis.sections.map((s) => ({ start: s.startTime, end: s.endTime }));
		this.dropTimes = analysis.sections
			.filter((s) => s.kind === 'drop')
			.map((s) => s.startTime)
			.sort((a, b) => a - b);

		this.buildSpans = [];
		for (let i = 0; i < analysis.sections.length; i++) {
			const s = analysis.sections[i];
			if (s.kind !== 'build' && s.kind !== 'void') continue;
			const drop = analysis.sections.slice(i + 1).find((x) => x.kind === 'drop');
			if (!drop) continue;
			// Merge a build immediately followed by a void so the progress bar keeps climbing
			// through the silence instead of restarting.
			const existing = this.buildSpans.at(-1);
			if (existing && Math.abs(existing.end - drop.startTime) < 1e-6) continue;
			this.buildSpans.push({ start: s.startTime, end: drop.startTime });
		}

		// The registry belongs to the caller, which has already registered this show's
		// generated effects by now. Clearing it here would render every cue naming one black.
		const defaults = show.defaults;
		const sorted = [...show.cues].sort((a, b) => a.bar - b.bar);
		this.cues = sorted.map((cue, i) => {
			const start = i === 0 ? 0 : barTimeAt(tempo, cue.bar);
			const next = sorted[i + 1];
			return {
				start,
				end: next ? barTimeAt(tempo, next.bar) : analysis.duration + 1,
				bar: cue.bar,
				section: cue.section,
				layers: cue.layers,
				palette: resolvePalette(show.palette, cue),
				intensity: cue.intensity ?? defaults.intensity,
				motion: cue.motion ?? defaults.motion,
				fadeBeats: cue.fadeBeats ?? defaults.fadeBeats
			};
		});

		this.hits = show.hits
			.map((h) => {
				const t =
					barTimeAt(tempo, h.bar) + (h.beat ?? 0) * tempo.beatPeriod;
				return {
					start: t,
					end: t + h.beats * tempo.beatPeriod,
					kind: h.kind,
					effect: h.kind === 'blackout' ? null : h.kind,
					params: h.params
				};
			})
			.sort((a, b) => a.start - b.start);

		this.reset();
	}

	reset(): void {
		this.kickEnv.reset();
		this.snareEnv.reset();
		this.hatEnv.reset();
		this.kickCursor = 0;
		this.snareCursor = 0;
		this.hatCursor = 0;
		this.lastBeatIndex = Number.NaN;
		this.lastBarIndex = Number.NaN;
		this.lastPhraseIndex = Number.NaN;
		this.lastT = -1;
		this.cueCursor = 0;
		this.appliedCue = -1;
		this.activeHitMaster = null;
		this.mixer.reset();
	}

	update(t: number, dt: number): ShowFrame {
		const f = this.frame;
		const a = this.analysis;

		f.t = t;
		f.dt = dt;

		if (!a) return f;

		// Any backward jump invalidates every cursor and every decaying envelope.
		if (t < this.lastT - 1e-6) this.rewind(t);
		this.lastT = t;

		this.updateGrid(t, a.tempo);
		this.updateEnergy();
		this.updateStereo(t);
		this.updateDrums(t, dt, a);
		this.updateStructure(t);
		this.applyCues(t, f);
		this.applyHits(t);

		return f;
	}

	private rewind(t: number): void {
		this.kickEnv.reset();
		this.snareEnv.reset();
		this.hatEnv.reset();
		const a = this.analysis;
		if (a) {
			this.kickCursor = seekCursor(a.onsets.kick, t);
			this.snareCursor = seekCursor(a.onsets.snare, t);
			this.hatCursor = seekCursor(a.onsets.hat, t);
		}
		this.cueCursor = 0;
		this.appliedCue = -1;
		this.lastBeatIndex = Number.NaN;
		this.lastBarIndex = Number.NaN;
		this.lastPhraseIndex = Number.NaN;
	}

	private updateGrid(t: number, tempo: TempoGrid): void {
		const f = this.frame;
		const beatsF = (t - tempo.firstBeat) / tempo.beatPeriod;
		const barsF = (beatsF - tempo.downbeatPhase) / tempo.beatsPerBar;
		const phrasesF = (barsF - tempo.phraseAnchorBar) / tempo.barsPerPhrase;

		const beatIndex = Math.floor(beatsF);
		const barIndex = Math.floor(barsF);
		const phraseIndex = Math.floor(phrasesF);

		f.beatIndex = beatIndex;
		f.barIndex = barIndex;
		f.beatPhase = beatsF - beatIndex;
		f.barPhase = barsF - barIndex;
		f.phrasePhase = frac(phrasesF);
		f.beatPeriod = tempo.beatPeriod;
		f.bpm = tempo.bpm;

		// Edge detection by index change, never by phase threshold, so a beat cannot
		// double-fire on a slow frame or be skipped on a fast one.
		f.beat = beatIndex !== this.lastBeatIndex;
		f.downbeat = barIndex !== this.lastBarIndex;
		f.phraseStart = phraseIndex !== this.lastPhraseIndex;
		this.lastBeatIndex = beatIndex;
		this.lastBarIndex = barIndex;
		this.lastPhraseIndex = phraseIndex;
	}

	private updateEnergy(): void {
		const f = this.frame;
		const n = this.barEnergy.length;
		if (n === 0) return;

		const barsF = clamp(f.barIndex + f.barPhase, 0, n - 1);
		const i0 = Math.floor(barsF);
		const i1 = Math.min(i0 + 1, n - 1);
		const w = barsF - i0;

		f.energy = this.barEnergy[i0] + (this.barEnergy[i1] - this.barEnergy[i0]) * w;
		for (let b = 0; b < NUM_BANDS; b++) {
			const v0 = this.barBands[i0 * NUM_BANDS + b];
			const v1 = this.barBands[i1 * NUM_BANDS + b];
			f.bands[b] = v0 + (v1 - v0) * w;
		}
		f.section = this.barSection[Math.min(Math.max(f.barIndex, 0), n - 1)] ?? 'intro';
	}

	/** Linear between samples, so a hard pan flick arrives as a ramp rather than a step. */
	private updateStereo(t: number): void {
		const f = this.frame;
		const n = this.panCurve.length;
		if (n === 0) {
			f.pan = 0;
			f.panWidth = 0;
			return;
		}
		const x = clamp(t * this.stereoFps, 0, n - 1);
		const i0 = Math.floor(x);
		const i1 = Math.min(i0 + 1, n - 1);
		const u = x - i0;
		f.pan = this.panCurve[i0] + (this.panCurve[i1] - this.panCurve[i0]) * u;
		f.panWidth = this.widthCurve[i0] + (this.widthCurve[i1] - this.widthCurve[i0]) * u;
	}

	private updateDrums(t: number, dt: number, a: TrackAnalysis): void {
		const f = this.frame;
		f.kick = advance(a.onsets.kick, t, this.kickCursor, (c) => (this.kickCursor = c));
		f.snare = advance(a.onsets.snare, t, this.snareCursor, (c) => (this.snareCursor = c));
		f.hat = advance(a.onsets.hat, t, this.hatCursor, (c) => (this.hatCursor = c));

		if (f.kick) this.kickEnv.fire(1);
		if (f.snare) this.snareEnv.fire(1);
		if (f.hat) this.hatEnv.fire(1);

		f.kickEnv = this.kickEnv.update(dt);
		f.snareEnv = this.snareEnv.update(dt);
		f.hatEnv = this.hatEnv.update(dt);
	}

	private updateStructure(t: number): void {
		const f = this.frame;

		let progress = 0;
		for (const span of this.buildSpans) {
			if (t >= span.start && t < span.end) {
				progress = clamp((t - span.start) / Math.max(span.end - span.start, 1e-3));
				break;
			}
		}
		f.buildProgress = progress;

		let toDrop = Infinity;
		let sinceDrop = Infinity;
		for (const d of this.dropTimes) {
			if (d >= t) {
				toDrop = d - t;
				break;
			}
			sinceDrop = t - d;
		}
		f.timeToDrop = toDrop;
		f.timeSinceDrop = sinceDrop;

		const bound = this.sectionBounds.find((s) => t >= s.start && t < s.end);
		f.sectionProgress = bound
			? clamp((t - bound.start) / Math.max(bound.end - bound.start, 1e-3))
			: 0;
	}

	private applyCues(t: number, f: ShowFrame): void {
		if (this.cues.length === 0) return;

		while (this.cueCursor + 1 < this.cues.length && t >= this.cues[this.cueCursor + 1].start) {
			this.cueCursor++;
		}
		while (this.cueCursor > 0 && t < this.cues[this.cueCursor].start) this.cueCursor--;

		const active = this.cues[this.cueCursor];
		const next = this.cues[this.cueCursor + 1];

		if (this.appliedCue !== this.cueCursor) {
			this.installLayers(active);
			this.appliedCue = this.cueCursor;
		}

		// The fade begins fadeBeats early and completes exactly ON the boundary downbeat,
		// which is how a lighting desk runs a cue: the change arrives with the music.
		let u = 0;
		if (next && next.fadeBeats > 0) {
			const fadeStart = next.start - next.fadeBeats * f.beatPeriod;
			if (t >= fadeStart) u = clamp((t - fadeStart) / (next.start - fadeStart));
		}

		if (u > 0 && next) {
			blendPalettes(this.paletteScratch, active.palette, next.palette, u);
			this.mixer.palette = this.paletteScratch;
			this.mixer.intensity = active.intensity + (next.intensity - active.intensity) * u;
			this.mixer.motion = active.motion + (next.motion - active.motion) * u;
		} else {
			this.mixer.palette = active.palette;
			this.mixer.intensity = active.intensity;
			this.mixer.motion = active.motion;
		}
	}

	private installLayers(cue: CompiledCue): void {
		for (const role of LAYER_ROLES) {
			const layer = this.mixer.layers[role];
			const spec = cue.layers[role];
			if (!spec) {
				if (role === 'master' && this.activeHitMaster) continue;
				layer.setEffect(null, this.mixer.geometry);
				continue;
			}
			const def = this.registry.get(spec.effect);
			layer.setEffect(def, this.mixer.geometry);
			if (!def) continue;
			layer.opacity = spec.opacity ?? layer.opacity;
			if (spec.params) for (const [k, v] of Object.entries(spec.params)) layer.params[k] = v;
		}
	}

	private applyHits(t: number): void {
		const master = this.mixer.layers.master;
		const live = this.hits.find((h) => t >= h.start && t < h.end);

		if (!live) {
			if (this.activeHitMaster) {
				master.params.trigger = 0;
				// Effect stays installed so its decay finishes; the next cue reclaims the slot.
				this.activeHitMaster = null;
			}
			return;
		}

		if (live.kind === 'blackout') {
			this.mixer.intensity *= 0.02;
			return;
		}

		if (this.activeHitMaster !== live.effect) {
			const def = live.effect ? this.registry.get(live.effect) : null;
			master.setEffect(def, this.mixer.geometry);
			if (live.params) for (const [k, v] of Object.entries(live.params)) master.params[k] = v;
			this.activeHitMaster = live.effect;
		}
		master.params.trigger = 1;
	}
}

function seekCursor(times: readonly number[], t: number): number {
	let i = 0;
	while (i < times.length && times[i] < t) i++;
	return i;
}

function advance(
	times: readonly number[],
	t: number,
	cursor: number,
	store: (c: number) => void
): boolean {
	let fired = false;
	let i = cursor;
	while (i < times.length && times[i] <= t) {
		fired = true;
		i++;
	}
	if (i !== cursor) store(i);
	return fired;
}
