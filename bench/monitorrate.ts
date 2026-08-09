import {
	DEFAULT_ROOM,
	EffectRegistry,
	Mixer,
	ShowPlayer,
	buildGeometry,
	type TrackAnalysis
} from '@mv/core';
import { composeShow } from '@mv/author-engine';
import { fixture } from '../packages/author-engine/src/fixture.ts';

/**
 * How bright the monitor LED sits, and how fast it pulses.
 *
 * Two questions `monitorprobe.ts` could not answer. It scored peak-to-trough inside one beat,
 * which cannot tell one pulse per beat from four - a statistic flickering at sixteenths scores
 * exactly as well as one landing on the kick - and it said nothing about absolute level,
 * because it measured every candidate after a gain that normalised the level away.
 *
 *   node bench/monitorrate.ts [bpm]
 *
 * The grid comes from the engine fixture rather than a cached track, so the beat period is
 * exact and the answer does not depend on a tempo estimate being right. That also means the
 * beat is weaker here than in an authored show, so read the rate figures as a floor.
 */

const FPS = 60;
const bpm = Number(process.argv[2] ?? 128);

const SUMMARIES = { mean: 1, 'mean sq': 2, 'mean 4th': 4 } as const;
type Summary = keyof typeof SUMMARIES;

const analysis: TrackAnalysis = fixture(bpm);
const show = composeShow(analysis);

const geometry = buildGeometry(DEFAULT_ROOM);
const mixer = new Mixer(geometry);
const player = new ShowPlayer(mixer, new EffectRegistry());
player.load(analysis, show);

const dt = 1 / FPS;
const frames = Math.floor(analysis.duration * FPS);
const levels = { mean: [] as number[], 'mean sq': [] as number[], 'mean 4th': [] as number[] };
const sections: string[] = [];

/**
 * Every candidate expressed as an equivalent byte, 0 to 255, so they can be compared on one
 * axis and so the constant that comes out of this is in the units the frame arrives in.
 *
 * The percentiles come from a 256-bin histogram of `max(r,g,b)`, which is one pass and 512
 * bytes of counters - affordable on the board, unlike a sort. They are here because a room is
 * not as bright as its average: half the fixture lit at full reads as a bright room, and an
 * average over the dark half says it is half lit.
 */
const CANDIDATES = ['mean', 'rms', 'p50', 'p75', 'p90', 'p95'] as const;
type Candidate = (typeof CANDIDATES)[number];
const byteLevels = Object.fromEntries(CANDIDATES.map((k) => [k, [] as number[]])) as Record<
	Candidate,
	number[]
>;

for (let i = 0; i < frames; i++) {
	const f = player.update(i * dt, dt);
	mixer.render(f);
	sections.push(f.section);
	const b = mixer.bytes;
	let s1 = 0;
	let s2 = 0;
	let s4 = 0;
	for (let o = 0; o < b.length; o += 3) {
		const r = b[o];
		const g = b[o + 1];
		const bl = b[o + 2];
		const m = r > g ? (r > bl ? r : bl) : g > bl ? g : bl;
		s1 += m;
		s2 += m * m;
		s4 += m * m * m * m;
	}
	const px = b.length / 3;
	levels['mean'].push(s1 / px);
	levels['mean sq'].push(s2 / px);
	levels['mean 4th'].push(s4 / px);

	const hist = new Uint16Array(256);
	for (let o = 0; o < b.length; o += 3) {
		const r = b[o];
		const g = b[o + 1];
		const bl = b[o + 2];
		hist[r > g ? (r > bl ? r : bl) : g > bl ? g : bl]++;
	}
	const pctByte = (p: number): number => {
		let seen = 0;
		const want = px * (1 - p);
		for (let v = 255; v > 0; v--) {
			seen += hist[v];
			if (seen >= want) return v;
		}
		return 0;
	};
	byteLevels['mean'].push(s1 / px);
	byteLevels['rms'].push(Math.sqrt(s2 / px));
	byteLevels['p50'].push(pctByte(0.5));
	byteLevels['p75'].push(pctByte(0.75));
	byteLevels['p90'].push(pctByte(0.9));
	byteLevels['p95'].push(pctByte(0.95));
}

