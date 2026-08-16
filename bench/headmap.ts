// Run the SHELVED MusicFM section head against the owner's hand-drawn maps, and score it
// with mapscore's columns. The P6 head was rolled back on room evidence before any hand map
// existed; this is the first time it is measured against the vocabulary it was trained for,
// as the owner actually draws it.
//
//   MV_CACHE_DIR=<cache> node <this> [trackId]
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { decodeAudio } from '@mv/analysis';
import { MusicFm, MUSICFM_RATE, MUSICFM_FPS } from '../packages/analysis/src/musicfm.ts';

const cache = process.env.MV_CACHE_DIR ?? join(homedir(), 'Library/Application Support/cz.drabek.lightningstrike/cache');
const only = process.argv[2];
const judgeDir = join(cache, 'judge');

interface Span { kind: string; startTime: number; endTime: number }
const kindAt = (spans: Span[], t: number) => spans.find((s) => t >= s.startTime && t < s.endTime)?.kind ?? null;

const model = await MusicFm.create();
if (!model) throw new Error('MusicFM artefacts missing from models/');
console.log(`kinds: ${model.kinds.join(', ')}\n`);

for (const f of readdirSync(judgeDir).filter((x) => x.endsWith('.json'))) {
	const j = JSON.parse(readFileSync(join(judgeDir, f), 'utf8')) as {
		trackId: string; title: string; sections?: Span[] | null;
	};
	if (!j.sections?.length) continue;
	if (only && j.trackId !== only) continue;
	const blobPath = join(cache, `${j.trackId}.analysis.json`);
	if (!existsSync(blobPath)) continue;
	const analysis = JSON.parse(readFileSync(blobPath, 'utf8')) as { sections: Span[]; duration: number };

	const audio = readdirSync(cache).find((x) => x.startsWith(`${j.trackId}.`) && !x.includes('.json') && !x.endsWith('.pcm'));
	if (!audio) { console.log(`${j.title}: no audio`); continue; }

	const t0 = Date.now();
	const decoded = await decodeAudio(join(cache, audio), MUSICFM_RATE);
	const emb = await model.embed(decoded.mono);
	const post = await model.label(emb);
	const secs = (Date.now() - t0) / 1000;

	// Frame argmax -> a per-second kind, the same sampling mapscore uses.
	const classes = model.kinds.length;
	const frameKind = (t: number): string | null => {
		const f = Math.round(t * MUSICFM_FPS);
		if (f < 0 || f >= emb.frames) return null;
		let best = 0;
		for (let c = 1; c < classes; c++) if (post[f * classes + c] > post[f * classes + best]) best = c;
		return model.kinds[best];
	};

	const duration = analysis.duration ?? j.sections[j.sections.length - 1].endTime;
	let headAgree = 0, rulesAgree = 0, n = 0;
	const headSeen = new Set<string>(), rulesSeen = new Set<string>();
	const conf = new Map<string, Map<string, number>>();
	for (let t = 0.5; t < duration; t += 1) {
		const hand = kindAt(j.sections, t);
		const head = frameKind(t);
		const rules = kindAt(analysis.sections, t);
		if (!hand || !head || !rules) continue;
		n++;
		headSeen.add(head); rulesSeen.add(rules);
		if (hand === head) headAgree++;
		if (hand === rules) rulesAgree++;
		const row = conf.get(hand) ?? new Map<string, number>();
		row.set(head, (row.get(head) ?? 0) + 1);
		conf.set(hand, row);
	}

	console.log(`=== ${j.title.slice(0, 46)}  (${emb.frames} frames, ${secs.toFixed(0)}s inference)`);
	console.log(`  strict 9-way vs hand map:  HEAD ${((100 * headAgree) / n).toFixed(0)}%  (${headSeen.size} kinds)   RULES ${((100 * rulesAgree) / n).toFixed(0)}%  (${rulesSeen.size} kinds)   over ${n}s`);
	for (const [hand, row] of conf) {
		const top = [...row.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${v}s`).join(', ');
		console.log(`    hand ${hand.padEnd(10)} -> head says: ${top}`);
	}
	console.log();
}
await model.close();
