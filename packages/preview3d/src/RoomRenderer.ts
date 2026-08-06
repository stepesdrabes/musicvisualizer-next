/**
 * Three techniques do the work here:
 *
 *  1. Strips are ribbons sampling a shared LED texture with LINEAR filtering, which gives
 *     LED-to-LED blending for free: the frosted-diffuser look. NEAREST shows raw pixels.
 *  2. Walls sample the SAME texture in their fragment shader with a perpendicular falloff,
 *     so light spill is per-LED at zero extra draw calls. Per-LED PointLights are not an
 *     option: three.js forward-lights, every light is a uniform in every lit shader, and
 *     twenty of them tanks the frame rate.
 *  3. HDR plus ACES tone mapping. LED values are pushed above 1.0 so the tone mapper rolls
 *     them into a blown-out core with coloured fringes, which is what a camera sees looking
 *     at an LED. Without it they read as flat stickers.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
	BloomEffect,
	EffectComposer,
	EffectPass,
	KernelSize,
	RenderPass,
	ToneMappingEffect,
	ToneMappingMode
} from 'postprocessing';
import type { Geometry, RoomSpec } from '@mv/core';

const STRIP_THICKNESS = 0.03;
/** Metres the strip sits proud of its wall, so it does not z-fight with the surface. */
const STRIP_STANDOFF = 0.012;

export type CameraView = 'orbit' | 'top' | 'front';

export interface RoomRendererOptions {
	spec: RoomSpec;
	hdrGain?: number;
}

export class RoomRenderer {
	readonly renderer: THREE.WebGLRenderer;
	readonly scene = new THREE.Scene();
	readonly camera: THREE.PerspectiveCamera;
	readonly controls: OrbitControls;

	private composer: EffectComposer;
	private bloom: BloomEffect;

	private ledTexture: THREE.DataTexture;
	private texData: Uint8Array;
	private readonly texW: number;
	private readonly texH: number;

	private dots: THREE.InstancedMesh | null = null;
	private dotColors: Float32Array;
	private stripMaterials: THREE.ShaderMaterial[] = [];
	private wallMaterials: THREE.ShaderMaterial[] = [];
	private ambientUniform = { value: new THREE.Color(0, 0, 0) };
	private disposed = false;

	set showDots(v: boolean) {
		if (this.dots) this.dots.visible = v;
	}
	get showDots(): boolean {
		return this.dots?.visible ?? false;
	}

	set diffused(v: boolean) {
		this.ledTexture.magFilter = v ? THREE.LinearFilter : THREE.NearestFilter;
		this.ledTexture.needsUpdate = true;
	}
	get diffused(): boolean {
		return this.ledTexture.magFilter === THREE.LinearFilter;
	}

	set bloomIntensity(v: number) {
		this.bloom.intensity = v;
	}
	get bloomIntensity(): number {
		return this.bloom.intensity;
	}

	set hdrGain(v: number) {
		for (const m of this.stripMaterials) m.uniforms.uGain.value = v;
		for (const m of this.wallMaterials) m.uniforms.uSpillGain.value = v * 0.28;
	}

	private readonly geometry: Geometry;
	private readonly opts: RoomRendererOptions;

