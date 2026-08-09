import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { SectionKind } from '@mv/core';
import { arrange } from '../packages/analysis/src/arrange.ts';
import { groupSegments, segmentBars, similarityMatrix } from '../packages/analysis/src/structure.ts';
import { cacheIndex, cachedBars, readCache } from './struct-cache.ts';
import { scoreSegments, type Segment, type SegmentScores } from './segment-metrics.ts';

/**
 * Can a text model label sections better than the rules in `arrange()` can?
 *
 * The one question in this repo a language model could plausibly answer that the DSP cannot,
 * and the only one worth spending a network call on: labels are worth about three times what
 * boundaries are, and the labeller is the weaker half of the pair. DeepSeek has no ears, so it
 * never sees audio - it sees the same per-segment evidence `arrange` reads, as a table.
 *
 * The BOUNDARIES are held fixed at what the segmenter found. Only `kind` is replaced, so
 * boundary F0.5 and F3 must come out identical: they are the control, and if they move
 * something other than the labelling changed.
 *
 *   node bench/labelai.ts --label ai-1 [--limit 40] [--model deepseek-v4-flash] [--concurrency 6]
 *   node bench/labelai.ts --label base --baseline          # score arrange() alone, no calls
 *
 * Answers are cached in bench/reports/labelai-cache/, so a re-run costs nothing and a crash
 * halfway through does not have to be paid for twice.
 */
const argv = process.argv.slice(2);
const flag = (n: string, fallback = '') => {
	const i = argv.indexOf(`--${n}`);
	return i >= 0 ? argv[i + 1] : fallback;
};
const label = flag('label', 'labelai');
const limit = Number(flag('limit', String(Infinity)));
const model = flag('model', 'deepseek-v4-flash');
const concurrency = Number(flag('concurrency', '6'));
const baselineOnly = argv.includes('--baseline');

const KEY = process.env.DEEPSEEK_API_KEY;
if (!baselineOnly && !KEY) throw new Error('DEEPSEEK_API_KEY is not set');

const REPORTS = join(import.meta.dirname, 'reports');
const ANSWERS = join(REPORTS, 'labelai-cache');
mkdirSync(ANSWERS, { recursive: true });

const KINDS: SectionKind[] = ['intro', 'groove', 'breakdown', 'build', 'void', 'drop', 'outro'];

const VOCABULARY = `You are labelling the sections of one track for a lighting show. The audio has
already been analysed; you are reading its measurements, not listening to it.

The seven labels, which are lighting instructions rather than musicology:

  intro      the opening, before the track is properly running
  groove     going along: verse, chorus, anything that holds a steady state
  breakdown  stripped back, the kit largely gone, energy well down mid-track
  build      rising into something: energy and especially the high band climbing
  void       one or two bars of near-silence immediately before a drop
  drop       the passage something was built up to, arriving with the kit at full
  outro      the ending, after the track has finished being what it was

Two rules that decide most of the hard cases:

  A loud passage is a drop only when something set it up - a rise across the boundary into it -
  and only when the track has had two phrases to establish what it is dropping from. A ballad
  has no drop at all, and calling its loudest eight bars one is an invention.

  The kit separates these where energy does not. Measured over 374 annotated tracks, per beat:
  a drop carries 1.69 kicks and 1.41 snares, a groove 1.44 and 1.00, a build 1.06 and 0.63, and
  a breakdown 0.19 with half its bars carrying no kit at all.

Every segment gets exactly one label. Most of a normal track is groove; do not spread the rare
labels around to make the answer look varied.`;

interface Row extends SegmentScores {
	key: string;
	dataset: string;
	grooveShare: number;
}

interface Track {
	key: string;
	dataset: string;
	table: string;
	baseline: SectionKind[];
	est: Segment[];
	annotations: Segment[][];
	starts: number[];
	ends: number[];
}

