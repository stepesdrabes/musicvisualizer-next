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

export interface RoomSpec {
	name: string;
	width: number;
	depth: number;
	height: number;
	/** LEDs per metre. */
	density: number;
	wallStripHeight: number;
	beamHeight: number;
	/** 'y' means the beam spans the `depth` dimension. */
	beamAxis: 'x' | 'y';
	beamOffset: number;
}

/**
 * Per-LED attribute tables. Built once from a RoomSpec; effects read these and never
 * compute positions themselves.
 *
 * `nx/ny/nz` are normalised by the single largest room extent, never per-axis. Per-axis
 * normalisation turns circles into ellipses and makes a sweep cross different walls at
 * different speeds.
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
