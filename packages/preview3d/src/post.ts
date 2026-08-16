import * as THREE from 'three';
import {
	BloomEffect,
	EffectComposer,
	EffectPass,
	KernelSize,
	RenderPass,
	ToneMappingEffect,
	ToneMappingMode
} from 'postprocessing';

/**
 * Bloom then ACES, both in HDR.
 *
 * LED values are pushed above 1.0 so the tone mapper rolls them into a blown-out core with
 * coloured fringes, which is what a camera sees looking at an LED. Without it they read as flat
 * stickers.
 */
export function createComposer(
	renderer: THREE.WebGLRenderer,
	scene: THREE.Scene,
	camera: THREE.Camera
): { composer: EffectComposer; bloom: BloomEffect } {
	const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType });
	composer.addPass(new RenderPass(scene, camera));

	const bloom = new BloomEffect({
		intensity: 2.1,
		// Low threshold on purpose so dim LEDs glow too. The scene is selective by construction,
		// because the walls are dark and matte, so plain bloom suffices; SelectiveBloomEffect is
		// documented-buggy with InstancedMesh.
		luminanceThreshold: 0.2,
		luminanceSmoothing: 0.2,
		mipmapBlur: true,
		radius: 0.86,
		kernelSize: KernelSize.LARGE
	});
	composer.addPass(
		new EffectPass(camera, bloom, new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }))
	);

	return { composer, bloom };
}