/** Everything `arrange` gets to see about a segment, as a row a model can read. */
function buildTrack(entry: { key: string; dataset: string }): Track | null {
	const c = readCache(entry.key);
	const bars = cachedBars(c);
	const sim = similarityMatrix(bars);
	const bounds = segmentBars(sim, bars);
	const groups = groupSegments(sim, bars.count, bounds);
	const plan = arrange(
		c.bandsDb,
		bars,
		bounds,
		groups,
		c.shortTerm,
		c.shortTermFps,
		c.kicks,
		c.snares
	);
	if (plan.segments.length === 0) return null;

	const beatsPerBar = Math.max(1, c.beatsPerBar);
	const lines = [
		'seg  bars      len  energy  sub  low  mid  air  kicks/beat  snares/beat  repeatOf'
	];
	for (const [i, s] of plan.segments.entries()) {
		const span = Math.max(1, s.endBar - s.startBar);
		const at = (arr: Float32Array, band: number) => {
			let total = 0;
			for (let b = s.startBar; b < s.endBar; b++) total += arr[b * 4 + band] ?? 0;
			return Math.round((100 * total) / span);
		};
		let energy = 0;
		let kicks = 0;
		let snares = 0;
		for (let b = s.startBar; b < s.endBar; b++) {
			energy += plan.energy[b] ?? 0;
			kicks += c.kicks[b] ?? 0;
			snares += c.snares[b] ?? 0;
		}
		// The first segment sharing this group is the one this repeats, which is what tells a
		// third chorus that it is a chorus.
		const first = plan.segments.findIndex((o) => o.group === s.group);
		lines.push(
			`${String(i).padStart(3)}  ${`${s.startBar}-${s.endBar}`.padEnd(9)} ${String(span).padStart(3)} ${String(
				Math.round((100 * energy) / span)
			).padStart(6)} ${String(at(plan.bands, 0)).padStart(4)} ${String(at(plan.bands, 1)).padStart(4)} ${String(
				at(plan.bands, 2)
			).padStart(4)} ${String(at(plan.bands, 3)).padStart(4)} ${(kicks / span / beatsPerBar)
				.toFixed(2)
				.padStart(11)} ${(snares / span / beatsPerBar).toFixed(2).padStart(12)} ${
				first === i ? '-' : `seg ${first}`
			}`
		);
	}

	return {
		key: c.key,
		dataset: c.dataset,
		table: lines.join('\n'),
		baseline: plan.segments.map((s) => s.kind),
		est: plan.segments.map((s) => ({
			start: bars.time[s.startBar],
			end: bars.time[Math.min(s.endBar, bars.count)],
			label: s.kind
		})),
		annotations: c.segments,
		starts: plan.segments.map((s) => s.startBar),
		ends: plan.segments.map((s) => s.endBar)
	};
}

