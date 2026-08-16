import * as THREE from 'three';
import type { Geometry, RoomSpec } from '@mv/core';
import { LedTexture } from '../LedTexture.ts';
import { buildBounceLamp } from './bounceLamp.ts';
import { LedDots, buildStrips } from './fixture.ts';
import { buildRoom } from './room.ts';
import { SurfaceFactory } from './surfaceMaterial.ts';

/** Everything that is drawn: the room, both fixtures, and the LED texture they all share. */
export class RoomScene {
	readonly scene = new THREE.Scene();
	readonly led: LedTexture;
	readonly dots: LedDots;

	private readonly surfaces: SurfaceFactory;

	constructor(geometry: Geometry, spec: RoomSpec) {
		this.led = new LedTexture(geometry);
		this.surfaces = new SurfaceFactory(this.led, geometry, spec);
		this.dots = new LedDots(geometry);

		this.scene.background = new THREE.Color(0x05050a);
		this.scene.add(...buildRoom(spec, this.surfaces));
		this.scene.add(buildBounceLamp(spec, this.surfaces));
		this.scene.add(...buildStrips(geometry, this.led));
		this.scene.add(this.dots.mesh);
	}

	/**
	 * `bounce` is the Bounce Lamp's one gamma-encoded pixel. It is a second fixture rather than a
	 * tail on the first, so it arrives separately and nothing indexing the room can run off the
	 * end into it.
	 */
	update(bytes: Uint8Array, bounce?: Uint8Array): void {
		this.led.upload(bytes);
		if (bounce) {
			this.surfaces.lampColor.value.setRGB(bounce[0] / 255, bounce[1] / 255, bounce[2] / 255);
		}
		this.dots.update(bytes);
	}

	dispose(): void {
		this.led.dispose();
		this.scene.traverse((o) => {
			const mesh = o as THREE.Mesh;
			if (mesh.geometry) mesh.geometry.dispose();
			const mat = mesh.material;
			if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
			else if (mat) (mat as THREE.Material).dispose();
		});
	}
}
