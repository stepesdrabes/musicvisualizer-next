/** 16 anchor colours x 3 channels, linearly interpolated, indexed 0..1 with wrap. */
export type Palette = Float32Array;

export const PALETTE_ANCHORS = 16;

/**
 * Named sample positions. Effects address colour by slot, never by hue, which is why
 * swapping a palette under a running look stays coherent and why a show's declared
 * colours reach every effect without any of them knowing.
 */
export const SLOT = {
	/** Near-black shade of the base hue. Beds decay toward this. */
	deep: 0.06,
	/** The room's home colour. */
	base: 0.22,
	/** Brighter, softer read of the base. Wash body. */
	glow: 0.38,
	/** Faintly tinted white. Peaks, flashes, meter tips. */
	white: 0.5,
	/** Texture and variety layers. */
	third: 0.64,
	/** Answers, drops, punctuation. */
	accent: 0.8,
	accentDeep: 0.94
} as const;

export type SlotName = keyof typeof SLOT;

/** Hues in HSV degrees. Two hues 150-180 apart plus white; a third competing hue muds. */
export interface ShowPalette {
	name?: string;
	base: number;
	accent: number;
	third?: number;
	/** Body saturation. 0.94 is the sweet spot; 1.0 is reserved for accents. */
	sat?: number;
	/** Depth of the near-black beds decay into. */
	shade?: number;
	/** 0 is pure white; higher tints the highlight. */
	white?: number;
}
