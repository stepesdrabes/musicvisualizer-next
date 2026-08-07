import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { BUILT_IN_EFFECTS, LAYER_ROLES, type Show, type TrackAnalysis } from '@mv/core';
import { composeShow } from '@mv/author-engine';

/**
 * How much of the catalog a show actually reaches, and what wins the biggest moment.
 *
 * Printed as `name<tab>value` so `tune.ts` can sweep against it.
 *
 *   node bench/rotationprobe.ts [--seeds 20] [--verbose]
 */
const CACHE = join(import.meta.dirname, '..', 'cache');
const argv = process.argv.slice(2);
const flag = (n: string, d: number) => {
	const i = argv.indexOf(`--${n}`);
	return i >= 0 ? Number(argv[i + 1]) : d;
};
const seeds = flag('seeds', 20);
const verbose = argv.includes('--verbose');

const ids = [
	...new Set(
		readdirSync(CACHE)
			.filter((f) => f.endsWith('.analysis.json'))
			.map((f) => f.replace('.analysis.json', ''))
	)
].sort();

const placed = new Map<string, number>();
const peakWinner = new Map<string, number>();
const perShowDistinct: number[] = [];
const bedChanges: number[] = [];
let offPhrase = 0;
let cueTotal = 0;
let holds = 0;

const analyses = ids.map(
	(id) => JSON.parse(readFileSync(join(CACHE, `${id}.analysis.json`), 'utf8')) as TrackAnalysis
);

for (const analysis of analyses) {
	for (let s = 0; s < seeds; s++) {
		const show: Show = composeShow(analysis, { seed: s === 0 ? undefined : 1 + s * 7919 });
		const anchor = analysis.tempo.phraseAnchorBar;
		const measured = new Set(analysis.sections.map((x) => x.startBar));

		const distinct = new Set<string>();
		const cues = [...show.cues].sort((a, b) => a.bar - b.bar);
		let lastBed: string | null = null;
		let changes = 0;

		for (const [i, cue] of cues.entries()) {
			for (const role of LAYER_ROLES) {
				const id = cue.layers[role]?.effect;
				if (!id) continue;
				distinct.add(id);
				placed.set(id, (placed.get(id) ?? 0) + 1);
			}
			const bed = cue.layers.bed?.effect ?? null;
			if (bed && bed !== lastBed) changes++;
			lastBed = bed;

			cueTotal++;
			if (i > 0 && !(((cue.bar - anchor) % 4 + 4) % 4 === 0) && !measured.has(cue.bar)) offPhrase++;
			const end = i + 1 < cues.length ? cues[i + 1].bar : analysis.bars.length;
			if (end - cue.bar > 16) holds++;
		}
		// A hit installs a master effect by name; counting the kind instead would report an
		// effect as never placed while it fires all night.
		const HIT_EFFECT: Record<string, string | null> = {
			blackout: null, slam: 'slam', strobe: 'strobe', bump: 'colorBump'
		};
		for (const hit of show.hits) {
			const id = HIT_EFFECT[hit.kind];
			if (id) placed.set(id, (placed.get(id) ?? 0) + 1);
		}

		const peak = analysis.sections.find((x) => x.energyRank === 1);
		const at = cues.filter((c) => c.bar >= (peak?.startBar ?? 0) && c.bar < (peak?.endBar ?? 0));
		const look = at[0]?.layers.master?.effect ?? at[0]?.layers.accent?.effect ?? '(none)';
		peakWinner.set(look, (peakWinner.get(look) ?? 0) + 1);

		perShowDistinct.push(distinct.size);
		bedChanges.push(changes);
	}
}

const never = BUILT_IN_EFFECTS.filter((e) => !placed.has(e.id)).map((e) => e.id);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const topPeak = [...peakWinner].sort((a, b) => b[1] - a[1]);
const totalShows = ids.length * seeds;

if (verbose) {
	console.error(`never placed (${never.length}/${BUILT_IN_EFFECTS.length}): ${never.join(' ')}`);
	console.error(`peak winners: ${topPeak.map(([k, v]) => `${k} ${v}`).join(', ')}`);
	const rare = [...placed].sort((a, b) => a[1] - b[1]).slice(0, 12);
	console.error(`rarest placed: ${rare.map(([k, v]) => `${k}:${v}`).join(' ')}`);
}

const emit = (name: string, value: number, digits = 2) =>
	console.log(`${name}\t${value.toFixed(digits)}`);

emit('never placed', never.length, 0);
emit('distinct/show', mean(perShowDistinct));
emit('bed changes/show', mean(bedChanges));
emit('top peak share', (100 * (topPeak[0]?.[1] ?? 0)) / totalShows, 1);
emit('distinct peaks', peakWinner.size, 0);
emit('off-phrase cues', (100 * offPhrase) / Math.max(1, cueTotal), 1);
emit('cues over 16 bars', holds, 0);
