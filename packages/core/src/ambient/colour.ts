import type { Palette, ShowPalette } from '../contracts/palette.ts';
import { PALETTE_ANCHORS } from '../contracts/palette.ts';
import { rampHueFor } from '../color/hsv.ts';
import { blendPalettes, lerpHue, writePalette, wrapHue } from '../color/palette.ts';
import { alphaFor, clamp } from '../dsl/math.ts';

/** Where the room's colour comes from while it is resting or in lounge. */
export type ColourSource = 'fixed' | 'drift' | 'track';

/**
 * The complement and the shade, in the ramp's own degrees.
 *
 * `ShowPalette` wants base and accent 150-180 apart, and a third close enough to the base to read
 * as a shade of the room rather than as a third opinion.
 */
const ACCENT_ARC = 152;
const THIRD_ARC = 34;

/**
 * Deeper than a show's default, and not as deep as it first looks like it should be.
 *
 * The instinct is that a resting room can fall all the way into black, since nothing here is loud
 * enough to need the contrast. Measured, that is backwards. Half the calm catalog spends most of
 * its field between `deep` and `base` - `nebula` walks that stretch for any value under 0.55 of its
 * noise - so the shade is not the bottom of the range here, it is the middle of it. At 0.05 those
 * scenes came out at half the mean brightness of the rest of the pool, so the room visibly dimmed
 * whenever the picker reached one.
 */
const AMBIENT_SHADE = 0.12;

/** How long a colour takes to arrive when the record it belongs to starts playing. */
const TRACK_TAU = 14;

/**
 * How long a section's colour takes to arrive.
 *
 * Shorter than a record's, because it happens several times a song and a turn nobody notices is a
 * turn that may as well not be there; long enough that a drop's inversion reads as the room
 * turning rather than as the room cutting.
 */
const CUE_TAU = 3.5;

/** A quarter degree is finer than the ramp's own step, and finer than the eye. */
const HUE_EPSILON = 0.25;

export interface ColourSettings {
	source: ColourSource;
	/** Textbook HSV degrees, as picked in the interface. */
	hue: number;
	/** 0.15 washes out toward white, 1 is a fully saturated wall. */
	sat: number;
	/** Degrees per minute, in `drift`. */
	drift: number;
}

/**
 * Everything `makePalette` reads, so a look can be carried whole rather than as three hues.
 *
 * The scalars matter as much as the hues. A show declaring `sat: 0.94` lit through the room's own
 * 0.78 is the record's colour visibly washed out, and it is not the record's colour any more.
 */
interface Look {
	base: number;
	accent: number;
	third: number;
	sat: number;
	shade: number;
	white: number;
}

/** `makePalette`'s own, so a palette that omits a field is carried across unchanged rather than
 * given the room's idea of it. */
const PALETTE_DEFAULTS = { sat: 0.94, shade: 0.08, white: 0.06 };

/**
 * The room's resting colour, and a `Palette` kept in step with it.
 *
 * `track` carries the show's palette WHOLE - hues, saturation, shade and highlight - because that
 * palette is the record's colour and anything the room imposes on top of it is the room disagreeing
 * with the thing it is supposed to be lighting. The other two sources are the room's own look, so
 * there the saturation is the one on the panel and the shade is the room's.
 *
 * The one thing to get right is which coordinate a hue is in. `hsv2rgb` is FastLED's rainbow ramp,
 * not textbook HSV, so a hue picked off a wheel is in the wrong space: fed straight in, a
 * chartreuse pick leaves the room yellow. Anything measured outside - a slider, a cover - goes
 * through `rampHueFor` first, and a show's palette is already in ramp degrees and must not.
 */
export class AmbientColour {
	readonly palette: Palette = new Float32Array(PALETTE_ANCHORS * 3);

	settings: ColourSettings = { source: 'fixed', hue: 28, sat: 0.8, drift: 6 };

	/** The cover's dominant hue in textbook degrees, for `track` before a show exists. */
	artHue: number | null = null;

	/**
	 * The palette of the CUE the show is currently on, for `track`.
	 *
	 * The show's own palette is one colour for a whole record, and following it left lounge
	 * unchanging for four minutes. Its cues are where the colour actually lives: the engine writes
	 * a script across them - a drop inverts base and accent, a breakdown turns the room to the third
	 * hue, a build walks the base toward the accent, an intro gains chroma as it loses level - and
	 * the player has already crossfaded that into one palette by the time this sees it.
	 *
	 * So the section reactivity is not something this invents. It is the design that was already
	 * there, which lounge was throwing away.
	 */
	cuePalette: Palette | null = null;

	private track: ShowPalette | null = null;

	/**
	 * The playing show's palette, for `track`.
	 *
	 * Null means nothing is loaded, which is not the same as "go back to the picked colour" - so it
	 * is ignored and the last record's colour stays. A track change clears this for the second or
	 * two the next bundle takes to arrive, and a room that swings toward amber and back every time
	 * is a room reporting a fetch. Between records it holds the one it was following, which is what
	 * a room that has just been playing something should look like.
	 */
	set trackPalette(p: ShowPalette | null) {
		if (p) this.track = p;
	}

	get trackPalette(): ShowPalette | null {
		return this.track;
	}

