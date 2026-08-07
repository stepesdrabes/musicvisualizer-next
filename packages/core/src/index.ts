export type { Geometry, RoomSpec, StripSpec, Vec3 } from './contracts/room.ts';
export type { SectionKind, ShowFrame, Band as BandType } from './contracts/frame.ts';
export {
	BAND_EDGES_HZ,
	BAND_NAMES,
	Band,
	NUM_BANDS,
	SECTION_KINDS,
	SPECTRUM_BANDS,
	createShowFrame
} from './contracts/frame.ts';
export type {
	BlendMode,
	Effect,
	EffectDef,
	EffectTaste,
	LayerRole,
	ParamSpec,
	Params,
	RenderCtx
} from './contracts/effect.ts';
export { LAYER_ROLES } from './contracts/effect.ts';
export type { Palette, ShowPalette, SlotName } from './contracts/palette.ts';
export { PALETTE_ANCHORS, SLOT } from './contracts/palette.ts';
export type {
	BarRow,
	Envelopes,
	EventTag,
	KeyEstimate,
	Moment,
	OnsetStream,
	SectionSpan,
	SpectrumTrack,
	StereoImage,
	TempoGrid,
	TrackAnalysis
} from './contracts/analysis.ts';
export { ANALYSIS_VERSION } from './contracts/analysis.ts';
export { decodeBase64, encodeBase64 } from './base64.ts';
export type {
	Cue,
	CuePalette,
	GeneratedEffect,
	Hit,
	HitRule,
	LayerSpec,
	Show
} from './contracts/show.ts';
export { HIT_RULES, SHOW_VERSION } from './contracts/show.ts';
export type { LedFrame, LedSink, LedSinkStats } from './contracts/sink.ts';

export { DEFAULT_ROOM, buildGeometry } from './geometry.ts';
export { hsv2rgb } from './color/hsv.ts';
export { addSample, blendPalettes, makePalette, sample, setSample, swapped } from './color/palette.ts';
export {
	BARS_PER_PHRASE,
	PHRASE_BARS,
	barAtTime,
	barDurationAt,
	barTimeAt,
	hitSeconds,
	nearestPhraseBar,
	nextPhraseBar,
	onPhraseGrid,
	phraseOffset
} from './grid.ts';
export { Rng, hash01 } from './dsl/rng.ts';
export { Layer, Mixer } from './mixer.ts';
export { ShowPlayer } from './player.ts';
export { BUILT_IN_EFFECTS, EffectRegistry } from './effects/index.ts';
export { runGate, scriptFrames, type GateResult } from './effects/gate.ts';
export {
	SANDBOX_API,
	compileGenerated,
	type CompileResult,
	type SandboxApi
} from './effects/sandbox.ts';
export {
	BrightnessSlew,
	FlashLimiter,
	MeanLevel,
	blend,
	compressHighlights,
	quantize
} from './output.ts';
