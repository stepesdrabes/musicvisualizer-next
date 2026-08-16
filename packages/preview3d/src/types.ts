import type { RoomSpec } from '@mv/core';

export type CameraView = 'orbit' | 'top' | 'front';

/**
 * The part of the canvas the room is meant to read as being in, in canvas pixels.
 *
 * The canvas is the whole window - the chrome floats on top of it so a lit room glows through the
 * panels - but the room is judged in the gap between them. Fitting it to the canvas instead puts
 * a third of it behind the rails and the player bar.
 */
export interface Viewport {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface RoomRendererOptions {
	spec: RoomSpec;
}
