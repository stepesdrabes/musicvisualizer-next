import {
	DEFAULT_ROOM,
	LAYER_ROLES,
	compileGenerated,
	EffectRegistry,
	Mixer,
	ShowPlayer,
	buildGeometry,
	makePalette,
	scriptFrames,
	type EffectDef,
	type Geometry,
	type Params,
	type Show,
	type ShowFrame,
	type TrackAnalysis
} from '@mv/core';
import type { RoomRenderer } from '@mv/preview3d';

export interface Readout {
	fps: number;
	position: number;
	duration: number;
	playing: boolean;
	bar: number;
	section: string;
	energy: number;
	bpm: number;
	cueBar: number;
	headroom: number;
}

/**
 * Owns the render loop. Deliberately not a Svelte component and deliberately not reactive:
 * the hot path writes ~4000 floats per frame into typed arrays, and putting those behind a
 * `$state` proxy would cost more than everything else here combined. Only the small
 * `Readout` is published, at 20 Hz.
 */
export class Viz {
	readonly geometry: Geometry = buildGeometry(DEFAULT_ROOM);
	readonly registry = new EffectRegistry();
	readonly mixer = new Mixer(this.geometry);
	readonly player = new ShowPlayer(this.mixer, this.registry);
	readonly spec = DEFAULT_ROOM;

	roomRenderer: RoomRenderer | null = null;
	analysis: TrackAnalysis | null = null;
	show: Show | null = null;

	onReadout: ((r: Readout) => void) | null = null;

	/** Positive values render ahead, compensating for output latency. */
	previewOffsetMs = 0;

	private preview: EffectDef | null = null;
	private previewFrames: ShowFrame[] = [];
	private previewIndex = 0;
	private previewParams: Params = {};

	private ctx: AudioContext | null = null;
	private buffer: AudioBuffer | null = null;
	private source: AudioBufferSourceNode | null = null;
	private gain: GainNode | null = null;
	private startedAt = 0;
	private startOffset = 0;
	private playing = false;

	private raf = 0;
	private last = 0;
	private fpsAcc = 0;
	private fpsFrames = 0;
	private fps = 0;
	private readoutAcc = 0;

	get duration(): number {
		return this.buffer?.duration ?? this.analysis?.duration ?? 0;
	}

	get position(): number {
		if (!this.ctx) return this.startOffset;
		if (!this.playing) return this.startOffset;
		return Math.min(this.ctx.currentTime - this.startedAt + this.startOffset, this.duration);
	}

	get isPlaying(): boolean {
		return this.playing;
	}

	async loadAudio(bytes: ArrayBuffer): Promise<void> {
		this.ctx ??= new AudioContext();
		this.gain ??= (() => {
			const g = this.ctx!.createGain();
			g.connect(this.ctx!.destination);
			return g;
		})();
		this.buffer = await this.ctx.decodeAudioData(bytes);
		this.startOffset = 0;
	}

	loadShow(analysis: TrackAnalysis, show: Show): void {
		this.analysis = analysis;
		this.show = show;
		this.registry.clearGenerated();
		for (const gen of show.generatedEffects) {
			const compiled = compileGenerated(gen, this.geometry);
			// A rejected effect is skipped rather than fatal: the rest of the show is still
			// worth watching, and the cue referencing it simply leaves that layer dark.
			if (compiled.def) this.registry.add(compiled.def);
			else console.warn(`generated effect "${gen.id}" rejected`, compiled.failures);
		}
		this.player.load(analysis, show);
	}

	setVolume(v: number): void {
		if (this.gain) this.gain.gain.value = v;
	}

	async play(): Promise<void> {
		if (!this.ctx || !this.buffer || this.playing) return;
		await this.ctx.resume();
		const src = this.ctx.createBufferSource();
		src.buffer = this.buffer;
		src.connect(this.gain!);
		src.onended = () => {
			if (this.source === src) this.pause();
		};
		src.start(0, Math.min(this.startOffset, this.buffer.duration - 0.01));
		this.source = src;
		this.startedAt = this.ctx.currentTime;
		this.playing = true;
	}

	pause(): void {
		if (!this.playing) return;
		this.startOffset = this.position;
		this.playing = false;
		this.source?.stop();
		this.source?.disconnect();
		this.source = null;
	}

	async toggle(): Promise<void> {
		if (this.playing) this.pause();
		else await this.play();
	}

	seek(t: number): void {
		const target = Math.max(0, Math.min(t, this.duration));
		const wasPlaying = this.playing;
		this.pause();
		this.startOffset = target;
		this.player.reset();
		if (wasPlaying) void this.play();
	}

