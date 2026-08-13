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

/** Scratch for the framing maths, which runs on every resize. Module-level, so it allocates once. */
const FIT_EYE = new THREE.Vector3();
const FIT_CORNER = new THREE.Vector3();
const FIT_RIGHT = new THREE.Vector3();
const FIT_UP = new THREE.Vector3();
const POSE_POS = new THREE.Vector3();
const POSE_TARGET = new THREE.Vector3();
const GLIDE_OFFSET = new THREE.Vector3();
const GLIDE_AT = new THREE.Spherical();
const UP_Y = new THREE.Vector3(0, 1, 0);

/**
 * How long a preset takes to arrive.
 *
 * Long enough to read as the room turning rather than as a cut, short enough that somebody
 * comparing two angles is not waiting on it.
 */
const GLIDE_SECONDS = 0.55;

/** Zero first AND second derivative at both ends, so the move has no visible start or stop. */
function smoother(t: number): number {
	return t * t * t * (t * (t * 6 - 15) + 10);
}

/** The short way round a circle, so a move never takes the long way for want of a wrap. */
function shortestTurn(delta: number): number {
	return delta - Math.PI * 2 * Math.round(delta / (Math.PI * 2));
}

export type CameraView = 'orbit' | 'top' | 'front';

/**
 * The part of the canvas the room is meant to read as being in, in canvas pixels.
 *
 * The canvas is the whole window - the chrome floats on top of it so a lit room glows through
 * the panels - but the room is judged in the gap between them. Fitting it to the canvas puts a
 * third of it behind the rails and the player bar.
 */
