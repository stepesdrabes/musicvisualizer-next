/** Metres for positions, unit vectors for normals. */
export type Vec3 = readonly [number, number, number];

export interface StripSpec {
	id: number;
	name: string;
	/** First LED index in the global buffer. Also the DDP byte offset / 3. */
	offset: number;
	count: number;
	/** Origin at room centre, floor level, +z up. */
	start: Vec3;
	end: Vec3;
	/** Inward-facing. */
	normal: Vec3;
	inPerimeter: boolean;
}

/** A contiguous run of the global frame. */
export interface LedSpan {
	firstLed: number;
	ledCount: number;
}

/**
 * A named part of the room a single device can be pointed at.
 *
 * More than one span because the perimeter is a ring and the frame is not: a region straddling
 * the seam between the last wall and the first is two runs of the buffer and one place in the
 * room. Every consumer has to handle that, so it is in the shape rather than in a caller.
 */
export interface RoomRegion {
	id: string;
	name: string;
	spans: readonly LedSpan[];
	/** Total LEDs across every span. */
	count: number;
}

/**
 * The pergola, which is not the fixture.
 *
 * The two used to be one object, back when the LEDs ran along the walls and the room's own
 * dimensions were the fixture's. They are separate things now: the room is an open structure
 * that is only ever drawn, and the light hangs inside it.
 */
export interface RoomSpec {
	name: string;
	/** Footprint, metres. */
	width: number;
	depth: number;
	/** Headroom, metres. Nothing is drawn at it; it is what the camera has to hold. */
	height: number;
	fixture: FrameSpec;
	bounce: BounceSpec;
}

/**
 * The Frame: a hanging rectangle plus one crossbar, every LED facing down.
 *
 * Walked as a closed perimeter with the crossbar off it, which is the same shape the room's
 * walls and ceiling beam made, so the ring arithmetic and every effect that asks for "the
 * beam" keep meaning what they meant.
 */
export interface FrameSpec {
	width: number;
	depth: number;
	/** The LED plane, metres above the deck. */
	height: number;
	/** LEDs per metre. */
	density: number;
	/** 'y' means the crossbar spans `depth`. */
	crossAxis: 'x' | 'y';
	/** Metres from the frame's centre, along the axis the crossbar does not span. */
	crossOffset: number;
	/** Aluminium section, metres. Drawn, never lit. */
	section: number;
}

/**
 * The Bounce Lamp: one diffused emitter standing in the room.
 *
 * Not part of `Geometry`, because it carries no position an effect could paint to - it is one
 * colour derived from the show, and the room is what an effect addresses.
 */
export interface BounceSpec {
	/** Floor position, metres, origin at the room centre. */
	at: readonly [number, number];
	height: number;
	diameter: number;
}

/**
 * Per-LED attribute tables. Built once from a RoomSpec; effects read these and never
 * compute positions themselves.
 *
 * `nx/ny/nz` are normalised by the single largest extent of the FIXTURE, never per-axis and
 * never by the room. Per-axis normalisation turns circles into ellipses and makes a sweep
 * cross different runs at different speeds; normalising by the room would leave every LED
 * inside the middle of the range, so every sweep and every radial effect would lose most of
 * its travel to a footprint none of them can reach.
 */
export interface Geometry {
	count: number;
	strips: readonly StripSpec[];

	x: Float32Array;
	y: Float32Array;
	z: Float32Array;

	nx: Float32Array;
	ny: Float32Array;
	nz: Float32Array;

	/** Distance from the vertical centre axis, 0..1 by the half-diagonal. */
	r: Float32Array;
	/** Angle around the vertical axis, 0..1 from +x, counter-clockwise. */
	theta: Float32Array;
	/** 3D distance from the room centre, 0..1. */
	dist: Float32Array;

	strip: Uint8Array;
	/** Position along its own strip, 0..1. */
	local: Float32Array;
	/** Arc length around the perimeter ring, 0..1. -1 when off-perimeter. */
	perim: Float32Array;

	/** 3 floats per LED. */
	normal: Float32Array;

	/** Metres between adjacent LEDs. Converts m/s into pixels/frame. */
	pitch: number;
	extent: number;
	perimeterLength: number;
}