	start(): void {
		if (this.raf) return;
		this.last = performance.now();
		const tick = (now: number) => {
			this.raf = requestAnimationFrame(tick);
			// Clamped so a backgrounded tab does not teleport every envelope on return.
			const dt = Math.min((now - this.last) / 1000, 0.05);
			this.last = now;
			this.frame(dt);
		};
		this.raf = requestAnimationFrame(tick);
	}

	stop(): void {
		if (!this.raf) return;
		cancelAnimationFrame(this.raf);
		this.raf = 0;
	}

	dispose(): void {
		this.stop();
		this.pause();
		this.roomRenderer?.dispose();
		void this.ctx?.close();
	}

	/**
	 * Show one effect on its own, in the room.
	 *
	 * Against the track when there is one: the effect gets the real beat grid, the real drums
	 * and the show's own palette, because an effect judged against a synthetic journey is an
	 * effect judged on the wrong material. Only when nothing is loaded does it fall back to the
	 * scripted groove/build/void/drop the admission gate uses.
	 */
	setPreview(def: EffectDef | null): void {
		this.preview = def;
		this.previewIndex = 0;
		this.previewParams = {};
		if (def) for (const spec of def.params) this.previewParams[spec.key] = spec.default;
		// A master effect idles until the player pulls its trigger, and nothing is going to.
		if (def && 'trigger' in this.previewParams) this.previewParams.trigger = 1;

		if (!def) {
			this.mixer.reset();
			// Reloading is what puts the show's own layers back; the cue cursor has to re-apply.
			if (this.analysis && this.show) this.player.load(this.analysis, this.show);
		}
	}

	setPreviewParam(key: string, value: number): void {
		this.previewParams[key] = value;
	}

	get previewing(): string | null {
		return this.preview?.id ?? null;
	}

	get previewValues(): Params {
		return this.previewParams;
	}

	private frame(dt: number): void {
		const def = this.preview;
		if (!def) {
			this.frameFromShow(dt);
			return;
		}

		let f: ShowFrame;
		if (this.analysis && this.show) {
			f = this.player.update(Math.max(0, this.heardPosition()), dt);
		} else {
			if (this.previewFrames.length === 0) this.previewFrames = scriptFrames(128);
			f = this.previewFrames[this.previewIndex % this.previewFrames.length];
			this.previewIndex++;
			// The journey is scripted at 60 fps; a display that is not sees it slightly fast or
			// slow, which for a preview beats resampling the drum flags.
			f.dt = dt;
			this.mixer.palette = makePalette({ base: 320, accent: 175, third: 44 });
			this.mixer.intensity = 1;
			this.mixer.motion = 1;
		}

		// After the player, not before: it installs the show's layers on every cue boundary, so
		// the preview has to be the last word on what the room is running. Both calls are free
		// when nothing changed.
		for (const role of LAYER_ROLES) {
			if (role !== def.role) this.mixer.layers[role].setEffect(null, this.geometry);
		}
		const layer = this.mixer.layers[def.role];
		layer.setEffect(def, this.geometry);
		layer.opacity = 1;
		for (const key of Object.keys(this.previewParams)) layer.params[key] = this.previewParams[key];

		this.mixer.render(f);
		this.roomRenderer?.render(this.mixer.bytes, dt);
		this.publishReadout(dt, f);
	}

	private frameFromShow(dt: number): void {
		const frame: ShowFrame = this.player.update(Math.max(0, this.heardPosition()), dt);
		this.mixer.render(frame);
		this.roomRenderer?.render(this.mixer.bytes, dt);
		this.publishReadout(dt, frame);
	}

	/**
	 * Where the listener actually is, which is behind where the audio clock has been scheduled
	 * to by however long the output path takes.
	 */
	private heardPosition(): number {
		const latency =
			(this.ctx as (AudioContext & { outputLatency?: number }) | null)?.outputLatency ??
			this.ctx?.baseLatency ??
			0.02;
		return this.position - latency + this.previewOffsetMs / 1000;
	}

	private publishReadout(dt: number, frame?: ShowFrame): void {
		this.fpsAcc += dt;
		this.fpsFrames++;
		if (this.fpsAcc >= 0.5) {
			this.fps = this.fpsFrames / this.fpsAcc;
			this.fpsAcc = 0;
			this.fpsFrames = 0;
		}

		this.readoutAcc += dt;
		if (this.readoutAcc < 0.05) return;
		this.readoutAcc = 0;
		const f = frame ?? this.player.frame;
		this.onReadout?.({
			fps: Math.round(this.fps),
			position: this.position,
			duration: this.duration,
			playing: this.playing,
			bar: f.barIndex,
			section: f.section,
			energy: f.energy,
			bpm: f.bpm,
			cueBar: this.player.currentCue?.bar ?? -1,
			headroom: this.mixer.meanHeadroom
		});
	}
}
