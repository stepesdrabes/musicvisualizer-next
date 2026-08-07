import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
	DEFAULT_ROOM,
	EffectRegistry,
	Mixer,
	ShowPlayer,
	barTimeAt,
	buildGeometry,
	type Show,
	type TrackAnalysis
} from '@mv/core';

/** Which planned hits ever reach the room, by kind. */
const CACHE = join(import.meta.dirname, '..', 'cache');
const fps = 60;
const ids = [
	...new Set(
		readdirSync(CACHE)
			.filter((f) => f.endsWith('.show.json'))
			.map((f) => f.replace('.show.json', ''))
	)
].sort();

const geometry = buildGeometry(DEFAULT_ROOM);
const planned = new Map<string, number>();
const fired = new Map<string, number>();

for (const id of ids) {
	const analysis = JSON.parse(
		readFileSync(join(CACHE, `${id}.analysis.json`), 'utf8')
	) as TrackAnalysis;
	const show = JSON.parse(readFileSync(join(CACHE, `${id}.show.json`), 'utf8')) as Show;

	const mixer = new Mixer(geometry);
	const player = new ShowPlayer(mixer, new EffectRegistry());
	player.load(analysis, show);
	player.reset();

	// A hit has fired when the room does what it asks inside its own span: a blackout when the
	// intensity collapses, anything else when its effect is the one installed in the master.
	const seen = new Set<number>();
	const dt = 1 / fps;
	for (let t = 0; t < analysis.duration; t += dt) {
		const f = player.update(t, dt);
		mixer.render(f);
		for (const [i, h] of show.hits.entries()) {
			const start = barTimeAt(analysis.tempo, h.bar);
			const beat = (barTimeAt(analysis.tempo, h.bar + 1) - start) / analysis.tempo.beatsPerBar;
			const end = start + h.beats * beat;
			if (t < start || t >= end || seen.has(i)) continue;
			const master = mixer.layers.master;
			const ok =
				h.kind === 'blackout'
					? mixer.intensity < 0.1
					: master.effect !== null && master.params.trigger > 0.5;
			if (ok) seen.add(i);
		}
	}

	for (const [i, h] of show.hits.entries()) {
		planned.set(h.kind, (planned.get(h.kind) ?? 0) + 1);
		if (seen.has(i)) fired.set(h.kind, (fired.get(h.kind) ?? 0) + 1);
	}
}

let p = 0;
let n = 0;
console.log(`${'kind'.padEnd(12)}${'planned'.padStart(9)}${'fired'.padStart(8)}`);
for (const [kind, count] of [...planned].sort()) {
	p += count;
	n += fired.get(kind) ?? 0;
	console.log(`${kind.padEnd(12)}${String(count).padStart(9)}${String(fired.get(kind) ?? 0).padStart(8)}`);
}
console.log(`\n${n} of ${p} planned hits fire (${p - n} never do)`);
