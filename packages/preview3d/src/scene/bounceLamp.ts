import * as THREE from 'three';
import type { RoomSpec } from '@mv/core';
import { LIGHTING } from '../lighting.ts';
import type { SurfaceFactory } from './surfaceMaterial.ts';

/**
 * The Bounce Lamp: a white diffuser with a strip inside it.
 *
 * So it is a surface before it is an emitter, and it gets the same shader as the walls with a
 * pale albedo and the strip's colour added on top. A tube drawn as emission alone is pure black
 * whenever the show is, which is the one thing a white plastic column never is.
 */
export function buildBounceLamp(spec: RoomSpec, surfaces: SurfaceFactory): THREE.Mesh {
	const b = spec.bounce;
	const geo = new THREE.CylinderGeometry(b.diameter / 2, b.diameter / 2, b.height, 24, 1, true);
	geo.rotateX(Math.PI / 2);

	const mat = surfaces.create({
		base: 0x16171b,
		ambient: 0.5,
		// White plastic returns more of the Frame than a dark wall does.
		reflect: 1.5,
		emit: LIGHTING.lampGain,
		litByLamp: false
	});
	mat.side = THREE.DoubleSide;

	const tube = new THREE.Mesh(geo, mat);
	tube.position.set(b.at[0], b.at[1], b.height / 2);
	return tube;
}