/** Remove anything slower than a bar, so the fit sees the pulse and not the arrangement. */
function detrend(xs: number[], window: number): number[] {
	const out = new Array<number>(xs.length);
	let acc = 0;
	const ring = new Array<number>(window).fill(0);
	for (let i = 0; i < xs.length; i++) {
		acc += xs[i] - ring[i % window];
		ring[i % window] = xs[i];
		out[i] = xs[i] - acc / Math.min(i + 1, window);
	}
	return out;
}

/** Peak to trough inside one beat, which is the unit the LED is meant to pulse on. */
function beatSwing(xs: number[], atBpm: number): number[] {
	const beat = Math.max(2, Math.round((60 / atBpm) * FPS));
	const out: number[] = [];
	for (let i = 0; i + beat <= xs.length; i += beat) {
		let lo = Infinity;
		let hi = 0;
		for (let k = i; k < i + beat; k++) {
			if (xs[k] < lo) lo = xs[k];
			if (xs[k] > hi) hi = xs[k];
		}
		if (hi > 1) out.push(1 - lo / hi);
	}
	return out;
}

/** Magnitude of the level signal at one frequency, normalised by its own energy. */
function strengthAt(xs: number[], hz: number): number {
	let re = 0;
	let im = 0;
	let energy = 0;
	for (let i = 0; i < xs.length; i++) {
		const a = (2 * Math.PI * hz * i) / FPS;
		re += xs[i] * Math.cos(a);
		im += xs[i] * Math.sin(a);
		energy += xs[i] * xs[i];
	}
	const mag = Math.hypot(re, im) / xs.length;
	const rms = Math.sqrt(energy / xs.length);
	return rms > 1e-9 ? mag / rms : 0;
}

/**
 * `leds.rs present()` exactly, integer widths included, so what comes out of here is the duty
 * the pin actually sits at rather than an idealisation of it.
 */
function firmwareDuty(percentileByte: number[]): number[] {
	return percentileByte.map((v) => (Math.floor(v) * 257) / 65535);
}

const beatHz = bpm / 60;
const MULTIPLES = [0.25, 0.5, 1, 2, 3, 4, 6, 8];

{
	const duty = firmwareDuty(byteLevels['p90']);
	const eye = duty.map((d) => d ** (1 / 2.2));
	const sorted = [...eye].sort((a, b) => a - b);
	const at = (p: number) => sorted[Math.floor(sorted.length * p)];

	// A flash is the LED crossing back up through the midpoint of its own range, which is what
	// the eye counts as one blink.
	const mid = (at(0.05) + at(0.95)) / 2;
	let crossings = 0;
	for (let i = 1; i < eye.length; i++) if (eye[i - 1] <= mid && eye[i] > mid) crossings++;

	console.log(`Firmware chain end to end, whole track, ${(frames / FPS).toFixed(0)} s\n`);
	console.log(
		`  perceived brightness  p05 ${at(0.05).toFixed(2)}  p50 ${at(0.5).toFixed(2)}  p95 ${at(0.95).toFixed(2)}`
	);
	console.log(
		`  flashes ${(crossings / (frames / FPS)).toFixed(2)}/s against ${beatHz.toFixed(2)} beats/s ` +
			`= ${(crossings / (frames / FPS) / beatHz).toFixed(2)} per beat`
	);
	console.log(`  fully dark (under 0.02) ${((100 * eye.filter((v) => v < 0.02).length) / eye.length).toFixed(1)}%\n`);
}

