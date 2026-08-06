import type { Geometry } from './contracts/room.ts';
import type { ShowFrame } from './contracts/frame.ts';
import type {
	BlendMode,
	Effect,
	EffectDef,
	LayerRole,
	Params,
	RenderCtx
} from './contracts/effect.ts';
import { LAYER_ROLES } from './contracts/effect.ts';
import type { Palette } from './contracts/palette.ts';
import { makePalette } from './color/palette.ts';
import {
	BrightnessSlew,
	FlashLimiter,
	MeanLevel,
	blend,
	compressHighlights,
	quantize
} from './output.ts';

const DEFAULT_BLEND: Record<LayerRole, BlendMode> = {
	bed: 'over',
	rhythm: 'add',
	transient: 'add',
	accent: 'add',
	master: 'add'
};

// Opacity budget per role. Without it the four additive layers reliably sum past white
// and the palette stops being readable at exactly the loudest moment.
const DEFAULT_OPACITY: Record<LayerRole, number> = {
	bed: 0.45,
	rhythm: 0.8,
	transient: 0.95,
	accent: 0.55,
	master: 1
};

export class Layer {
	def: EffectDef | null = null;
	effect: Effect | null = null;
	params: Params = {};
	opacity: number;
	blendMode: BlendMode;
	enabled = true;
	readonly buf: Float32Array;
	readonly role: LayerRole;

	constructor(role: LayerRole, count: number) {
		this.role = role;
		this.buf = new Float32Array(count * 3);
		this.opacity = DEFAULT_OPACITY[role];
		this.blendMode = DEFAULT_BLEND[role];
	}

	setEffect(def: EffectDef | null, g: Geometry): void {
		if (def === this.def) return;
		this.def = def;
		this.effect = def ? def.create(g) : null;
		this.buf.fill(0);
		this.params = {};
		if (def) for (const p of def.params) this.params[p.key] = p.default;
	}

	reset(): void {
		this.effect?.reset();
		this.buf.fill(0);
	}
}

export class Mixer {
	readonly layers: Record<LayerRole, Layer>;
	readonly frame: Float32Array;
	readonly bytes: Uint8Array;

	palette: Palette = makePalette({ base: 320, accent: 185 });
	hueShift = 0;
	motion = 1;
	/** Cue-level ceiling, 0..1. */
	intensity = 1;
	/** User master fader, 0..1. */
	brightness = 1;

	readonly flashLimiter: FlashLimiter;
	private readonly meanLevel = new MeanLevel();
	private readonly slew: BrightnessSlew;
	private readonly ctx: RenderCtx;
	readonly geometry: Geometry;

	constructor(geometry: Geometry) {
		this.geometry = geometry;
		const n = geometry.count;
		this.frame = new Float32Array(n * 3);
		this.bytes = new Uint8Array(n * 3);
		this.slew = new BrightnessSlew(n * 3);
		this.flashLimiter = new FlashLimiter();

		this.layers = Object.fromEntries(
			LAYER_ROLES.map((role) => [role, new Layer(role, n)])
		) as Record<LayerRole, Layer>;

		this.ctx = {
			g: geometry,
			f: null as unknown as ShowFrame,
			p: {},
			palette: this.palette,
			hueShift: 0,
			motion: 1
		};
	}

	get meanHeadroom(): number {
		return this.flashLimiter.headroom;
	}

	render(f: ShowFrame): void {
		const ctx = this.ctx;
		ctx.f = f;
		ctx.hueShift = this.hueShift;
		ctx.motion = this.motion;

		this.frame.fill(0);

		for (const role of LAYER_ROLES) {
			const layer = this.layers[role];
			if (!layer.enabled || !layer.effect) continue;
			ctx.p = layer.params;
			ctx.palette = this.palette;
			layer.effect.render(layer.buf, ctx);
			blend(this.frame, layer.buf, layer.blendMode, layer.opacity);
		}

		// Exposure headroom above 1.0 on purpose: the 3D preview tone-maps HDR values into
		// a blown-out core with coloured fringes, which is what a camera sees looking at an
		// LED. Clipping here instead would make them read as flat stickers.
		const scale = this.intensity * this.brightness * 1.4;
		if (scale !== 1) for (let i = 0; i < this.frame.length; i++) this.frame[i] *= scale;

		this.slew.apply(this.frame, f.dt);
		this.flashLimiter.apply(this.frame, f.t, f.dt);
		this.meanLevel.apply(this.frame, f.dt, f.energy > 0.02);
		compressHighlights(this.frame);
		quantize(this.frame, this.bytes);
	}

	reset(): void {
		for (const role of LAYER_ROLES) this.layers[role].reset();
		this.frame.fill(0);
		this.bytes.fill(0);
		this.meanLevel.reset();
		this.slew.reset();
		this.flashLimiter.reset();
	}
}