	/** Accumulated drift, in textbook degrees. */
	private drifted = 0;
	private readonly now: Look = { base: 0, accent: 0, third: 0, ...PALETTE_DEFAULTS };
	private readonly want: Look = { base: 0, accent: 0, third: 0, ...PALETTE_DEFAULTS };
	private readonly built: Look = {
		base: Number.NaN,
		accent: Number.NaN,
		third: Number.NaN,
		sat: Number.NaN,
		shade: Number.NaN,
		white: Number.NaN
	};
	// One entry, because the only caller walks the wheel slowly. `rampHueFor` inverts a
	// 1440-entry table by search, which is nothing once and not nothing sixty times a second.
	private rampIn = Number.NaN;
	private rampOut = 0;

	constructor() {
		this.snap();
	}

	/** What the room is showing right now, as a show would declare it. */
	get shown(): ShowPalette {
		return { ...this.now };
	}

	update(dt: number): Palette {
		if (this.settings.source === 'drift') {
			// Accumulated in TEXTBOOK degrees and converted, not walked along the ramp. The ramp is
			// not a rotation of the wheel - it widens yellow and spends no coordinates at all across
			// cyan - so a drift stepped in ramp space lingers in some colours and races through
			// others at a rate nobody asked for.
			this.drifted = wrapHue(this.drifted + (this.settings.drift / 60) * dt);
		} else {
			this.drifted = 0;
		}

		// Following the cue script is a blend of two baked palettes rather than of hues, because a
		// cue's palette has already been through `makePalette` and there is nothing to be gained by
		// taking it apart to put it back together. Slower than the show's own fade on purpose: a
		// drop that inverts on the downbeat is a cut, and lounge wants the turn without the edge.
		const cue = this.settings.source === 'track' ? this.cuePalette : null;
		if (cue) {
			blendPalettes(this.palette, this.palette, cue, alphaFor(dt, CUE_TAU));
			// Nothing to rebuild from, and nothing that would rebuild it: the next hue-built palette
			// has to start from wherever this left the room rather than from a stale `built`.
			this.built.base = Number.NaN;
			return this.palette;
		}

		this.resolve();
		// A pick and a drift are the user's hand on the control, so they arrive at once. A track's
		// colour is the room following the record, which is a thing worth seeing it do.
		if (this.settings.source === 'track') {
			const a = alphaFor(dt, TRACK_TAU);
			// Hues round the wheel, the rest straight: two records apart in saturation should cross
			// the difference rather than step it, and there is no short way round a scalar.
			this.now.base = lerpHue(this.now.base, this.want.base, a);
			this.now.accent = lerpHue(this.now.accent, this.want.accent, a);
			this.now.third = lerpHue(this.now.third, this.want.third, a);
			this.now.sat += (this.want.sat - this.now.sat) * a;
			this.now.shade += (this.want.shade - this.now.shade) * a;
			this.now.white += (this.want.white - this.now.white) * a;
		} else {
			this.arrive();
		}

		this.rebuildIfMoved();
		return this.palette;
	}

	/** Arrive without easing: a reset, or a source the user has just changed. */
	snap(): void {
		this.resolve();
		this.arrive();
		this.rebuildIfMoved();
	}

	private arrive(): void {
		this.now.base = this.want.base;
		this.now.accent = this.want.accent;
		this.now.third = this.want.third;
		this.now.sat = this.want.sat;
		this.now.shade = this.want.shade;
		this.now.white = this.want.white;
	}

	reset(): void {
		this.drifted = 0;
		this.snap();
	}

	private resolve(): void {
		const s = this.settings;
		const track = s.source === 'track' ? this.trackPalette : null;
		if (track) {
			// Verbatim, defaults and all. The show declared a whole look and the room's job is to
			// show it, not to have an opinion about how saturated the record should have been.
			this.want.base = wrapHue(track.base);
			this.want.accent = wrapHue(track.accent);
			// The accent, not an arc off the base: that is what `makePalette` falls back to, and a
			// palette rendered by a different rule is not the one the show designed.
			this.want.third = wrapHue(track.third ?? track.accent);
			this.want.sat = track.sat ?? PALETTE_DEFAULTS.sat;
			this.want.shade = track.shade ?? PALETTE_DEFAULTS.shade;
			this.want.white = track.white ?? PALETTE_DEFAULTS.white;
			return;
		}
		// The cover only stands in for a show that has not been composed yet. With neither, the
		// picked colour is the better answer than an arbitrary one, and it is also what the room
		// holds once the music stops.
		const degrees =
			s.source === 'track' && this.artHue !== null ? this.artHue : s.hue + this.drifted;
		this.want.base = this.toRamp(degrees);
		this.want.accent = wrapHue(this.want.base + ACCENT_ARC);
		this.want.third = wrapHue(this.want.base + THIRD_ARC);
		this.want.sat = clamp(s.sat, 0.15, 1);
		this.want.shade = AMBIENT_SHADE;
		this.want.white = PALETTE_DEFAULTS.white;
	}

	private toRamp(degrees: number): number {
		const deg = wrapHue(degrees);
		if (Math.abs(deg - this.rampIn) < HUE_EPSILON) return this.rampOut;
		this.rampIn = deg;
		this.rampOut = rampHueFor(deg) * 360;
		return this.rampOut;
	}

	private rebuildIfMoved(): void {
		const was = this.built;
		if (
			Math.abs(this.now.base - was.base) < HUE_EPSILON &&
			Math.abs(this.now.accent - was.accent) < HUE_EPSILON &&
			Math.abs(this.now.third - was.third) < HUE_EPSILON &&
			Math.abs(this.now.sat - was.sat) < 0.004 &&
			Math.abs(this.now.shade - was.shade) < 0.004 &&
			Math.abs(this.now.white - was.white) < 0.004
		) {
			return;
		}
		writePalette(this.palette, this.now);
		Object.assign(was, this.now);
	}
}