async function askDeepseek(track: Track): Promise<SectionKind[] | null> {
	const cached = join(ANSWERS, `${track.key.replace(/[^\w.-]/g, '_')}.json`);
	if (existsSync(cached)) {
		try {
			return JSON.parse(readFileSync(cached, 'utf8')) as SectionKind[];
		} catch {
			// A truncated answer from an interrupted run; ask again.
		}
	}

	const prompt = `${VOCABULARY}

The track runs ${track.ends.at(-1)} bars and the analyser found ${track.baseline.length} segments.
Energy and the four bands are percentiles within this track, 0-100, so they are relative to this
track alone. sub/low/mid/air are the four bands lowest first.

${track.table}

Answer with one JSON array of ${track.baseline.length} strings, in segment order, each one of
${KINDS.join(', ')}. No prose, no code fence, nothing else.`;

	// A worker with no timeout waits forever on a connection the far end has forgotten, and at
	// this concurrency a handful of those stops the run dead with no error to read. A track that
	// times out falls back to the rules, which is also what shipping this would do.
	const res = await fetch('https://api.deepseek.com/chat/completions', {
		signal: AbortSignal.timeout(300000),
		method: 'POST',
		headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
		body: JSON.stringify({
			model,
			messages: [{ role: 'user', content: prompt }],
			// Labels, not deliberation: the evidence is in the table and the rules are in the
			// prompt. Reasoning here costs several times the whole rest of the call.
			reasoning_effort: 'low',
			// max_tokens counts the reasoning too, and V4 reasons hard even at the lowest effort:
			// a real SALAMI track spends four to five figures of tokens deciding, then writes a
			// thirty-token array. At 2000 and again at 8000 every call came back empty with
			// finish_reason "length", which reads exactly like a model that cannot follow the
			// format rather than one that ran out of room to answer in.
			max_tokens: 32000
		})
	});
	if (!res.ok) {
		console.error(`  ${track.key}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
		return null;
	}

	const body = (await res.json()) as {
		choices?: { message?: { content?: string }; finish_reason?: string }[];
		usage?: { prompt_tokens: number; completion_tokens: number; prompt_cache_hit_tokens?: number };
	};
	if (body.usage) {
		spent.in += body.usage.prompt_tokens - (body.usage.prompt_cache_hit_tokens ?? 0);
		spent.cached += body.usage.prompt_cache_hit_tokens ?? 0;
		spent.out += body.usage.completion_tokens;
	}

	const text = body.choices?.[0]?.message?.content ?? '';
	const match = /\[[\s\S]*?\]/.exec(text);
	if (!match) {
		console.error(
			`  ${track.key}: no array in answer (finish_reason ${body.choices?.[0]?.finish_reason}): ${text.slice(0, 120)}`
		);
		return null;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(match[0]);
	} catch {
		console.error(`  ${track.key}: unparseable array`);
		return null;
	}
	if (!Array.isArray(parsed) || parsed.length !== track.baseline.length) {
		console.error(
			`  ${track.key}: got ${Array.isArray(parsed) ? parsed.length : '?'} labels for ${track.baseline.length} segments`
		);
		return null;
	}
	const labels = parsed.map((v) => (KINDS.includes(v as SectionKind) ? (v as SectionKind) : null));
	if (labels.some((v) => v === null)) {
		console.error(`  ${track.key}: an answer was outside the vocabulary`);
		return null;
	}

	writeFileSync(cached, JSON.stringify(labels));
	return labels as SectionKind[];
}

const spent = { in: 0, cached: 0, out: 0 };

function score(track: Track, kinds: SectionKind[]): Row {
	const est = track.est.map((s, i) => ({ ...s, label: kinds[i] }));
	const scored = track.annotations.map((ann) => scoreSegments(ann, est));
	const mean = (pick: (s: SegmentScores) => number) =>
		scored.reduce((a, s) => a + pick(s), 0) / scored.length;

	let grooveBars = 0;
	let bars = 0;
	for (const [i, kind] of kinds.entries()) {
		const span = track.ends[i] - track.starts[i];
		bars += span;
		if (kind === 'groove') grooveBars += span;
	}

	return {
		key: track.key,
		dataset: track.dataset,
		grooveShare: grooveBars / Math.max(1, bars),
		f05: mean((s) => s.f05),
		f3: mean((s) => s.f3),
		pairwiseF: mean((s) => s.pairwiseF),
		nceOver: mean((s) => s.nceOver),
		nceUnder: mean((s) => s.nceUnder),
		nceF: mean((s) => s.nceF),
		refSegments: Math.round(mean((s) => s.refSegments)),
		estSegments: scored[0].estSegments,
		longestEstShare: scored[0].longestEstShare
	};
}

const index = cacheIndex().slice(0, Number.isFinite(limit) ? limit : undefined);
const tracks: Track[] = [];
for (const entry of index) {
	const t = buildTrack(entry);
	if (t) tracks.push(t);
}
console.error(`${tracks.length} tracks`);

const baselineRows = tracks.map((t) => score(t, t.baseline));
const aiRows: Row[] = [];
/** Keys the model actually answered for, so the two columns are the same tracks. */
const answered = new Set<string>();
const agreement = new Map<string, number>();
let asked = 0;
let failed = 0;

if (!baselineOnly) {
	// A small pool rather than all at once: the point is to finish, and a rate limit halfway
	// through a corpus is a worse outcome than taking a minute longer.
	let cursor = 0;
	const workers = Array.from({ length: concurrency }, async () => {
		for (;;) {
			const i = cursor++;
			if (i >= tracks.length) return;
			const track = tracks[i];
			let kinds: SectionKind[] | null = null;
			try {
				kinds = await askDeepseek(track);
			} catch (e) {
				console.error(`  ${track.key}: ${(e as Error).message}`);
			}
			asked++;
			if (asked % 25 === 0) console.error(`  ${asked}/${tracks.length}`);
			if (!kinds) {
				failed++;
				// Falls back to the rules, which is what shipping this would do - but a fallback
				// scored into the comparison is the baseline appearing in its own opponent's
				// column, which pulls any real difference toward zero. Kept in the run, left out
				// of the numbers.
				aiRows.push(score(track, track.baseline));
				continue;
			}
			answered.add(track.key);
			for (const [k, kind] of kinds.entries()) {
				const same = kind === track.baseline[k];
				agreement.set(kind, (agreement.get(kind) ?? 0) + (same ? 1 : 0));
			}
			aiRows.push(score(track, kinds));
		}
	});
	await Promise.all(workers);
}

const dir = REPORTS;
mkdirSync(dir, { recursive: true });
const rows = baselineOnly ? baselineRows : aiRows.filter((r) => answered.has(r.key));
const against = baselineOnly ? baselineRows : baselineRows.filter((r) => answered.has(r.key));
writeFileSync(join(dir, `${label}.json`), JSON.stringify({ results: rows }));

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const METRICS: [string, (r: Row) => number, number][] = [
	['groove share', (r) => r.grooveShare, 100],
	['boundary F0.5', (r) => r.f05, 100],
	['boundary F3', (r) => r.f3, 100],
	['pairwise F', (r) => r.pairwiseF, 100],
	['over-segmentation', (r) => r.nceOver, 100],
	['under-segmentation', (r) => r.nceUnder, 100]
];

console.log(
	`\n=== ${label} ===   ${rows.length} tracks scored, ${failed} timed out or failed and are excluded`
);
console.log(`  metric              arrange()  ${baselineOnly ? '' : model}`);
for (const [name, pick, scale] of METRICS) {
	const base = scale * avg(against.map(pick));
	if (baselineOnly) {
		console.log(`  ${name.padEnd(20)}${base.toFixed(1).padStart(8)}`);
		continue;
	}
	const now = scale * avg(rows.map(pick));
	const d = now - base;
	console.log(
		`  ${name.padEnd(20)}${base.toFixed(1).padStart(8)}${now.toFixed(1).padStart(11)}   ${d >= 0 ? '+' : ''}${d.toFixed(2)}`
	);
}

if (!baselineOnly) {
	const cost = (spent.in / 1e6) * 0.14 + (spent.cached / 1e6) * 0.0028 + (spent.out / 1e6) * 0.28;
	console.log(
		`\n  ${spent.in} uncached + ${spent.cached} cached in, ${spent.out} out, about $${cost.toFixed(3)}`
	);
}