export interface Viewport {
	x: number;
	y: number;
	width: number;
	height: number;
}

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

	/**
	 * Which preset the camera is still sitting on, or null once it has been orbited.
	 *
	 * A preset re-frames itself when the window changes shape; a camera the user has moved does
	 * not, because being pulled back to a canned distance on the next resize is the room
	 * fighting them.
	 */
	private framed: CameraView | null = 'orbit';

	/**
	 * A preset arriving, in orbit coordinates rather than in world ones.
	 *
	 * Interpolating the position directly would send the camera along a chord, and a chord cuts
	 * inside its own arc: Orbit to Top falls from 7.4 m out to 6.0 and back to 8.3, so the room
	 * swells about a quarter larger halfway through a move that should only be a turn. Turning
	 * the azimuth and the elevation instead holds the distance, which is the path a hand on the
	 * mouse would have taken anyway.
	 */
	private glide: {
		from: THREE.Spherical;
		to: THREE.Spherical;
		fromTarget: THREE.Vector3;
		toTarget: THREE.Vector3;
		t: number;
	} | null = null;

	/** `Spherical` is defined about +y and this room stands on +z, so poses convert through these. */
	private readonly toOrbit = new THREE.Quaternion();
	private readonly fromOrbit = new THREE.Quaternion();

	private canvas = { width: 1, height: 1 };
	private viewport: Viewport = { x: 0, y: 0, width: 1, height: 1 };

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

		// Both are placeholders: `applyProjection` derives them from the viewport on first resize.
		this.camera = new THREE.PerspectiveCamera(RoomRenderer.VIEW_FOV, 1, 0.1, 40);
		this.camera.position.set(spec.width * 0.85, -spec.depth * 1.15, spec.height * 0.75);
		this.camera.up.set(0, 0, 1);

		this.controls = new OrbitControls(this.camera, canvas);
		this.controls.target.set(0, 0, spec.height * 0.45);
		this.controls.enableDamping = true;
		this.controls.dampingFactor = 0.08;
		this.controls.minDistance = 0.8;
		this.controls.maxDistance = 22;
		// Touching the camera hands it over: from here it is the user's until a preset is pressed,
		// and a move still arriving gives way rather than fighting the drag.
		this.controls.addEventListener('start', () => {
			this.framed = null;
			this.glide = null;
		});
		this.controls.update();

		this.toOrbit.setFromUnitVectors(this.camera.up, UP_Y);
		this.fromOrbit.copy(this.toOrbit).invert();

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
	 * Move to a preset, going round the room rather than through it.
	 *
	 * Pressing the same preset twice arrives at once, which doubles as a way to cut a move short.
	 * The first call is also instant: the constructor already sits on `orbit`, so animating the
	 * fit it has not had yet would be a lurch on the first frame anyone sees.
	 */
	setView(view: CameraView): void {
		const arrived = this.framed === view;
		this.framed = view;
		this.poseFor(view, POSE_POS, POSE_TARGET);

		if (arrived) {
			this.glide = null;
			this.camera.position.copy(POSE_POS);
			this.controls.target.copy(POSE_TARGET);
			this.controls.update();
			return;
		}
		this.startGlide(POSE_POS, POSE_TARGET);
	}

	/**
	 * Where a preset ends up, without touching the live camera.
	 *
	 * `top` is deliberately a few degrees off vertical. OrbitControls derives azimuth from
	 * `camera.up`, which is +z here, so a camera directly overhead sits at polar angle zero
	 * where azimuth is undefined and the first drag snaps wildly.
	 */
	private poseFor(view: CameraView, pos: THREE.Vector3, target: THREE.Vector3): void {
		const s = this.opts.spec;
		switch (view) {
			case 'top':
				pos.set(0, -s.depth * 0.14, s.height * 3.1);
				target.set(0, 0, 0);
				break;
			case 'front':
				pos.set(0, -s.depth * 2.1, s.height * 0.62);
				target.set(0, 0, s.height * 0.45);
				break;
			default:
				pos.set(s.width * 0.85, -s.depth * 1.15, s.height * 0.75);
				target.set(0, 0, s.height * 0.45);
				break;
		}
		this.fit(pos, target);
	}

	/** A pose as an orbit around its own target: azimuth, elevation, distance. */
	private orbitOf(pos: THREE.Vector3, target: THREE.Vector3, out: THREE.Spherical): void {
		out.setFromVector3(GLIDE_OFFSET.copy(pos).sub(target).applyQuaternion(this.toOrbit));
	}

	private startGlide(toPos: THREE.Vector3, toTarget: THREE.Vector3): void {
		const g =
			this.glide ??
			(this.glide = {
				from: new THREE.Spherical(),
				to: new THREE.Spherical(),
				fromTarget: new THREE.Vector3(),
				toTarget: new THREE.Vector3(),
				t: 0
			});

		// From wherever the camera actually is, so interrupting one move with another picks up
		// mid-flight rather than jumping back to where the last one started.
		this.orbitOf(this.camera.position, this.controls.target, g.from);
		g.fromTarget.copy(this.controls.target);
		this.aimGlide(toPos, toTarget);
		g.t = 0;
	}

	/** Point an in-flight move at a (possibly new) destination, keeping where it has got to. */
	private aimGlide(toPos: THREE.Vector3, toTarget: THREE.Vector3): void {
		const g = this.glide;
		if (!g) return;
		this.orbitOf(toPos, toTarget, g.to);
		g.to.theta = g.from.theta + shortestTurn(g.to.theta - g.from.theta);
		g.toTarget.copy(toTarget);
	}

	private advanceGlide(dt: number): void {
		const g = this.glide;
		if (!g) return;
		g.t = Math.min(1, g.t + dt / GLIDE_SECONDS);
		const e = smoother(g.t);

		this.controls.target.lerpVectors(g.fromTarget, g.toTarget, e);
		GLIDE_AT.theta = g.from.theta + (g.to.theta - g.from.theta) * e;
		GLIDE_AT.phi = g.from.phi + (g.to.phi - g.from.phi) * e;
		// Geometric, so closing half the gap looks the same from three metres as from twelve.
		GLIDE_AT.radius =
			Math.max(1e-4, g.from.radius) * Math.pow(g.to.radius / Math.max(1e-4, g.from.radius), e);
		GLIDE_AT.makeSafe();

		this.camera.position
			.copy(this.controls.target)
			.add(GLIDE_OFFSET.setFromSpherical(GLIDE_AT).applyQuaternion(this.fromOrbit));

		if (g.t >= 1) this.glide = null;
	}

	/** A little air past the room's own extent, so a bloom halo is not clipped by the frame. */
	private static readonly FIT_MARGIN = 1.04;

	/** The vertical field of view the room is framed with, over the viewport rather than the canvas. */
	private static readonly VIEW_FOV = 52;

	/**
	 * Shear the frustum so the viewport is the window, without moving the camera.
	 *
	 * The obvious alternative - translate the whole rig until the room sits over the viewport -
	 * is wrong here, and expensively so: a world-space shift displaces near geometry further on
	 * screen than far, so correcting for it means backing off, which enlarges the shift, which
	 * means backing off again. Measured across the real layouts it settles with the room at
	 * under half the height it should have. An off-axis projection has no such feedback: the
	 * camera stays on the axis through the room and only the projection is off-centre, which is
	 * the same construction a window onto a scene uses on any multi-display wall.
	 */
	private applyProjection(): void {
		const { width, height } = this.canvas;
		const v = this.viewport;
		const cx = v.x + v.width / 2;
		const cy = v.y + v.height / 2;
		// A virtual frame centred on the viewport and large enough to contain the canvas, so the
		// canvas is an off-centre cut of it.
		const halfW = Math.max(cx, width - cx);
		const halfH = Math.max(cy, height - cy);
		const t = Math.tan((RoomRenderer.VIEW_FOV * Math.PI) / 360);

		// `fov` describes the virtual frame, so it is the viewport's own angle scaled up by how
		// much taller that frame is.
		this.camera.fov = (2 * Math.atan((t * 2 * halfH) / v.height) * 180) / Math.PI;
		this.camera.aspect = halfW / halfH;
		this.camera.setViewOffset(2 * halfW, 2 * halfH, halfW - cx, halfH - cy, width, height);
		this.camera.updateProjectionMatrix();
	}

	/**
	 * Push the camera along its own sight line until the whole room is inside the frustum.
	 *
	 * Both screen axes, not just the vertical one the FOV is defined on: at a wide, short
	 * viewport the limit is height and at a narrow one it is width, which is why a fixed
	 * distance cropped the room whenever the drawer opened or a rail was collapsed.
	 *
	 * Solved per corner rather than from the bounding box's extent, because the two are not the
	 * same answer: the corner nearest the camera subtends the largest angle and is rarely the one
	 * furthest off-axis. Bounding both and adding them backs off about 20% too far, which shows
	 * up as the room shrinking on the ordinary window it used to fit.
	 */
	private fit(pos: THREE.Vector3, target: THREE.Vector3): void {
		const s = this.opts.spec;
		const eye = FIT_EYE.copy(pos).sub(target);
		const dist = eye.length();
		if (dist < 1e-4) return;
		eye.divideScalar(dist);

		const right = FIT_RIGHT.crossVectors(eye, this.camera.up);
		// Looking straight along `up` leaves no horizontal to measure. `top` is tilted off
		// vertical for OrbitControls' sake, so this only guards against a camera set by hand.
		if (right.lengthSq() < 1e-8) return;
		right.normalize();
		const up = FIT_UP.crossVectors(right, eye).normalize();

		// The viewport's own angles: the projection has already been sheared so that the camera
		// axis runs through the middle of it, which is what lets this ignore the canvas entirely.
		const fitV = Math.tan((RoomRenderer.VIEW_FOV * Math.PI) / 360);
		const fitH = fitV * (this.viewport.width / this.viewport.height);

		// A corner sits at depth `at - u.eye` and at a fixed offset across the screen, so the
		// distance it needs is `u.eye + offset / tan(half fov)`. The room wants the largest.
		let need = 0;
		for (let corner = 0; corner < 8; corner++) {
			const u = FIT_CORNER.set(
				(corner & 1 ? 0.5 : -0.5) * s.width,
				(corner & 2 ? 0.5 : -0.5) * s.depth,
				corner & 4 ? s.height : 0
			).sub(target);
			const along = u.dot(eye);
			need = Math.max(
				need,
				along + Math.abs(u.dot(up)) / fitV,
				along + Math.abs(u.dot(right)) / fitH
			);
		}

		const at = Math.max(
			this.controls.minDistance,
			Math.min(this.controls.maxDistance, need * RoomRenderer.FIT_MARGIN)
		);
		pos.copy(target).addScaledVector(eye, at);
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
					uCount: { value: strip.count },
					uGain: { value: gain }
				},
				vertexShader: STRIP_VS,
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

	/**
	 * Device pixels the bloom chain may work over, before the ratio is reduced.
	 *
	 * The chain costs roughly linearly in pixels, and 60 fps is not a preference here: the
	 * preview is what the room is judged by, and a show that stutters in the preview reads as
	 * a show that stutters. Retina sharpness is the cheaper thing to give up, because almost
	 * everything on screen is a soft glow that bloom has already blurred.
	 */
	private static readonly PIXEL_BUDGET = 3_000_000;

	resize(width: number, height: number, viewport?: Viewport): void {
		if (width <= 0 || height <= 0) return;
		this.canvas = { width, height };
		this.viewport =
			viewport && viewport.width > 0 && viewport.height > 0
				? viewport
				: { x: 0, y: 0, width, height };
		this.applyProjection();
		// A preset means the same thing at every window shape, so it re-fits. A camera the user
		// has orbited is theirs, and a resize is not a reason to take it back.
		if (this.framed) {
			this.poseFor(this.framed, POSE_POS, POSE_TARGET);
			// A move already in flight is re-aimed rather than cancelled, so a window resized
			// mid-turn lands on the new framing instead of the one it set off for.
			if (this.glide) {
				this.aimGlide(POSE_POS, POSE_TARGET);
			} else {
				this.camera.position.copy(POSE_POS);
				this.controls.target.copy(POSE_TARGET);
			}
			this.controls.update();
		}

		const ratio = Math.max(
			1,
			Math.min(
				window.devicePixelRatio || 1,
				2,
				Math.sqrt(RoomRenderer.PIXEL_BUDGET / (width * height))
			)
		);
		// Before setSize on either: the composer sizes its buffers from the renderer's ratio.
		if (Math.abs(ratio - this.renderer.getPixelRatio()) > 0.01) this.renderer.setPixelRatio(ratio);

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

		// Before the controls, so they read the pose this frame arrived at rather than last one's.
		if (this.glide) this.advanceGlide(dt);
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

const STRIP_VS = /* glsl */ `
	varying vec2 vUv;
	varying float vDist;
	void main() {
		vUv = uv;
		vec4 mv = modelViewMatrix * vec4(position, 1.0);
		vDist = -mv.z;
		gl_Position = projectionMatrix * mv;
	}
`;

const STRIP_FS = /* glsl */ `
	uniform sampler2D uLed;
	uniform float uUScale;
	uniform float uUOffset;
	uniform float uRow;
	uniform float uCount;
	uniform float uGain;
	varying vec2 vUv;
	varying float vDist;

	void main() {
		// Two readings of the same strip. Far away, the linear-filtered texture is the frosted
		// diffuser the eye actually sees across a room. Up close a real strip resolves into
		// discrete emitters behind the frost, so the near reading samples the LED's own texel
		// and shades a dot around it, with the space between dots carrying only bleed. The
		// crossfade tracks camera distance the way focus does; nothing pops.
		vec3 frosted = texture2D(uLed, vec2(vUv.x * uUScale + uUOffset, uRow)).rgb;

		float cell = vUv.x * uCount;
		float centre = (floor(cell) + 0.5) / uCount;
		vec3 led = texture2D(uLed, vec2(centre * uUScale + uUOffset, uRow)).rgb;
		float dx = fract(cell) - 0.5;
		float dy = vUv.y - 0.5;
		float emitter = exp(-dx * dx * 22.0 - dy * dy * 9.0);
		vec3 dotted = led * (0.22 + 1.35 * emitter);

		float near = 1.0 - smoothstep(1.1, 3.2, vDist);
		vec3 c = mix(frosted, dotted, near);

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
