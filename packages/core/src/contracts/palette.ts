/** Anchor colours x 3 channels, linearly interpolated, indexed 0..1 with wrap. */
export type Palette = Float32Array;

/**
 * Fifty, and not a round number by accident: every position in `SLOT` times 50 is a whole
 * number, so each named slot lands exactly ON an anchor rather than between two of them.
 *
 * At 16 it did not. `SLOT.accent` fell at 12.8, so asking for the accent returned a blend of
 * one anchor 69% of the way from the third hue toward it and another already fading toward
 * `accentDeep` - up to 0.19 of RGB distance from the colour the show declared, on the one slot
 * a drop is lit with. Every effect addresses colour by slot, so every effect inherited it.
 */
export const PALETTE_ANCHORS = 50;

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
