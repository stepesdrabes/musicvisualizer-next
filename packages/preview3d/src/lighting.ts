/**
 * Every brightness in the room, in one place and on one scale.
 *
 * The LEDs render at `emitterGain`; a spill says how far below its own emitter the surfaces it
 * lights sit. Ratios rather than absolute levels, and the distinction is load-bearing: spill used
 * to inherit `emitterGain` - the headroom past 1.0 that lets the tone mapper blow an LED's core
 * out - which drove a white frame's walls to exactly 1.0, clipped before bloom was even added. A
 * room lit by 720 LEDs does not white out its own walls, and a preview that does cannot be
 * judged, because every pale palette looks like every other one.
 */
export const LIGHTING = {
	/**
	 * How far past 1.0 an LED runs, so ACES rolls a bright one into a white core with coloured
	 * fringes. Much beyond this and every saturated colour clips to white instead.
	 */
	emitterGain: 2.0,

	/** The Frame's throw onto the room's surfaces. */
	frameSpill: 0.22,

	/**
	 * A faint global wash carrying the Frame's average colour, so the room reads as one lit space
	 * rather than as glowing lines in the dark. Each surface takes its own share of it.
	 */
	frameAmbient: 0.5,

	/** The Bounce Lamp's tube, on the emitter scale. */
	lampGain: 2.5,

	/**
	 * The lamp's throw, per metre of tube.
	 *
	 * Its own scale rather than a fraction of `frameSpill`, so the two fixtures can be tuned
	 * against each other instead of moving together.
	 */
	lampSpill: 0.26
} as const;
