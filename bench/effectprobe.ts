import {
	BUILT_IN_EFFECTS,
	DEFAULT_ROOM,
	Mixer,
	SLOT,
	buildGeometry,
	makePalette,
	scriptFrames,
	type EffectDef,
	type ShowFrame
} from '@mv/core';

/**
 * Every built-in, one row each, against the four questions a catalog can fail on.
 *
 *   fill    share of the room above byte 24, which is where a pixel starts reading as lit in a
 *           dark room rather than merely as not-off. `levelprobe`'s byte 8 answers a different
 *           question and calls a spotlight in a black room fully covered.
 *   top10   share of all delivered light sitting in the brightest tenth of the pixels. A wash
 *           scores near 0.1; a spotlight scores near 1. This is the number behind "only a T
 *           section lights up", and no mean brightness can see it.
 *   hue     share of lit bytes on a hue the palette could produce. An effect reaching past
 *           `SLOT` for a colour of its own, or wrapping a slot past 1.0 into the near-black
 *           end of the ring, shows up here.
 *   react   how far the output moves when the spectrum and bands are driven rather than held
 *           flat, as a share of its own mean level. An effect that ignores the music scores 0,
 *           which is exactly the complaint about a quiet passage.
 *
 *   node bench/effectprobe.ts [--role bed] [--sort fill]
 */
const argv = process.argv.slice(2);
const flag = (n: string) => {
	const i = argv.indexOf(`--${n}`);
	return i >= 0 ? argv[i + 1] : undefined;
};
const onlyRole = flag('role');
const sortBy = flag('sort') ?? 'role';

const g = buildGeometry(DEFAULT_ROOM);
/** Red base, cyan accent, yellow third: three hues far enough apart to tell apart by eye. */
const palette = makePalette({ base: 0, accent: 180, third: 60, sat: 0.94, shade: 0.14, white: 0.06 });
const DECLARED = [0, 180, 60];
const TOLERANCE = 22;
const LIT = 24;

function hueOf(r: number, gr: number, b: number): number {
	const max = Math.max(r, gr, b);
	const min = Math.min(r, gr, b);
	const d = max - min;
	if (d < 1e-6) return -1;
	let h: number;
	if (max === r) h = ((gr - b) / d) % 6;
	else if (max === gr) h = (b - r) / d + 2;
	else h = (r - gr) / d + 4;
	return (((h * 60) % 360) + 360) % 360;
}
const arc = (a: number, b: number) => {
	const d = Math.abs(((a - b) % 360) + 360) % 360;
	return Math.min(d, 360 - d);
};

/** Flatten everything the music drives, leaving the frame's clock and structure alone. */
function deafen(frames: readonly ShowFrame[]): ShowFrame[] {
	return frames.map((f) => {
		const copy: ShowFrame = { ...f, bands: Float32Array.from(f.bands), spectrum: Float32Array.from(f.spectrum) };
		copy.bands.fill(0.5);
		copy.spectrum.fill(0.5);
		copy.energy = 0.5;
		copy.kick = false;
		copy.snare = false;
		copy.hat = false;
		copy.kickEnv = 0;
		copy.snareEnv = 0;
		copy.hatEnv = 0;
		return copy;
	});
}

interface Row {
	id: string;
	role: string;
	fill: number;
	top10: number;
	hue: number;
	react: number;
}

/** Run one effect alone in the mixer, which is what applies gamma and the output chain. */
function measure(def: EffectDef, frames: readonly ShowFrame[]): { bytes: Uint8Array[]; mean: number } {
	const mixer = new Mixer(g);
	mixer.palette = palette;
	mixer.intensity = 1;
	mixer.floor = 0;
	const layer = mixer.layers[def.role];
	layer.setEffect(def, g);
	const bytes: Uint8Array[] = [];
	let total = 0;

	for (const f of frames) {
		mixer.render(f);
		const snap = Uint8Array.from(mixer.bytes);
		bytes.push(snap);
		for (let i = 0; i < snap.length; i++) total += snap[i];
	}
	return { bytes, mean: total / Math.max(1, bytes.length * bytes[0].length) };
}

const rows: Row[] = [];
const frames = scriptFrames();
const flat = deafen(frames);