/**
 * What the server sends while paused.
 *
 * `+server.ts` freezes `t` when `playing` is false but still calls `player.update(t, dt)` sixty
 * times a second with a live `dt`, so "paused" only means the timeline stopped, not that the
 * frame did. If these bytes move, the board is showing exactly what it was sent.
 */
{
	const paused = new Mixer(geometry);
	const pausedPlayer = new ShowPlayer(paused, new EffectRegistry());
	pausedPlayer.load(analysis, show);

	const held = analysis.sections.find((s) => s.energyRank === 1)?.startTime ?? 60;
	const seriesP90: number[] = [];
	const bytes: number[] = [];
	for (let i = 0; i < 600; i++) {
		paused.render(pausedPlayer.update(held, 1 / FPS));
		const b = paused.bytes;
		const px = b.length / 3;
		const hist = new Uint16Array(256);
		for (let o = 0; o < b.length; o += 3) hist[Math.max(b[o], b[o + 1], b[o + 2])]++;
		let seen = 0;
		let p90 = 0;
		for (let v = 255; v > 0; v--) {
			seen += hist[v];
			if (seen >= px * 0.1) {
				p90 = v;
				break;
			}
		}
		seriesP90.push(p90);
		bytes.push(b[0] + b[1] + b[2]);
	}

	const duty = firmwareDuty(seriesP90);
	const eye = duty.map((d) => d ** (1 / 2.2));
	const settled = eye.slice(120);
	const lo = Math.min(...settled);
	const hi = Math.max(...settled);
	let steps = 0;
	for (let i = 1; i < settled.length; i++) if (Math.abs(settled[i] - settled[i - 1]) > 0.02) steps++;

	console.log(`Paused at t=${held.toFixed(1)}s, 10 s of frames, after 2 s to settle\n`);
	console.log(`  p90 byte    ${Math.min(...seriesP90.slice(120)).toFixed(0)} to ${Math.max(...seriesP90.slice(120)).toFixed(0)}`);
	console.log(`  first pixel ${Math.min(...bytes.slice(120))} to ${Math.max(...bytes.slice(120))} (sum of its three bytes)`);
	console.log(`  perceived   ${lo.toFixed(3)} to ${hi.toFixed(3)}, ${steps} jumps over 0.02\n`);
}

/**
 * Exposure, with no follower on the board at all.
 *
 * The mixer already auto-exposes at track scale, keeps a house floor and compresses
 * highlights, so the level reaching the wire is managed before it leaves the host. A second
 * gain on the board normalises against the loudest frame of the last half minute, which by
 * construction leaves every other frame below it: that is the dimness, not a missing gain.
 *
 * `duty = (byte / 255) ** g`, and g = 1 is the faithful one - duty proportional to the light
 * the strips would emit puts the LED's perceived brightness on the room's own curve.
 */
{
	console.log('Direct exposure, no follower. perceived = duty ^ 1/2.2\n');
	console.log('statistic    g    byte p50   perceived p05    p50    p95   beat dip   dark');
	for (const k of CANDIDATES) {
		for (const g of [1, 1.5]) {
			const bytes = byteLevels[k];
			const duty = bytes.map((v) => (v / 255) ** g);
			const eye = duty.map((d) => d ** (1 / 2.2));
			const s = [...eye].sort((a, b) => a - b);
			const at = (p: number) => s[Math.floor(s.length * p)];
			const dips = beatSwing(
				eye.map((v) => v * 255),
				bpm
			).sort((a, b) => a - b);
			const bs = [...bytes].sort((a, b) => a - b);
			console.log(
				k.padEnd(10) +
					g.toFixed(1).padStart(4) +
					bs[Math.floor(bs.length * 0.5)].toFixed(0).padStart(11) +
					[at(0.05), at(0.5), at(0.95)].map((v) => v.toFixed(2).padStart(9)).join('') +
					dips[Math.floor(dips.length * 0.5)].toFixed(2).padStart(11) +
					`${((100 * eye.filter((v) => v < 0.05).length) / eye.length).toFixed(0)}%`.padStart(7)
			);
		}
	}

	console.log('\nPer section, perceived brightness at the chosen statistic. A void has to go dark.');
	const bySection = new Map<string, number[]>();
	byteLevels['p90'].forEach((v, i) => {
		const arr = bySection.get(sections[i]) ?? [];
		arr.push((v / 255) ** (1 / 2.2));
		bySection.set(sections[i], arr);
	});
	for (const [name, vals] of bySection) {
		const s = [...vals].sort((a, b) => a - b);
		console.log(
			`  ${name.padEnd(11)} p05 ${s[Math.floor(s.length * 0.05)].toFixed(2)}   p50 ${s[Math.floor(s.length * 0.5)].toFixed(2)}   p95 ${s[Math.floor(s.length * 0.95)].toFixed(2)}`
		);
	}
	console.log();
}

