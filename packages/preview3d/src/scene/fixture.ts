import * as THREE from 'three';
import type { Geometry } from '@mv/core';
import { LIGHTING } from '../lighting.ts';
import type { LedTexture } from '../LedTexture.ts';
import { STRIP_FRAGMENT, STRIP_VERTEX } from '../shaders/strip.ts';

const STRIP_THICKNESS = 0.03;
/**
 * Metres the strip sits proud of the wall it is mounted on. Coplanar it z-fights, and a real
 * strip in a channel does protrude, so this is also what it looks like.
 */
const STRIP_STANDOFF = 0.012;

/** The Frame as ribbons sampling the LED texture: one per run, the diffuser reading. */
export function buildStrips(geometry: Geometry, led: LedTexture): THREE.Mesh[] {
	return geometry.strips.map((strip) => {
		const [sx, sy, sz] = strip.start;
		const [ex, ey, ez] = strip.end;
		const len = Math.hypot(ex - sx, ey - sy, ez - sz);
		const uv = led.rowUv(strip);

		const mesh = new THREE.Mesh(
			new THREE.PlaneGeometry(len, STRIP_THICKNESS, Math.min(strip.count, 512), 1),
			new THREE.ShaderMaterial({
				uniforms: {
					uLed: { value: led.texture },
					uUScale: { value: uv.x },
					uUOffset: { value: uv.y },
					uRow: { value: uv.z },
					uCount: { value: strip.count },
					uGain: { value: LIGHTING.emitterGain }
				},
				vertexShader: STRIP_VERTEX,
				fragmentShader: STRIP_FRAGMENT,
				// Both sides, so orbiting past a wall does not make its strip vanish.
				side: THREE.DoubleSide,
				toneMapped: false
			})
		);

		const normal = new THREE.Vector3(strip.normal[0], strip.normal[1], strip.normal[2]);
		mesh.position.set(
			(sx + ex) / 2 + normal.x * STRIP_STANDOFF,
			(sy + ey) / 2 + normal.y * STRIP_STANDOFF,
			(sz + ez) / 2 + normal.z * STRIP_STANDOFF
		);

		const dir = new THREE.Vector3(ex - sx, ey - sy, ez - sz).normalize();
		const up = new THREE.Vector3().crossVectors(normal, dir).normalize();
		mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(dir, up, normal));

		return mesh;
	});
}

/** The same LEDs as raw emitters, one instance each: an inspection overlay, off by default. */
export class LedDots {
	readonly mesh: THREE.InstancedMesh;
	private readonly colors: Float32Array;

	constructor(geometry: Geometry) {
		this.colors = new Float32Array(geometry.count * 3);
		// Low-poly on purpose: InstancedMesh is slower than plain meshes once the per-instance
		// geometry gets heavy.
		const geo = new THREE.SphereGeometry(0.007, 6, 4);
		const mat = new THREE.MeshBasicMaterial({ toneMapped: false, vertexColors: true });
		this.mesh = new THREE.InstancedMesh(geo, mat, geometry.count);
		this.mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);

		const m = new THREE.Matrix4();
		for (let i = 0; i < geometry.count; i++) {
			const o = i * 3;
			m.makeTranslation(
				geometry.x[i] + geometry.normal[o] * STRIP_STANDOFF * 1.5,
				geometry.y[i] + geometry.normal[o + 1] * STRIP_STANDOFF * 1.5,
				geometry.z[i] + geometry.normal[o + 2] * STRIP_STANDOFF * 1.5
			);
			this.mesh.setMatrixAt(i, m);
		}
		this.mesh.instanceMatrix.needsUpdate = true;

		this.mesh.instanceColor = new THREE.InstancedBufferAttribute(this.colors, 3);
		this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
		this.mesh.visible = false;
		this.mesh.frustumCulled = false;
	}

	set visible(v: boolean) {
		this.mesh.visible = v;
	}
	get visible(): boolean {
		return this.mesh.visible;
	}

	update(bytes: Uint8Array): void {
		if (!this.mesh.visible) return;
		const c = this.colors;
		for (let i = 0; i < c.length; i++) c[i] = (bytes[i] / 255) * LIGHTING.emitterGain;
		if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
	}
}