for (const def of BUILT_IN_EFFECTS) {
	if (onlyRole && def.role !== onlyRole) continue;

	const live = measure(def, frames);
	const deaf = measure(def, flat);

	let litPixels = 0;
	let pixels = 0;
	let onHue = 0;
	let litBytes = 0;
	let concentration = 0;
	let framesCounted = 0;
	const levels: number[] = [];

	for (const snap of live.bytes) {
		const n = snap.length / 3;
		levels.length = 0;
		let frameTotal = 0;
		for (let k = 0; k < n; k++) {
			const i = k * 3;
			const v = Math.max(snap[i], snap[i + 1], snap[i + 2]);
			pixels++;
			if (v >= LIT) litPixels++;
			levels.push(v);
			frameTotal += v;
			if (v < LIT) continue;
			litBytes += v;
			const h = hueOf(snap[i], snap[i + 1], snap[i + 2]);
			// A near-grey pixel has no hue to be wrong about; white is a declared colour here.
			const grey = Math.max(snap[i], snap[i + 1], snap[i + 2]) - Math.min(snap[i], snap[i + 1], snap[i + 2]);
			if (h < 0 || grey < 24 || DECLARED.some((d) => arc(h, d) <= TOLERANCE)) onHue += v;
		}
		if (frameTotal < 1) continue;
		levels.sort((a, b) => b - a);
		let top = 0;
		const tenth = Math.max(1, Math.round(n / 10));
		for (let k = 0; k < tenth; k++) top += levels[k];
		concentration += top / frameTotal;
		framesCounted++;
	}

	// Against the effect's own level, so a dim effect that nonetheless tracks the music is not
	// penalised for being dim.
	let delta = 0;
	for (let i = 0; i < live.bytes.length; i++) {
		for (let k = 0; k < live.bytes[i].length; k++) {
			delta += Math.abs(live.bytes[i][k] - deaf.bytes[i][k]);
		}
	}
	const norm = Math.max(1, live.bytes.length * live.bytes[0].length);

	rows.push({
		id: def.id,
		role: def.role,
		fill: pixels > 0 ? litPixels / pixels : 0,
		top10: framesCounted > 0 ? concentration / framesCounted : 0,
		hue: litBytes > 0 ? onHue / litBytes : 1,
		react: live.mean > 0.5 ? delta / norm / live.mean : 0
	});
}

const order = ['bed', 'rhythm', 'transient', 'accent', 'master'];
rows.sort((a, b) =>
	sortBy === 'role'
		? order.indexOf(a.role) - order.indexOf(b.role) || a.id.localeCompare(b.id)
		: sortBy === 'top10'
			? b.top10 - a.top10
			: sortBy === 'hue'
				? a.hue - b.hue
				: sortBy === 'react'
					? a.react - b.react
					: a.fill - b.fill
);

console.error(
	`${'effect'.padEnd(20)}${'role'.padEnd(11)}${'fill'.padStart(7)}${'top10'.padStart(8)}${'hue'.padStart(7)}${'react'.padStart(8)}`
);
for (const r of rows) {
	console.error(
		r.id.padEnd(20) +
			r.role.padEnd(11) +
			`${(100 * r.fill).toFixed(0)}%`.padStart(7) +
			`${(100 * r.top10).toFixed(0)}%`.padStart(8) +
			`${(100 * r.hue).toFixed(0)}%`.padStart(7) +
			r.react.toFixed(2).padStart(8)
	);
}

const mean = (pick: (r: Row) => number) => rows.reduce((a, r) => a + pick(r), 0) / Math.max(1, rows.length);
const emit = (name: string, v: number, digits = 1) => console.log(`${name}\t${v.toFixed(digits)}`);

emit('effects', rows.length, 0);
emit('mean fill %', 100 * mean((r) => r.fill));
emit('mean top10 %', 100 * mean((r) => r.top10));
emit('off-palette', rows.filter((r) => r.hue < 0.9).length, 0);
emit('deaf effects', rows.filter((r) => r.react < 0.02).length, 0);
emit('spotlights', rows.filter((r) => r.top10 > 0.45).length, 0);
void SLOT;