	constructor(canvas: HTMLCanvasElement, geometry: Geometry, opts: RoomRendererOptions) {
		this.geometry = geometry;
		this.opts = opts;
		const spec = opts.spec;
		// 2.0 rather than 3.0: enough headroom that bright LEDs blow out to a white core with
		// coloured fringes, without every saturated colour clipping to white.
		const gain = opts.hdrGain ?? 2.0;

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

		this.camera = new THREE.PerspectiveCamera(52, 1, 0.1, 40);
		this.camera.position.set(spec.width * 0.85, -spec.depth * 1.15, spec.height * 0.75);
		this.camera.up.set(0, 0, 1);

		this.controls = new OrbitControls(this.camera, canvas);
		this.controls.target.set(0, 0, spec.height * 0.45);
		this.controls.enableDamping = true;
		this.controls.dampingFactor = 0.08;
		this.controls.minDistance = 0.8;
		this.controls.maxDistance = 22;
		this.controls.update();

		this.scene.background = new THREE.Color(0x05050a);

		// One row per strip, one texel per LED. 8-bit because the bytes are already
		// gamma-encoded PWM values, which are linear in emitted light.
		this.texW = Math.max(...geometry.strips.map((s) => s.count));
		this.texH = geometry.strips.length;
		this.texData = new Uint8Array(this.texW * this.texH * 4);
		for (let i = 3; i < this.texData.length; i += 4) this.texData[i] = 255;
		this.ledTexture = new THREE.DataTexture(
			this.texData,
			this.texW,
			this.texH,
			THREE.RGBAFormat,
			THREE.UnsignedByteType
		);
		this.ledTexture.minFilter = THREE.LinearFilter;
		this.ledTexture.magFilter = THREE.LinearFilter;
		this.ledTexture.wrapS = THREE.ClampToEdgeWrapping;
		this.ledTexture.wrapT = THREE.ClampToEdgeWrapping;
		this.ledTexture.colorSpace = THREE.NoColorSpace;
		this.ledTexture.needsUpdate = true;

		this.dotColors = new Float32Array(geometry.count * 3);

		this.buildRoom(spec, gain);
		this.buildStrips(gain);
		this.buildDots();

		this.composer = new EffectComposer(this.renderer, {
			frameBufferType: THREE.HalfFloatType
		});
		this.composer.addPass(new RenderPass(this.scene, this.camera));
		this.bloom = new BloomEffect({
			intensity: 2.1,
			// Low threshold on purpose so dim LEDs glow too. The scene is selective by
			// construction because the walls are dark and matte, so plain bloom suffices;
			// SelectiveBloomEffect is documented-buggy with InstancedMesh.
			luminanceThreshold: 0.2,
			luminanceSmoothing: 0.2,
			mipmapBlur: true,
			radius: 0.86,
			kernelSize: KernelSize.LARGE
		});
		this.composer.addPass(
			new EffectPass(
				this.camera,
				this.bloom,
				new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC })
			)
		);
	}

	/**
	 * `top` is deliberately a few degrees off vertical. OrbitControls derives azimuth from
	 * `camera.up`, which is +z here, so a camera directly overhead sits at polar angle zero
	 * where azimuth is undefined and the first drag snaps wildly.
	 */
	setView(view: CameraView): void {
		const s = this.opts.spec;
		switch (view) {
			case 'top':
				this.camera.position.set(0, -s.depth * 0.14, s.height * 3.1);
				this.controls.target.set(0, 0, 0);
				break;
			case 'front':
				this.camera.position.set(0, -s.depth * 2.1, s.height * 0.62);
				this.controls.target.set(0, 0, s.height * 0.45);
				break;
			default:
				this.camera.position.set(s.width * 0.85, -s.depth * 1.15, s.height * 0.75);
				this.controls.target.set(0, 0, s.height * 0.45);
				break;
		}
		this.controls.update();
	}

	/**
	 * Built from an explicit basis rather than Euler angles. Euler order is easy to get
	 * subtly wrong here, and wrong rotates the UV axes: the spill shader then measures
	 * distance-from-strip along the wall's length instead of its height, so the falloff
	 * never applies and the whole wall washes out uniformly.
	 */
	private orient(mesh: THREE.Object3D, dir: THREE.Vector3, up: THREE.Vector3): void {
		const z = new THREE.Vector3().crossVectors(dir, up).normalize();
		mesh.quaternion.setFromRotationMatrix(
			new THREE.Matrix4().makeBasis(dir.clone().normalize(), up.clone().normalize(), z)
		);
	}

	private buildRoom(spec: RoomSpec, gain: number): void {
		const hw = spec.width / 2;
		const hd = spec.depth / 2;
		const H = spec.height;
		const UP = new THREE.Vector3(0, 0, 1);

		// Same order as geometry.strips 0..3 (N, E, S, W); `dir` matches each strip's LED
		// order so uv.x lines up with the texture without a flip.
		const walls = [
			{ w: spec.width, centre: new THREE.Vector3(0, hd, H / 2), dir: new THREE.Vector3(1, 0, 0) },
			{ w: spec.depth, centre: new THREE.Vector3(hw, 0, H / 2), dir: new THREE.Vector3(0, -1, 0) },
			{ w: spec.width, centre: new THREE.Vector3(0, -hd, H / 2), dir: new THREE.Vector3(-1, 0, 0) },
			{ w: spec.depth, centre: new THREE.Vector3(-hw, 0, H / 2), dir: new THREE.Vector3(0, 1, 0) }
		];

		walls.forEach((wall, row) => {
			const strip = this.geometry.strips[row];
			const geo = new THREE.PlaneGeometry(wall.w, H, 1, 32);
			const mat = this.makeWallMaterial(strip.count, row, spec.wallStripHeight, H, gain);
			const mesh = new THREE.Mesh(geo, mat);
			mesh.position.copy(wall.centre);
			// dir x up gives the inward normal, so near walls are back-face culled and the
			// camera can orbit outside the room and still see in.
			this.orient(mesh, wall.dir, UP);
			this.scene.add(mesh);
			this.wallMaterials.push(mat);
		});

		const beamStrip = this.geometry.strips[4];
		const alongY = spec.beamAxis === 'y';
		const beamDir = alongY ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
		const beamCross = alongY ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, -1, 0);
		const ceilGeo = new THREE.PlaneGeometry(
			alongY ? spec.depth : spec.width,
			alongY ? spec.width : spec.depth,
			32,
			32
		);
		const ceilMat = this.makeCeilingMaterial(beamStrip.count, 4, spec, gain);
		const ceil = new THREE.Mesh(ceilGeo, ceilMat);
		ceil.position.set(0, 0, H);
		this.orient(ceil, beamDir, beamCross);
		this.scene.add(ceil);
		this.wallMaterials.push(ceilMat);

		const floorMat = new THREE.ShaderMaterial({
			uniforms: { uAmbient: this.ambientUniform, uBase: { value: new THREE.Color(0x0a0a10) } },
			vertexShader: BASIC_VS,
			fragmentShader: `
				uniform vec3 uAmbient;
				uniform vec3 uBase;
				varying vec2 vUv;
				void main() {
					// Brighter toward the walls, where the light comes from, but kept well below
					// the walls' level: the floor is furthest from every strip, so a bright floor
					// makes the room read flat.
					vec2 d = abs(vUv - 0.5) * 2.0;
					float edge = max(d.x, d.y);
					gl_FragColor = vec4(uBase + uAmbient * (0.05 + 0.30 * edge * edge), 1.0);
				}
			`
		});
		const floor = new THREE.Mesh(new THREE.PlaneGeometry(spec.width, spec.depth, 8, 8), floorMat);
		this.scene.add(floor);
	}

	private makeWallMaterial(
		ledCount: number,
		row: number,
		stripHeight: number,
		wallHeight: number,
		gain: number
	): THREE.ShaderMaterial {
		return new THREE.ShaderMaterial({
			uniforms: {
				uLed: { value: this.ledTexture },
				uUScale: { value: (ledCount - 1) / this.texW },
				uUOffset: { value: 0.5 / this.texW },
				uRow: { value: (row + 0.5) / this.texH },
				uStripV: { value: stripHeight / wallHeight },
				uWallHeight: { value: wallHeight },
				// ~2.2 per metre gives a pool of light roughly a metre deep below the strip,
				// which is what a real strip in an aluminium channel throws.
				uFalloff: { value: 2.2 },
				uSpillGain: { value: gain * 0.12 },
				uAmbient: this.ambientUniform,
				uBase: { value: new THREE.Color(0x0a0a10) }
			},
			vertexShader: BASIC_VS,
			fragmentShader: SPILL_FS
		});
	}

	private makeCeilingMaterial(
		ledCount: number,
		row: number,
		spec: RoomSpec,
		gain: number
	): THREE.ShaderMaterial {
		const cross = spec.beamAxis === 'y' ? spec.width : spec.depth;
		return new THREE.ShaderMaterial({
			uniforms: {
				uLed: { value: this.ledTexture },
				uUScale: { value: (ledCount - 1) / this.texW },
				uUOffset: { value: 0.5 / this.texW },
				uRow: { value: (row + 0.5) / this.texH },
				uCross: { value: cross },
				uBeamPos: { value: 0.5 },
				uFalloff: { value: 1.6 },
				uSpillGain: { value: gain * 0.16 },
				uAmbient: this.ambientUniform,
				uBase: { value: new THREE.Color(0x090910) }
			},
			vertexShader: BASIC_VS,
			fragmentShader: CEILING_FS
		});
	}

	private buildStrips(gain: number): void {
		for (const strip of this.geometry.strips) {
			const [sx, sy, sz] = strip.start;
			const [ex, ey, ez] = strip.end;
			const len = Math.hypot(ex - sx, ey - sy, ez - sz);

			const geo = new THREE.PlaneGeometry(len, STRIP_THICKNESS, Math.min(strip.count, 512), 1);
			const mat = new THREE.ShaderMaterial({
				uniforms: {
					uLed: { value: this.ledTexture },
					uUScale: { value: (strip.count - 1) / this.texW },
					uUOffset: { value: 0.5 / this.texW },
					uRow: { value: (strip.id + 0.5) / this.texH },
					uGain: { value: gain }
				},
				vertexShader: BASIC_VS,
				fragmentShader: STRIP_FS,
				// Both sides, so orbiting past a wall does not make its strip vanish.
				side: THREE.DoubleSide,
				toneMapped: false
			});

			const mesh = new THREE.Mesh(geo, mat);
			const normal = new THREE.Vector3(strip.normal[0], strip.normal[1], strip.normal[2]);
			// Stand the strip off the wall it is mounted on. Coplanar with the wall it z-fights,
			// and a real strip in a channel does protrude, so this is also what it looks like.
			mesh.position.set(
				(sx + ex) / 2 + normal.x * STRIP_STANDOFF,
				(sy + ey) / 2 + normal.y * STRIP_STANDOFF,
				(sz + ez) / 2 + normal.z * STRIP_STANDOFF
			);

			const dir = new THREE.Vector3(ex - sx, ey - sy, ez - sz).normalize();
			const up = new THREE.Vector3().crossVectors(normal, dir).normalize();
			mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(dir, up, normal));

			this.scene.add(mesh);
			this.stripMaterials.push(mat);
		}
	}

	private buildDots(): void {
		const g = this.geometry;
		// Low-poly on purpose: three.js InstancedMesh is slower than plain meshes once the
		// per-instance geometry gets heavy.
		const geo = new THREE.SphereGeometry(0.007, 6, 4);
		const mat = new THREE.MeshBasicMaterial({ toneMapped: false, vertexColors: true });
		const mesh = new THREE.InstancedMesh(geo, mat, g.count);
		mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);

		const m = new THREE.Matrix4();
		for (let i = 0; i < g.count; i++) {
			const o = i * 3;
			m.makeTranslation(
				g.x[i] + g.normal[o] * STRIP_STANDOFF * 1.5,
				g.y[i] + g.normal[o + 1] * STRIP_STANDOFF * 1.5,
				g.z[i] + g.normal[o + 2] * STRIP_STANDOFF * 1.5
			);
			mesh.setMatrixAt(i, m);
		}
		mesh.instanceMatrix.needsUpdate = true;

		mesh.instanceColor = new THREE.InstancedBufferAttribute(this.dotColors, 3);
		mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
		mesh.visible = false;
		mesh.frustumCulled = false;
		this.scene.add(mesh);
		this.dots = mesh;
	}

	resize(width: number, height: number): void {
		if (width <= 0 || height <= 0) return;
		this.camera.aspect = width / height;
		this.camera.updateProjectionMatrix();
		this.renderer.setSize(width, height, false);
		this.composer.setSize(width, height);
	}

	/** Zero allocations. The texture upload is a few kB per frame, noise next to the bloom. */
	render(bytes: Uint8Array, dt: number): void {
		if (this.disposed) return;
		const g = this.geometry;
		const td = this.texData;

		let ar = 0;
		let ag = 0;
		let ab = 0;

		for (const strip of g.strips) {
			const rowBase = strip.id * this.texW * 4;
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
		this.ledTexture.needsUpdate = true;

		// Average colour feeds the floor and a faint global ambient, so the room reads as one
		// lit space rather than five glowing lines in the dark.
		const inv = 1 / (g.count * 255);
		this.ambientUniform.value.setRGB(ar * inv * 0.5, ag * inv * 0.5, ab * inv * 0.5);

		if (this.dots?.visible) {
			const dc = this.dotColors;
			for (let i = 0; i < g.count; i++) {
				const s = i * 3;
				dc[s] = (bytes[s] / 255) * 2.2;
				dc[s + 1] = (bytes[s + 1] / 255) * 2.2;
				dc[s + 2] = (bytes[s + 2] / 255) * 2.2;
			}
			if (this.dots.instanceColor) this.dots.instanceColor.needsUpdate = true;
		}

		this.controls.update();
		this.composer.render(dt);
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.controls.dispose();
		this.composer.dispose();
		this.ledTexture.dispose();
		this.scene.traverse((o) => {
			const mesh = o as THREE.Mesh;
			if (mesh.geometry) mesh.geometry.dispose();
			const mat = mesh.material;
			if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
			else if (mat) (mat as THREE.Material).dispose();
		});
		this.renderer.dispose();
	}
}

