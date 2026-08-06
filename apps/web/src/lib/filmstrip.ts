import {
	buildGeometry,
	DEFAULT_ROOM,
	makePalette,
	scriptFrames,
	type EffectDef,
	type Geometry,
	type Palette,
	type ShowFrame
} from '@mv/core';

/**
 * A still of what an effect does, as an image: the room down each column, time across.
 *
 * A list of forty effects with a name and a blurb each tells you nothing about which one to
 * reach for. Rendering them all against the same scripted journey makes the differences the
 * only thing on screen - what moves, how fast, whether it fires on the drums or breathes
 * across the bar, and what it does when the drop arrives.
 */
const geometry: Geometry = buildGeometry(DEFAULT_ROOM);
const frames: ShowFrame[] = scriptFrames(128);
const palette: Palette = makePalette({ base: 320, accent: 175, third: 44 });

/** Where the drop lands in the scripted journey, as a fraction of it. */
export const FILMSTRIP_DROP = 13 / 21;

export function renderFilmstrip(
	def: EffectDef,
	width: number,
	height: number
): Uint8ClampedArray<ArrayBuffer> {
	// Backed by a plain ArrayBuffer on purpose: ImageData will not accept a view that might be
	// over shared memory, which is what the default constructor's type admits.
	const data = new Uint8ClampedArray(new ArrayBuffer(width * height * 4));
	const buf = new Float32Array(geometry.count * 3);
	const effect = def.create(geometry);
	const params: Record<string, number> = {};
	for (const spec of def.params) params[spec.key] = spec.default;
	// Master effects sit idle until the player pulls their trigger, so a preview of one would
	// otherwise be a black rectangle.
	if ('trigger' in params) params.trigger = 1;

	const ctx = { g: geometry, f: frames[0], p: params, palette, hueShift: 0, motion: 1 };

	for (let x = 0; x < width; x++) {
		// Every column advances by the same slice of the journey, so two filmstrips are
		// directly comparable and the drop always lands in the same place.
		const from = Math.floor((x / width) * frames.length);
		const to = Math.max(from + 1, Math.floor(((x + 1) / width) * frames.length));
		for (let i = from; i < to; i++) {
			ctx.f = frames[i];
			effect.render(buf, ctx);
		}

		for (let y = 0; y < height; y++) {
			// Every LED in buffer order, so the four walls and then the ceiling beam each get
			// their share of the column. Showing only the perimeter is tempting and wrong: an
			// effect that lives on the beam then previews as an empty rectangle.
			const led = Math.min(geometry.count - 1, Math.floor((y / height) * geometry.count));
			const o = led * 3;
			const px = (y * width + x) * 4;
			// Gamma, the same 2.2 the wire gets, or every preview reads far darker than the room.
			data[px] = encode(buf[o]);
			data[px + 1] = encode(buf[o + 1]);
			data[px + 2] = encode(buf[o + 2]);
			data[px + 3] = 255;
		}
	}

	return data;
}

function encode(v: number): number {
	const clamped = v < 0 ? 0 : v > 1 ? 1 : v;
	return Math.round(Math.pow(clamped, 1 / 2.2) * 255);
}
