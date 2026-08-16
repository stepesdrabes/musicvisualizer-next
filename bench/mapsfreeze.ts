// Freeze the blind hand-drawn maps into bench/maps-eval/, which is the evaluation set no
// model may ever train on.
//
//   MV_CACHE_DIR=<cache> node bench/mapsfreeze.ts [--force]
//
// A frozen map is never overwritten. That is the whole mechanism: an evaluation set that can
// be quietly refreshed against a model's mistakes is not an evaluation set, and the P6
// postmortem is what a metric that moves with the thing it grades costs. `--force` exists for
// a mis-frozen file and prints what it replaced.
//
// Only BLIND maps are eligible. A map corrected from the analyser's own draft agrees with the
// analyser partly because it started there, so it can train a model and cannot grade one.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { SECTION_KINDS } from '@mv/core';

const cache = process.env.MV_CACHE_DIR ?? join(homedir(), 'Library/Application Support/cz.drabek.lightningstrike/cache');
const judgeDir = join(cache, 'judge');
const evalDir = join(import.meta.dirname, 'maps-eval');
const force = process.argv.includes('--force');

if (!existsSync(judgeDir)) throw new Error(`no judge dir at ${judgeDir}`);
mkdirSync(evalDir, { recursive: true });

interface JudgedSection { kind: string; startTime: number; endTime: number; startBar: number; endBar: number }
interface Judgement {
	trackId: string;
	title: string;
	sections?: JudgedSection[] | null;
	blind?: boolean;
	editSeconds?: number;
	analysisHash: string | null;
}

const KINDS = new Set<string>(SECTION_KINDS);
let frozen = 0;
let already = 0;
let skipped = 0;
const times: number[] = [];

for (const f of readdirSync(judgeDir).filter((x) => x.endsWith('.json'))) {
	const j = JSON.parse(readFileSync(join(judgeDir, f), 'utf8')) as Judgement;
	if (!j.sections?.length) continue;
	const name = j.title.slice(0, 42).padEnd(42);

	if (!j.blind) {
		console.log(`  skip    ${name} corrected from the analyser's draft, not blind`);
		skipped++;
		continue;
	}
	if (j.sections.length < 2) {
		console.log(`  skip    ${name} one span - nothing was drawn`);
		skipped++;
		continue;
	}
	const bad = j.sections.map((s) => s.kind).filter((k) => !KINDS.has(k));
	if (bad.length) {
		console.log(`  SKIP    ${name} unknown kinds: ${[...new Set(bad)].join(', ')}`);
		skipped++;
		continue;
	}

	const out = join(evalDir, `${j.trackId}.json`);
	if (existsSync(out) && !force) {
		already++;
		continue;
	}
	if (existsSync(out) && force) {
		const old = JSON.parse(readFileSync(out, 'utf8')) as Judgement;
		console.log(`  REPLACE ${name} ${old.sections?.length} spans -> ${j.sections.length}`);
	}
	writeFileSync(
		out,
		JSON.stringify(
			{
				trackId: j.trackId,
				title: j.title,
				sections: j.sections,
				blind: true,
				editSeconds: j.editSeconds ?? null,
				// The grid the times were read against, for anyone joining bars rather than seconds.
				analysisHash: j.analysisHash,
				frozenFrom: cache
			},
			null,
			'\t'
		)
	);
	console.log(`  freeze  ${name} ${j.sections.length} spans${j.editSeconds ? `, ${Math.round(j.editSeconds / 60)} min` : ''}`);
	frozen++;
	if (j.editSeconds) times.push(j.editSeconds);
}

const total = readdirSync(evalDir).filter((f) => f.endsWith('.json')).length;
console.log(`\n${frozen} newly frozen, ${already} already frozen, ${skipped} not eligible`);
console.log(`eval set is ${total} of the 15 Phase 0 wants`);
if (times.length) {
	const sorted = [...times].sort((a, b) => a - b);
	const median = sorted[Math.floor(sorted.length / 2)];
	const mean = times.reduce((a, v) => a + v, 0) / times.length;
	console.log(
		`drawing time over ${times.length} timed maps: median ${(median / 60).toFixed(1)} min, mean ${(mean / 60).toFixed(1)} min`
	);
}
