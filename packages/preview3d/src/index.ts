import type { LedFrame, LedSink, LedSinkStats } from '@mv/core';
import type { RoomRenderer } from './RoomRenderer.ts';

export { RoomRenderer } from './RoomRenderer.ts';
export type { CameraView, RoomRendererOptions } from './RoomRenderer.ts';

/** Wraps the 3D view as a sink, so preview and hardware are fed identically. */
export function createPreviewSink(renderer: RoomRenderer): LedSink {
	const stats: LedSinkStats = { framesSent: 0, framesDropped: 0, bytesSent: 0 };
	return {
		kind: 'preview',
		async open() {},
		send(frame: LedFrame) {
			renderer.render(frame.rgb, frame.dt);
			stats.framesSent++;
			stats.bytesSent += frame.rgb.byteLength;
		},
		async close() {
			renderer.dispose();
		},
		stats() {
			return { ...stats };
		}
	};
}
