export const STRIP_VERTEX = /* glsl */ `
	varying vec2 vUv;
	varying float vDist;
	void main() {
		vUv = uv;
		vec4 mv = modelViewMatrix * vec4(position, 1.0);
		vDist = -mv.z;
		gl_Position = projectionMatrix * mv;
	}
`;

/**
 * Two readings of the same strip, crossfaded by camera distance the way focus is.
 *
 * Far away, the linear-filtered texture is the frosted diffuser the eye actually sees across a
 * room. Up close a real strip resolves into discrete emitters behind the frost, so the near
 * reading samples the LED's own texel and shades a dot around it, with the space between dots
 * carrying only bleed.
 */
export const STRIP_FRAGMENT = /* glsl */ `
	uniform sampler2D uLed;
	uniform float uUScale;
	uniform float uUOffset;
	uniform float uRow;
	uniform float uCount;
	uniform float uGain;
	varying vec2 vUv;
	varying float vDist;

	void main() {
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

		// Softened across the short axis so it reads as a diffuser channel, not a sticker.
		float core = smoothstep(0.0, 0.42, vUv.y) * smoothstep(1.0, 0.58, vUv.y);
		gl_FragColor = vec4(c * uGain * (0.5 + 0.6 * core), 1.0);
	}
`;
