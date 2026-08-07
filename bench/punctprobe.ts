import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
	BUILT_IN_EFFECTS,
	PHRASE_BARS,
	barDurationAt,
	onPhraseGrid,
	type EffectDef,
	type Show,
	type TrackAnalysis
} from '@mv/core';
import { lintShow } from '@mv/author-engine';

/**
 * Where punctuation starts and how long it holds the room.
 *
 * The complaint this exists to measure is about feel rather than count: a hit that starts
 * mid-phrase reads as a mistake, and a strobe is judged by how long it lasts in SECONDS, which
 * a bar count hides because a bar is 1.4 s at 175 bpm and 3 s at 80.
 *
 * `unanchored` is the linter's own verdict rather than a second opinion, so a rule that stops
 * being enforced shows up here as a number rather than as silence.
 *
 * Printed as `name<tab>value` so `tune.ts` can sweep against it.
 *
 *   node bench/punctprobe.ts [--verbose]
 */
const CACHE = join(import.meta.dirname, '..', 'cache');
const verbose = process.argv.includes('--verbose');

const ids = [
	...new Set(
		readdirSync(CACHE)
			.filter((f) => f.endsWith('.show.json'))
			.map((f) => f.replace('.show.json', ''))
	)
].sort();

interface Row {
	kind: string;
	bars: number;
	seconds: number;
	onPhrase: boolean;
	onBar: boolean;
	wholeBars: boolean;
}

const rows: Row[] = [];
/** Blackouts placed before a drop, and whether they run to its downbeat. */
let preDrop = 0;
let preDropShort = 0;
const errors = new Map<string, number>();

const effects = new Map<string, EffectDef>(BUILT_IN_EFFECTS.map((e) => [e.id, e]));

for (const id of ids) {
	const analysis = JSON.parse(
		readFileSync(join(CACHE, `${id}.analysis.json`), 'utf8')
	) as TrackAnalysis;
	const show = JSON.parse(readFileSync(join(CACHE, `${id}.show.json`), 'utf8')) as Show;
	const { tempo } = analysis;
	const dropStarts = analysis.sections.filter((s) => s.kind === 'drop').map((s) => s.startBar);

	for (const f of lintShow(show, { analysis, effects }).errors) {
		errors.set(f.rule, (errors.get(f.rule) ?? 0) + 1);
	}

	for (const hit of show.hits) {
		const bars = hit.beats / tempo.beatsPerBar;
		// Where it finishes, which is the end that matters for a gesture placed backwards from
		// the boundary it points at.
		const end = hit.bar + ((hit.beat ?? 0) + hit.beats) / tempo.beatsPerBar;
		rows.push({
			kind: hit.kind,
			bars,
			seconds: bars * barDurationAt(tempo, hit.bar),
			onPhrase: onPhraseGrid(hit.bar, tempo.phraseAnchorBar),
			onBar: !hit.beat,
			wholeBars: Math.abs(end - Math.round(end)) < 1e-9
		});

		if (hit.kind !== 'blackout') continue;
		// The held breath: a blackout whose job is to set up the downbeat after it.
		const target = dropStarts.find((b) => b > hit.bar && b - hit.bar <= 2);
		if (target === undefined) continue;
		preDrop++;
		if (end < target - 1e-9) preDropShort++;
	}
}

const median = (xs: number[]) => {
	if (xs.length === 0) return 0;
	const s = [...xs].sort((a, b) => a - b);
	return s[s.length >> 1];
};

if (verbose) {
	const head = ['kind', 'n', 'med bars', 'max bars', 'med s', 'max s'];
	console.error(
		head[0].padEnd(10) + head.slice(1).map((h, i) => h.padStart(i === 0 ? 4 : 9)).join('')
	);
	for (const kind of [...new Set(rows.map((r) => r.kind))].sort()) {
		const of = rows.filter((r) => r.kind === kind);
		const cells = [
			median(of.map((r) => r.bars)),
			Math.max(...of.map((r) => r.bars)),
			median(of.map((r) => r.seconds)),
			Math.max(...of.map((r) => r.seconds))
		];
		console.error(
			kind.padEnd(10) +
				String(of.length).padStart(4) +
				cells.map((c) => c.toFixed(2).padStart(9)).join('')
		);
	}
	if (errors.size > 0) {
		console.error(`lint errors: ${[...errors].map(([r, n]) => `${r} x${n}`).join(', ')}`);
	}
}

const emit = (name: string, value: number, digits = 2) =>
	console.log(`${name}\t${value.toFixed(digits)}`);
const strobes = rows.filter((r) => r.kind === 'strobe');
const total = (rule: string) => errors.get(rule) ?? 0;

emit('hits', rows.length, 0);
emit('off-bar starts', rows.filter((r) => !r.onBar).length, 0);
emit(`off-${PHRASE_BARS}-bar starts`, rows.filter((r) => !r.onPhrase).length, 0);
emit('not ending on a downbeat', rows.filter((r) => !r.wholeBars).length, 0);
emit('unanchored', total('unanchored-hit'), 0);
emit('over length', total('hit-too-long') + total('hit-too-long-in-seconds'), 0);
emit('blackouts ending early', total('blackout-ends-early') + preDropShort, 0);
emit('lint errors', [...errors.values()].reduce((a, b) => a + b, 0), 0);
emit('pre-drop blackouts', preDrop, 0);
emit('max seconds', Math.max(0, ...rows.map((r) => r.seconds)));
emit('strobe med s', median(strobes.map((r) => r.seconds)));
emit('strobe max s', Math.max(0, ...strobes.map((r) => r.seconds)));
