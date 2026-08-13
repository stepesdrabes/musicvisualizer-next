/**
 * Three techniques do the work here:
 *
 *  1. Strips are ribbons sampling a shared LED texture with LINEAR filtering, which gives
 *     LED-to-LED blending for free: the frosted-diffuser look. NEAREST shows raw pixels.
 *  2. The room's surfaces sample the SAME texture in their fragment shader, walking the
 *     fixture's runs as lines in world space, so light spill is per-LED at zero extra draw
 *     calls. Per-LED PointLights are not an option: three.js forward-lights, every light is
 *     a uniform in every lit shader, and twenty of them tanks the frame rate. There are no
 *     `THREE.Light`s in this scene at all - a standard material added here renders black.
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

/** The lamp's strip runs past 1.0 so the tone mapper blows its core out, as the frame's does. */
const LAMP_GAIN = 1.9;

/**
 * How bright a fully lit fixture makes the surface directly beneath it.
 *
 * The one number the room's whole look hangs off, and it is a ratio rather than a brightness: the
 * tape renders at `hdrGain`, so this says how far below its own emitters the room sits. At 0.30 a
 * white frame puts 0.38 on the floor under it and 0.27 on the walls, against 2.0 on the tape.
 *
 * It used to be tied to `hdrGain` and should never have been. That is the emitters' headroom - how
 * far past 1.0 they run so the tone mapper blows their cores out - and inheriting it drove a white
 * frame's walls to exactly 1.0, clipped white before the bloom was even added. A room lit by 720
 * LEDs at 60/m does not white out its own walls, and a preview that does cannot be judged: every
 * pale palette looks like every other one.
 */
const SPILL = 0.3;

/**
 * The lamp's share of the same scale, per metre of tube.
 *
 * Well under the frame's, because it is: a metre of diffused strip against 720 LEDs. It stands
 * close to two walls, so the falloff does the rest.
 */
