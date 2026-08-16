export const SURFACE_VERTEX = /* glsl */ `
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
 * How much of each fixture a surface receives, and in what colour.
 *
 * The Frame's runs are integrated as the line lights they are: sampled along their length, each
 * sample falling off by `cos(emitter) * cos(surface) / d^2` and weighted by the metres it stands
 * for. Taking the nearest point instead treats a 3 m run as a bulb, and a wall two metres from a
 * run is nothing like a wall two metres from a bulb - the pool is the wrong shape, it falls off
 * far too fast at the ends, and the colour gradient along the run never reaches the surface.
 *
 * The falloff is physics rather than a tuned constant, and it earns that: it does the one thing
 * an exponential could not, which is give a surface ABOVE the fixture a negative emitter cosine
 * and therefore nothing. That is what keeps the ceiling dark under a downward-facing fixture,
 * with no rule anywhere saying so.
 *
 * The lamp is added on its own gain rather than the Frame's, so the two can be tuned against each
 * other. It is a diffusing column rather than a downlight, so it has no emitter cosine to apply -
 * a metre of tube throws sideways as readily as down - and it softens over its own size rather
 * than going singular against the two walls it stands between.
 */
export function surfaceFragment(segments: number): string {
	return /* glsl */ `
	#define SEGMENTS ${segments}
	// Eight is where the pool stops changing shape on a 3 m run seen from a metre away; the
	// samples cost a texture fetch each and there is exactly one bank of them on screen.
	#define SAMPLES 8

	uniform sampler2D uLed;
	uniform vec4 uSeg[SEGMENTS];
	uniform vec3 uSegUv[SEGMENTS];
	uniform float uFrameZ;
	uniform float uFrameGain;
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
		vec3 frame = vec3(0.0);

		for (int i = 0; i < SEGMENTS; i++) {
			vec2 a = uSeg[i].xy;
			vec2 ab = uSeg[i].zw - a;
			float dl = length(ab) / float(SAMPLES);

			for (int k = 0; k < SAMPLES; k++) {
				float t = (float(k) + 0.5) / float(SAMPLES);
				vec3 toLed = vec3(a + ab * t, uFrameZ) - vWorld;
				float d2 = dot(toLed, toLed) + SOFT;
				float d = sqrt(d2);
				float down = max(toLed.z / d, 0.0);
				float face = max(dot(n, toLed) / d, 0.0);
				frame += tapLed(uSegUv[i], t) * (down * face * dl / d2);
			}
		}

		vec3 toLamp = uLampAt - vWorld;
		float ld2 = dot(toLamp, toLamp) + uLampSize;
		vec3 lamp = uLampColor * (max(dot(n, toLamp) / sqrt(ld2), 0.0) / ld2);

		// A diffuser is brightest looked at square on and falls toward its silhouette, which is
		// what stops a cylinder reading as a flat painted rectangle. Zero for everything else.
		float head = max(dot(n, normalize(cameraPosition - vWorld)), 0.0);
		vec3 glow = uLampColor * (uEmitGain * (0.55 + 0.45 * head));

		vec3 lit = frame * uFrameGain + lamp * uLampGain;
		gl_FragColor = vec4(uBase + uAmbient * uAmbientMix + lit + glow, 1.0);
	}
`;
}