/**
 * Why the LED reads white when the room reads coloured.
 *
 * Colour comes from a per-channel sum over the frame, and a sum in linear light is dominated by
 * its brightest pixels. In this system the brightest pixels are the white ones by design -
 * `SLOT.white` is what peaks and flashes are lit with, and `compressHighlights` desaturates
 * whatever clips on the way out. So the harder a cue pushes, the whiter its mean becomes, and
 * an LED driven from that mean goes pale exactly when the room goes bright.
 *
 * Splitting each pixel into a chroma part and an achromatic part gives one knob over that:
 * `colour[c] = chroma[c] + white * W`, where W of 256 is the current behaviour exactly and 0
 * keeps only hue. Cheaper than the sum it replaces, since it is the same addition split in two.
 */
{
	const WEIGHTS = [256, 128, 64, 32, 0];
	const satOf = (t: [number, number, number]) => {
		const hi = Math.max(...t);
		return hi > 0 ? 1 - Math.min(...t) / hi : 0;
	};

	const perSection = new Map<string, Map<number, number[]>>();
	let pinned = 0;

	const replay = new Mixer(geometry);
	const replayPlayer = new ShowPlayer(replay, new EffectRegistry());
	replayPlayer.load(analysis, show);

	for (let i = 0; i < frames; i++) {
		replay.render(replayPlayer.update(i * dt, dt));
		const b = replay.bytes;
		const chroma: [number, number, number] = [0, 0, 0];
		let white = 0;
		for (let o = 0; o < b.length; o += 3) {
			const r = b[o];
			const g = b[o + 1];
			const bl = b[o + 2];
			const lo = r < g ? (r < bl ? r : bl) : g < bl ? g : bl;
			chroma[0] += r - lo;
			chroma[1] += g - lo;
			chroma[2] += bl - lo;
			white += lo;
		}
		if (byteLevels['p90'][i] >= 255) pinned++;

		const forSection = perSection.get(sections[i]) ?? new Map<number, number[]>();
		for (const w of WEIGHTS) {
			const mixed: [number, number, number] = [
				chroma[0] + (white * w) / 256,
				chroma[1] + (white * w) / 256,
				chroma[2] + (white * w) / 256
			];
			forSection.set(w, [...(forSection.get(w) ?? []), satOf(mixed)]);
		}
		perSection.set(sections[i], forSection);
	}

	console.log('Saturation of the colour the LED is driven with, by white weight W\n');
	console.log('section      ' + WEIGHTS.map((w) => `W=${w}`.padStart(8)).join(''));
	for (const [name, byWeight] of perSection) {
		console.log(
			name.padEnd(12) +
				WEIGHTS.map((w) => {
					const vals = byWeight.get(w) ?? [];
					return (vals.reduce((a, c) => a + c, 0) / Math.max(1, vals.length))
						.toFixed(2)
						.padStart(8);
				}).join('')
		);
	}
	console.log(
		`\np90 sits at full scale on ${((100 * pinned) / frames).toFixed(1)}% of frames, ` +
			'which is where brightness stops separating one section from another.\n'
	);
}

console.log(`Engine show on the fixture grid, ${bpm} bpm, beat every ${(1 / beatHz).toFixed(3)} s.`);
console.log('Strength of the level signal at each multiple of the beat. 1 is the beat itself,');
console.log('2 is eighths, 4 is sixteenths. The winner is what the LED will look like it is doing.\n');

for (const kind of ['drop', 'groove'] as const) {
	const keep = sections.map((s, i) => (s === kind ? i : -1)).filter((i) => i >= 0);
	if (keep.length < FPS * 4) continue;
	const from = keep[0];
	const to = keep[keep.length - 1];

	console.log(`${kind}, ${((to - from) / FPS).toFixed(0)} s`);
	console.log('summary     ' + MULTIPLES.map((m) => `x${m}`.padStart(8)).join('') + '     peak');
	for (const k of Object.keys(SUMMARIES) as Summary[]) {
		const seg = detrend(levels[k].slice(from, to), Math.round((FPS * 4) / beatHz));
		const scores = MULTIPLES.map((m) => strengthAt(seg, beatHz * m));
		const best = MULTIPLES[scores.indexOf(Math.max(...scores))];
		console.log(
			k.padEnd(12) +
				scores.map((s) => s.toFixed(3).padStart(8)).join('') +
				`     x${best}`.padStart(9)
		);
	}
	console.log();
}
