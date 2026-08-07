import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	DEFAULT_ROOM,
	EffectRegistry,
	LAYER_ROLES,
	Mixer,
	ShowPlayer,
	buildGeometry,
	type Show,
	type TrackAnalysis
} from '@mv/core';

/**
 * Per cue: what the show asked for and what the room received, so a dark passage can be
 * attributed to the effect, the cue's intensity, the output chain or the analysis.
 *
 *   node bench/darkprobe.ts <trackId>
 */
const CACHE = join(import.meta.dirname, '..', 'cache');
const id = process.argv[2];
const analysis = JSON.parse(
	readFileSync(join(CACHE, `${id}.analysis.json`), 'utf8')
) as TrackAnalysis;
const show = JSON.parse(readFileSync(join(CACHE, `${id}.show.json`), 'utf8')) as Show;

const geometry = buildGeometry(DEFAULT_ROOM);
const mixer = new Mixer(geometry);
const player = new ShowPlayer(mixer, new EffectRegistry());
player.load(analysis, show);
player.reset();

const cues = [...show.cues].sort((a, b) => a.bar - b.bar);
const rows = cues.map((c) => ({
	cue: c,
	layerSum: new Float64Array(LAYER_ROLES.length),
	raw: 0,
	out: 0,
	energy: 0,
	intensity: 0,
	gain: 0,
	frames: 0
}));

const fps = 30;
const dt = 1 / fps;
let at = 0;
for (let t = 0; t < analysis.duration; t += dt) {
	const f = player.update(t, dt);
	mixer.render(f);
	while (at + 1 < cues.length && f.barIndex >= cues[at + 1].bar) at++;
	const r = rows[at];

	// Each layer's own buffer, before the mixer blends and before the output chain.
	for (const [k, role] of LAYER_ROLES.entries()) {
		const layer = mixer.layers[role];
		if (!layer.effect) continue;
		let sum = 0;
		for (let i = 0; i < layer.buf.length; i += 3) {
			sum += Math.max(layer.buf[i], layer.buf[i + 1], layer.buf[i + 2]);
		}
		r.layerSum[k] += (sum / (layer.buf.length / 3)) * layer.opacity;
	}

	let out = 0;
	for (let i = 0; i < mixer.bytes.length; i += 3) {
		out += Math.max(mixer.bytes[i], mixer.bytes[i + 1], mixer.bytes[i + 2]);
	}
	r.out += out / (mixer.bytes.length / 3) / 255;
	r.energy += f.energy;
	r.intensity += mixer.intensity;
	r.frames++;
}

console.log(`${id}  ${analysis.title}\n`);
console.log(
	`${'bar'.padStart(5)} ${'section'.padEnd(10)} ${'cueInt'.padStart(7)}${'energy'.padStart(8)}${'out'.padStart(8)}   layers`
);
for (const r of rows) {
	if (r.frames === 0) continue;
	const layers = LAYER_ROLES.map((role, k) => {
		const spec = r.cue.layers[role];
		if (!spec) return null;
		return `${role[0]}:${spec.effect}=${(r.layerSum[k] / r.frames).toFixed(3)}`;
	}).filter(Boolean);
	console.log(
		`${String(r.cue.bar).padStart(5)} ${r.cue.section.padEnd(10)} ${(r.cue.intensity ?? show.defaults.intensity).toFixed(2).padStart(7)}${(r.energy / r.frames).toFixed(3).padStart(8)}${(r.out / r.frames).toFixed(3).padStart(8)}   ${layers.join(' ')}`
	);
}
