import * as THREE from 'three';
import type { BloomEffect, EffectComposer } from 'postprocessing';
import type { Geometry } from '@mv/core';
import { CameraRig } from './CameraRig.ts';
import { createComposer } from './post.ts';
import { RoomScene } from './scene/RoomScene.ts';
import type { CameraView, RoomRendererOptions, Viewport } from './types.ts';

/**
 * Device pixels the bloom chain may work over, before the ratio is reduced.
 *
 * The chain costs roughly linearly in pixels, and 60 fps is not a preference here: the preview is
 * what a show is judged by, and one that stutters in the preview reads as a show that stutters.
 * Retina sharpness is the cheaper thing to give up, because almost everything on screen is a soft
 * glow that bloom has already blurred.
 */
const PIXEL_BUDGET = 3_000_000;

/** The room in a canvas: a scene, a camera rig and the post chain that makes LEDs read as LEDs. */
export class RoomRenderer {
	private readonly renderer: THREE.WebGLRenderer;
	private readonly room: RoomScene;
	private readonly rig: CameraRig;
	private readonly composer: EffectComposer;
	private readonly bloom: BloomEffect;
	private disposed = false;

	constructor(canvas: HTMLCanvasElement, geometry: Geometry, opts: RoomRendererOptions) {
		this.renderer = new THREE.WebGLRenderer({
			canvas,
			antialias: false,
			powerPreference: 'high-performance',
			stencil: false,
			depth: true
		});
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		// Tone mapping happens in the post chain, after bloom, in HDR.
		this.renderer.toneMapping = THREE.NoToneMapping;
		this.renderer.outputColorSpace = THREE.SRGBColorSpace;

		this.room = new RoomScene(geometry, opts.spec);
		this.rig = new CameraRig(canvas, opts.spec);

		const post = createComposer(this.renderer, this.room.scene, this.rig.camera);
		this.composer = post.composer;
		this.bloom = post.bloom;
	}

	/** LINEAR filtering across the LED texture: the frosted channel rather than raw pixels. */
	set diffused(v: boolean) {
		this.room.led.diffused = v;
	}
	get diffused(): boolean {
		return this.room.led.diffused;
	}

	set showDots(v: boolean) {
		this.room.dots.visible = v;
	}
	get showDots(): boolean {
		return this.room.dots.visible;
	}

	set bloomIntensity(v: number) {
		this.bloom.intensity = v;
	}
	get bloomIntensity(): number {
		return this.bloom.intensity;
	}

	setView(view: CameraView): void {
		this.rig.setView(view);
	}

	resize(width: number, height: number, viewport?: Viewport): void {
		if (width <= 0 || height <= 0) return;
		this.rig.resize(width, height, viewport);

		const ratio = Math.max(
			1,
			Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(PIXEL_BUDGET / (width * height)))
		);
		// Before setSize on either: the composer sizes its buffers from the renderer's ratio.
		if (Math.abs(ratio - this.renderer.getPixelRatio()) > 0.01) this.renderer.setPixelRatio(ratio);

		this.renderer.setSize(width, height, false);
		this.composer.setSize(width, height);
	}

	render(bytes: Uint8Array, dt: number, bounce?: Uint8Array): void {
		if (this.disposed) return;
		this.room.update(bytes, bounce);
		this.rig.update(dt);
		this.composer.render(dt);
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.rig.dispose();
		this.composer.dispose();
		this.room.dispose();
		this.renderer.dispose();
	}
}