const LAMP_SPILL = 0.55;

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
	private ambientUniform = { value: new THREE.Color(0, 0, 0) };
	/**
	 * The Bounce Lamp's one pixel, 0..1.
	 *
	 * Shared by the tube and by every surface it lights, so what the lamp shows and what the lamp
	 * throws cannot disagree. Held without the emitter's own headroom, because the walls want the
	 * colour that actually left it.
	 */
	private bounceColor = { value: new THREE.Color(0, 0, 0) };
	private segments!: { seg: THREE.Vector4[]; uv: THREE.Vector3[] };
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
		this.camera.position.set(spec.width * 0.85, -spec.depth * 1.15, spec.height * 1.15);
		this.camera.up.set(0, 0, 1);

		this.controls = new OrbitControls(this.camera, canvas);
		this.controls.target.set(0, 0, spec.height * 0.38);
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
		this.segments = this.frameSegments();

		this.buildRoom(spec);
		this.buildBounceLamp(spec);
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
				pos.set(s.width * 0.85, -s.depth * 1.15, s.height * 1.15);
				target.set(0, 0, s.height * 0.38);
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

	/**
	 * The room the fixture hangs in: four walls and a ceiling, and nothing else.
	 *
	 * There is no floor. The fixture faces down, so the floor would be the brightest thing on
	 * screen and the room would read as a lit rectangle seen from above rather than as a room -
	 * and the walls are what give the box its shape anyway.
	 */
	private buildRoom(spec: RoomSpec): void {
		const hw = spec.width / 2;
		const hd = spec.depth / 2;
		const H = spec.height;
		const UP = new THREE.Vector3(0, 0, 1);

		const walls = [
			{ w: spec.width, centre: new THREE.Vector3(0, hd, H / 2), dir: new THREE.Vector3(1, 0, 0) },
			{ w: spec.depth, centre: new THREE.Vector3(hw, 0, H / 2), dir: new THREE.Vector3(0, -1, 0) },
			{ w: spec.width, centre: new THREE.Vector3(0, -hd, H / 2), dir: new THREE.Vector3(-1, 0, 0) },
			{ w: spec.depth, centre: new THREE.Vector3(-hw, 0, H / 2), dir: new THREE.Vector3(0, 1, 0) }
		];

		for (const wall of walls) {
			const mat = this.surfaceMaterial(0x0a0a10, SPILL, 0.1);
			const mesh = new THREE.Mesh(new THREE.PlaneGeometry(wall.w, H, 24, 24), mat);
			mesh.position.copy(wall.centre);
			// dir x up gives the inward normal, so near walls are back-face culled and the
			// camera can orbit outside the room and still see in.
			this.orient(mesh, wall.dir, UP);
			this.scene.add(mesh);
		}

		// The ceiling is above the fixture, so it catches none of it directly and is only there to
		// close the box; the floor is straight under it and is the brightest surface in the room.
		// `orient` maps the plane's own x onto `dir` and its y onto `up`, so both pairs have to put
		// width on the room's x: naming the axes the other way round builds a 4 x 5 m panel over a
		// 5 x 4 m room, which reads as the walls not meeting it.
		const X = new THREE.Vector3(1, 0, 0);
		for (const [z, dir, base, ambient] of [
			[H, new THREE.Vector3(0, -1, 0), 0x090910, 0.14],
			[0, new THREE.Vector3(0, 1, 0), 0x0a0a0e, 0.1]
		] as const) {
			const panel = new THREE.Mesh(
				new THREE.PlaneGeometry(spec.width, spec.depth, 8, 8),
				this.surfaceMaterial(base, SPILL, ambient)
			);
			panel.position.set(0, 0, z);
			this.orient(panel, X, dir);
			this.scene.add(panel);
		}
	}

	/**
	 * Every run of the fixture as a line in world space, plus where its texels live.
	 *
	 * The spill shader walks these rather than a hardcoded shape, so the room keeps lighting
	 * correctly if the fixture ever changes.
	 */
	private frameSegments(): { seg: THREE.Vector4[]; uv: THREE.Vector3[] } {
		const seg: THREE.Vector4[] = [];
		const uv: THREE.Vector3[] = [];
		for (const s of this.geometry.strips) {
			seg.push(new THREE.Vector4(s.start[0], s.start[1], s.end[0], s.end[1]));
			uv.push(
				new THREE.Vector3((s.count - 1) / this.texW, 0.5 / this.texW, (s.id + 0.5) / this.texH)
			);
		}
		return { seg, uv };
	}

	/**
	 * A surface the fixture lights but that does not emit.
	 *
	 * `gain` is the only thing that separates one from another, because the falloff is the physics
	 * rather than a per-surface guess: a surface above the fixture receives nothing from a run
	 * pointing down, and one below it receives the run's own inverse square.
	 */
	private surfaceMaterial(
		base: number,
		gain: number,
		ambient: number,
		emit = 0,
		lamp = 1
	): THREE.ShaderMaterial {
		const b = this.opts.spec.bounce;
		return new THREE.ShaderMaterial({
			uniforms: {
				uLed: { value: this.ledTexture },
				uSeg: { value: this.segments.seg },
				uSegUv: { value: this.segments.uv },
				uFrameZ: { value: this.opts.spec.fixture.height },
				uSpillGain: { value: gain },
				uAmbientMix: { value: ambient },
				uAmbient: this.ambientUniform,
				uBase: { value: new THREE.Color(base) },
				uLampAt: { value: new THREE.Vector3(b.at[0], b.at[1], b.height / 2) },
				uLampColor: this.bounceColor,
				// The column's own emitting area, as the radius its inverse square softens over.
				// Without it the two walls it stands against would have a hot point on them
				// rather than the broad wash a metre of diffuser actually throws.
				uLampSize: { value: b.height * b.height * 0.25 },
				uLampGain: { value: lamp * LAMP_SPILL * b.height },
				uEmitGain: { value: emit }
			},
			vertexShader: SURFACE_VS,
			fragmentShader: surfaceFragment(this.geometry.strips.length)
		});
	}

	/**
	 * The Bounce Lamp: a white diffuser with a strip inside it.
	 *
	 * So it is a surface before it is an emitter, and it gets the same shader as the walls with a
	 * white albedo and the strip's colour added on top. A tube drawn as emission alone is pure
	 * black whenever the show is - which is the one thing a white plastic column never is.
	 *
	 * Its own lamp term is switched off, because a fixture cannot light itself.
	 */
	private buildBounceLamp(spec: RoomSpec): void {
		const b = spec.bounce;
		const geo = new THREE.CylinderGeometry(b.diameter / 2, b.diameter / 2, b.height, 24, 1, true);
		geo.rotateX(Math.PI / 2);
		// Half again the room's spill, because white plastic reflects more than a dark wall does.
		const mat = this.surfaceMaterial(0x16171b, SPILL * 1.5, 0.5, LAMP_GAIN, 0);
		mat.side = THREE.DoubleSide;
		const tube = new THREE.Mesh(geo, mat);
		tube.position.set(b.at[0], b.at[1], b.height / 2);
		this.scene.add(tube);
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

	/**
	 * Zero allocations. The texture upload is a few kB per frame, noise next to the bloom.
	 *
	 * `bounce` is the Bounce Lamp's one gamma-encoded pixel. It is a second fixture rather than a
	 * tail on the first, so it arrives separately and nothing indexing the room can run off the
	 * end into it.
	 */
	render(bytes: Uint8Array, dt: number, bounce?: Uint8Array): void {
		if (this.disposed) return;
		const g = this.geometry;
		const td = this.texData;

		if (bounce) {
			this.bounceColor.value.setRGB(bounce[0] / 255, bounce[1] / 255, bounce[2] / 255);
		}

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

		// Average colour feeds a faint global ambient, so the room reads as one lit space rather
		// than five glowing lines in the dark.
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

const SURFACE_VS = /* glsl */ `
	varying vec3 vWorld;
	varying vec3 vNormal3;
	void main() {
		vec4 world = modelMatrix * vec4(position, 1.0);
		vWorld = world.xyz;
		vNormal3 = normalize(mat3(modelMatrix) * normal);
		gl_Position = projectionMatrix * viewMatrix * world;
	}
`;

/**
 * How much of the fixture a surface receives, and in what colour.
 *
 * Every run is integrated as the line light it is: sampled along its length, each sample falling
 * off by `cos(emitter) * cos(surface) / d^2` and weighted by the metres it stands for. Taking the
 * nearest point instead - which is what this did first, with a widening blur to paper over it -
 * treats a 3 m run as a bulb, and a wall two metres from one is nothing like a wall two metres
 * from a bulb: the pool is the wrong shape, it falls off far too fast at the ends, and the colour
 * gradient along the run never reaches the surface at all.
 *
 * The falloff is physics rather than a tuned constant, and it earns that. It does the one thing an
 * exponential could not: a surface ABOVE the fixture gets a negative emitter cosine and therefore
 * nothing, which is what keeps the ceiling dark under a fixture facing the floor, with no rule
 * anywhere saying so.
 *
 * The lamp joins the same sum. It is a diffusing column rather than a downlight, so it has no
 * emitter cosine to apply - a metre of tube throws sideways as readily as down - and it softens
 * over its own size rather than going singular against the two walls it stands between.
 */
function surfaceFragment(segments: number): string {
	return /* glsl */ `
	#define SEGMENTS ${segments}
	// Eight is where the pool stops changing shape on a 3 m run seen from a metre away; the
	// samples cost a texture fetch each and there is exactly one bank of them on screen.
	#define SAMPLES 8

	uniform sampler2D uLed;
	uniform vec4 uSeg[SEGMENTS];
	uniform vec3 uSegUv[SEGMENTS];
	uniform float uFrameZ;
	uniform float uSpillGain;
	uniform float uAmbientMix;
	uniform vec3 uAmbient;
	uniform vec3 uBase;
	uniform vec3 uLampAt;
	uniform vec3 uLampColor;
	uniform float uLampSize;
	uniform float uLampGain;
	uniform float uEmitGain;
	varying vec3 vWorld;
	varying vec3 vNormal3;

	/// A surface passing through an emitter must not divide by nothing.
	const float SOFT = 0.02;

	vec3 tapLed(vec3 uv, float t) {
		return texture2D(uLed, vec2(clamp(t, 0.0, 1.0) * uv.x + uv.y, uv.z)).rgb;
	}

	void main() {
		vec3 n = normalize(vNormal3);
		vec3 lit = vec3(0.0);

		for (int i = 0; i < SEGMENTS; i++) {
			vec2 a = uSeg[i].xy;
			vec2 ab = uSeg[i].zw - a;
			float dl = length(ab) / float(SAMPLES);

			for (int k = 0; k < SAMPLES; k++) {
				float t = (float(k) + 0.5) / float(SAMPLES);
				vec3 toLed = vec3(a + ab * t, uFrameZ) - vWorld;
				float d2 = dot(toLed, toLed) + SOFT;
				float d = sqrt(d2);
				float emit = max(toLed.z / d, 0.0);
				float face = max(dot(n, toLed) / d, 0.0);
				lit += tapLed(uSegUv[i], t) * (emit * face * dl / d2);
			}
		}

		vec3 toLamp = uLampAt - vWorld;
		float ld2 = dot(toLamp, toLamp) + uLampSize;
		lit += uLampColor * (uLampGain * max(dot(n, toLamp) / sqrt(ld2), 0.0) / ld2);

		// A diffuser is brightest looked at square on and falls toward its silhouette, which is
		// what stops a cylinder reading as a flat painted rectangle. Zero for everything else.
		float head = max(dot(n, normalize(cameraPosition - vWorld)), 0.0);
		vec3 emit = uLampColor * (uEmitGain * (0.55 + 0.45 * head));

		gl_FragColor = vec4(uBase + uAmbient * uAmbientMix + lit * uSpillGain + emit, 1.0);
	}
`;
}