const BASIC_VS = /* glsl */ `
	varying vec2 vUv;
	void main() {
		vUv = uv;
		gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
	}
`;

const STRIP_FS = /* glsl */ `
	uniform sampler2D uLed;
	uniform float uUScale;
	uniform float uUOffset;
	uniform float uRow;
	uniform float uGain;
	varying vec2 vUv;

	void main() {
		vec3 c = texture2D(uLed, vec2(vUv.x * uUScale + uUOffset, uRow)).rgb;
		// Soften across the short axis so it reads as a diffuser channel, not a sticker.
		float core = smoothstep(0.0, 0.42, vUv.y) * smoothstep(1.0, 0.58, vUv.y);
		gl_FragColor = vec4(c * uGain * (0.5 + 0.6 * core), 1.0);
	}
`;

const SPILL_FS = /* glsl */ `
	uniform sampler2D uLed;
	uniform float uUScale;
	uniform float uUOffset;
	uniform float uRow;
	uniform float uStripV;
	uniform float uWallHeight;
	uniform float uFalloff;
	uniform float uSpillGain;
	uniform vec3 uAmbient;
	uniform vec3 uBase;
	varying vec2 vUv;

	vec3 tapLed(float u) {
		return texture2D(uLed, vec2(clamp(u, 0.0, 1.0) * uUScale + uUOffset, uRow)).rgb;
	}

	void main() {
		// Light spreads sideways as it travels, so the lateral blur widens with distance
		// rather than using a fixed kernel: near the strip you see individual LEDs, far
		// away a soft wash.
		float d = abs(vUv.y - uStripV) * uWallHeight;
		float spread = 0.004 + d * 0.10;
		float u = vUv.x;

		vec3 c = tapLed(u) * 0.30;
		c += tapLed(u - spread) * 0.2;
		c += tapLed(u + spread) * 0.2;
		c += tapLed(u - spread * 2.6) * 0.15;
		c += tapLed(u + spread * 2.6) * 0.15;

		// 1/(1+kd) tail on top of the exponential: the exponential alone drops the lower two
		// thirds of the wall to pure black and the room loses its shape.
		float fall = exp(-d * uFalloff) + 0.10 / (1.0 + d * 1.6);
		gl_FragColor = vec4(uBase + uAmbient * 0.30 + c * fall * uSpillGain, 1.0);
	}
`;

const CEILING_FS = /* glsl */ `
	uniform sampler2D uLed;
	uniform float uUScale;
	uniform float uUOffset;
	uniform float uRow;
	uniform float uCross;
	uniform float uBeamPos;
	uniform float uFalloff;
	uniform float uSpillGain;
	uniform vec3 uAmbient;
	uniform vec3 uBase;
	varying vec2 vUv;

	vec3 tapLed(float u) {
		return texture2D(uLed, vec2(clamp(u, 0.0, 1.0) * uUScale + uUOffset, uRow)).rgb;
	}

	void main() {
		float d = abs(vUv.y - uBeamPos) * uCross;
		float spread = 0.006 + d * 0.10;

		vec3 c = tapLed(vUv.x) * 0.34;
		c += tapLed(vUv.x - spread) * 0.2;
		c += tapLed(vUv.x + spread) * 0.2;
		c += tapLed(vUv.x - spread * 2.4) * 0.13;
		c += tapLed(vUv.x + spread * 2.4) * 0.13;

		float fall = exp(-d * uFalloff) + 0.12 / (1.0 + d * 1.4);
		gl_FragColor = vec4(uBase + uAmbient * 0.40 + c * fall * uSpillGain, 1.0);
	}
`;
