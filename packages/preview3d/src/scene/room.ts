import * as THREE from 'three';
import type { RoomSpec } from '@mv/core';
import type { SurfaceFactory } from './surfaceMaterial.ts';

const UP = new THREE.Vector3(0, 0, 1);
const X = new THREE.Vector3(1, 0, 0);

/**
 * Oriented from an explicit basis rather than from Euler angles, whose order is easy to get
 * subtly wrong here. Wrong rotates the UV axes, and the spill shader then measures
 * distance-from-strip along the wall's length instead of its height, so the falloff never applies
 * and the whole wall washes out uniformly.
 */
function orient(mesh: THREE.Object3D, dir: THREE.Vector3, up: THREE.Vector3): void {
	const z = new THREE.Vector3().crossVectors(dir, up).normalize();
	mesh.quaternion.setFromRotationMatrix(
		new THREE.Matrix4().makeBasis(dir.clone().normalize(), up.clone().normalize(), z)
	);
}

/** The box the fixture hangs in: four walls, a ceiling and a floor. */
export function buildRoom(spec: RoomSpec, surfaces: SurfaceFactory): THREE.Mesh[] {
	const hw = spec.width / 2;
	const hd = spec.depth / 2;
	const H = spec.height;
	const meshes: THREE.Mesh[] = [];

	const walls = [
		{ w: spec.width, at: new THREE.Vector3(0, hd, H / 2), dir: new THREE.Vector3(1, 0, 0) },
		{ w: spec.depth, at: new THREE.Vector3(hw, 0, H / 2), dir: new THREE.Vector3(0, -1, 0) },
		{ w: spec.width, at: new THREE.Vector3(0, -hd, H / 2), dir: new THREE.Vector3(-1, 0, 0) },
		{ w: spec.depth, at: new THREE.Vector3(-hw, 0, H / 2), dir: new THREE.Vector3(0, 1, 0) }
	];

	for (const wall of walls) {
		const mesh = new THREE.Mesh(
			new THREE.PlaneGeometry(wall.w, H, 24, 24),
			surfaces.create({ base: 0x0a0a10, ambient: 0.1 })
		);
		mesh.position.copy(wall.at);
		// dir x up gives the inward normal, so near walls are back-face culled and the camera can
		// orbit outside the room and still see in.
		orient(mesh, wall.dir, UP);
		meshes.push(mesh);
	}

	// The floor is straight under a downward-facing fixture and is the brightest surface in the
	// room; the ceiling catches none of it and only closes the box.
	//
	// `orient` maps the plane's own x onto `dir` and its y onto `up`, so both panels have to put
	// width on the room's x: naming the axes the other way round builds a 4 x 5 m panel over a
	// 5 x 4 m room, which reads as the walls not meeting it.
	for (const [z, dir, base, ambient] of [
		[H, new THREE.Vector3(0, -1, 0), 0x090910, 0.14],
		[0, new THREE.Vector3(0, 1, 0), 0x0a0a0e, 0.1]
	] as const) {
		const panel = new THREE.Mesh(
			new THREE.PlaneGeometry(spec.width, spec.depth, 8, 8),
			surfaces.create({ base, ambient })
		);
		panel.position.set(0, 0, z);
		orient(panel, X, dir);
		meshes.push(panel);
	}

	return meshes;
}
