import type { LayerRole, Params } from '../contracts/effect.ts';

export interface SceneLayer {
	effect: string;
	/**
	 * Overrides the role's own budget.
	 *
	 * The budget exists to stop four additive layers summing past white in a drop. A scene has two,
	 * so the beds here are free to take rather more of it than 0.45, and a bed whose field is mostly
	 * shade has to.
	 */
	opacity?: number;
	params?: Params;
}

export interface AmbientScene {
	id: string;
	/** Shown in the interface, so it has to say what the room will look like. */
	name: string;
	layers: Partial<Record<LayerRole, SceneLayer>>;
	/**
	 * Needs something playing to look like anything, so it is never offered to an empty room.
	 *
	 * The rest are self-driven off the idle grid and take the music into account only when there is
	 * some. That split is what lets the resting room and lounge share one pool.
	 */
	needsMusic?: boolean;
}

/**
 * The looks the room rests in, and the ones lounge plays a track with.
 *
 * A scene is a bed and one texture, which is the shape of a quiet cue and for the same reason: the
 * bed is the room and the texture is what stops it being a photograph. Most are pairings of effects
 * the catalog already had - the calm half of it has never had anything to ask for it outside an
 * intro.
 *
 * The beds run at or above their catalog defaults and the textures well below. That is not a taste
 * about brightness, it is the arithmetic: a cue's bed has four more layers over it and these have
 * one, so a bed turned down here is a bed turned down twice and the room arrives at byte 20.
 *
 * Ordered so neighbours are unalike: the picker walks the list rather than sampling it freely, so
 * two consecutive scenes never share a bed.
 */
export const AMBIENT_SCENES: readonly AmbientScene[] = [
	{
		id: 'resting',
		name: 'Resting',
		layers: {
			bed: { effect: 'ambientDrift', params: { intensity: 0.78, period: 0.55, listen: 0.4 } },
			accent: { effect: 'breathe', params: { intensity: 0.62, bars: 0.75, tilt: 0.35 } }
		}
	},
	{
		id: 'hearth',
		name: 'Hearth',
		layers: {
			bed: { effect: 'hearth', params: { intensity: 0.8, flicker: 0.55, settle: 0.6 } },
			accent: { effect: 'embers', opacity: 0.42, params: { intensity: 0.62, pool: 0.3 } }
		}
	},
	{
		id: 'poolside',
		name: 'Poolside',
		layers: {
			bed: { effect: 'caustics', params: { intensity: 0.76, flow: 0.4, listen: 0.45 } },
			accent: { effect: 'ripple', params: { intensity: 0.7, every: 11, reach: 0.65 } }
		}
	},
	{
		id: 'lamplight',
		name: 'Lamplight',
		layers: {
			bed: { effect: 'wash', params: { intensity: 0.6, breath: 0.25, drift: 0.04 } },
			accent: {
				effect: 'lanterns',
				opacity: 0.7,
				params: { intensity: 0.82, drift: 0.45, width: 0.5, listen: 0.5 }
			}
		}
	},
	{
		id: 'dusk',
		name: 'Dusk',
		layers: {
			bed: { effect: 'dusk', params: { intensity: 0.74, turn: 0.42, depth: 0.55 } },
			accent: {
				effect: 'sparkle',
				opacity: 0.3,
				params: { intensity: 0.5, rate: 25, decay: 0.5, white: 0.35 }
			}
		}
	},
	{
		id: 'nightfield',
		name: 'Night field',
		layers: {
			// Both of these spend most of their field below `base`, where the palette is a shade
			// rather than a colour, so at the role's own budget they light half the room the rest of
			// the pool does and the room dims every time the picker reaches one.
			bed: { effect: 'nebula', opacity: 0.85, params: { intensity: 0.85, scale: 0.3, surge: 0.3 } },
			accent: { effect: 'discoBall', opacity: 0.34, params: { intensity: 0.58, density: 0.35 } }
		}
	},
	{
		id: 'curtains',
		name: 'Curtains',
		layers: {
			bed: { effect: 'auroraBorealis', opacity: 0.85, params: { intensity: 0.85, drift: 0.26 } },
			accent: { effect: 'mirrorBall', opacity: 0.32, params: { intensity: 0.55, density: 0.5 } }
		}
	},
	{
		id: 'oilslick',
		name: 'Oil slick',
		layers: {
			bed: { effect: 'iridescence', params: { intensity: 0.74, scale: 0.3 } },
			accent: {
				effect: 'lanterns',
				opacity: 0.5,
				params: { intensity: 0.62, drift: 0.3, width: 0.6, listen: 0.6 }
			}
		}
	},

	// From here down the room has to be listening to something.
	{
		id: 'spectrum',
		name: 'Spectrum',
		needsMusic: true,
		layers: {
			bed: { effect: 'spectrumBed', params: { intensity: 0.76, spread: 0.7, depth: 0.45 } },
			accent: { effect: 'harmonicRibbon', params: { intensity: 0.64, travel: 0.5, width: 0.65 } }
		}
	},
	{
		id: 'bloom',
		name: 'Bloom',
		needsMusic: true,
		layers: {
			// Lower than the pool's other beds on purpose: this is the one effect in it written to
			// open up through a chorus, and at their level it opens past what lounge is for.
			bed: { effect: 'chorusBloom', params: { intensity: 0.56 } },
			accent: { effect: 'vocalGlow', opacity: 0.46, params: { intensity: 0.62, width: 0.55 } }
		}
	},
	{
		id: 'haze',
		name: 'Haze',
		needsMusic: true,
		layers: {
			bed: { effect: 'harmonicHaze', params: { intensity: 0.76, grain: 0.6, drift: 0.3 } },
			accent: {
				effect: 'bandBloom',
				opacity: 0.44,
				params: { intensity: 0.62, spread: 0.65, turn: 0.25 }
			}
		}
	},
	{
		id: 'undertow',
		name: 'Undertow',
		needsMusic: true,
		layers: {
			bed: { effect: 'bassRing', params: { intensity: 0.76 } },
			rhythm: { effect: 'laidbackWave', opacity: 0.38, params: { intensity: 0.62, barsPerWave: 3 } }
		}
	},
	{
		id: 'lagoon',
		name: 'Lagoon',
		needsMusic: true,
		layers: {
			bed: { effect: 'lavaBlobs', params: { intensity: 0.72, size: 0.65 } },
			rhythm: { effect: 'sineRoll', opacity: 0.34, params: { intensity: 0.58, perBeat: 12, waves: 2 } }
		}
	}
];
