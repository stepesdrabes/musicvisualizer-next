import * as THREE from 'three';
import type { Geometry, StripSpec } from '@mv/core';
import { LIGHTING } from './lighting.ts';

/**
 * One row per strip, one texel per LED: the single copy of the show, read both by the strips that
 * draw it and by the surfaces it falls on, so what a fixture shows and what it throws cannot
 * disagree.
 *
 * 8-bit because the bytes are already gamma-encoded PWM values, which are linear in emitted
 * light. LINEAR magnification gives LED-to-LED blending for free, which is the frosted-diffuser
 * look; NEAREST shows the raw pixels instead.
 */
export class LedTexture {
	readonly texture: THREE.DataTexture;
	readonly width: number;
	readonly height: number;

	/** The Frame's average colour this frame, wired live into every surface material. */
	readonly ambient = { value: new THREE.Color(0, 0, 0) };

	private readonly geometry: Geometry;
	private readonly data: Uint8Array;

	constructor(geometry: Geometry) {
		this.geometry = geometry;
		this.width = Math.max(...geometry.strips.map((s) => s.count));
		this.height = geometry.strips.length;
		this.data = new Uint8Array(this.width * this.height * 4);
		for (let i = 3; i < this.data.length; i += 4) this.data[i] = 255;

		this.texture = new THREE.DataTexture(
			this.data,
			this.width,
			this.height,
			THREE.RGBAFormat,
			THREE.UnsignedByteType
		);
		this.texture.minFilter = THREE.LinearFilter;
		this.texture.magFilter = THREE.LinearFilter;
		this.texture.wrapS = THREE.ClampToEdgeWrapping;
		this.texture.wrapT = THREE.ClampToEdgeWrapping;
		this.texture.colorSpace = THREE.NoColorSpace;
		this.texture.needsUpdate = true;
	}

	set diffused(v: boolean) {
		this.texture.magFilter = v ? THREE.LinearFilter : THREE.NearestFilter;
		this.texture.needsUpdate = true;
	}
	get diffused(): boolean {
		return this.texture.magFilter === THREE.LinearFilter;
	}

	/** Where a strip's texels live, as (u span, u offset, v row). */
	rowUv(strip: StripSpec): THREE.Vector3 {
		return new THREE.Vector3(
			(strip.count - 1) / this.width,
			0.5 / this.width,
			(strip.id + 0.5) / this.height
		);
	}

	/** Zero allocations. The upload is a few kB per frame, noise next to the bloom. */
	upload(bytes: Uint8Array): void {
		const g = this.geometry;
		const td = this.data;
		let ar = 0;
		let ag = 0;
		let ab = 0;

		for (const strip of g.strips) {
			const rowBase = strip.id * this.width * 4;
			for (let k = 0; k < strip.count; k++) {
				const s = (strip.offset + k) * 3;
				const o = rowBase + k * 4;
				const r = bytes[s];
				const gg = bytes[s + 1];
				const b = bytes[s + 2];
				td[o] = r;
				td[o + 1] = gg;
				td[o + 2] = b;
				ar += r;
				ag += gg;
				ab += b;
			}
		}
		this.texture.needsUpdate = true;

		const k = LIGHTING.frameAmbient / (g.count * 255);
		this.ambient.value.setRGB(ar * k, ag * k, ab * k);
	}

	dispose(): void {
		this.texture.dispose();
	}
}
