// The downbeat-phase probe, round 4's opening instrument.
//
// (A) Every owner-timestamped mark, placed WITHIN its bar on the shipped grid: if the
// grid's phase is right, marks cluster near beat 0 (plus ~0.3-0.8 beats of reaction
// lag); a half-bar phase flip clusters them near beat 2. Original-round notes are
// scored against the A cache's grids (the grids they were judged on), fresh C-judge
// notes against cache-C.
// (B) Where earlybars cached a Beat This run, the model's own downbeat stream against
// the shipped grid's bar starts: the offset (in beats, mod beatsPerBar) says whether
// the shipped phase agrees with the model, and on which tracks they diverge.
//
//   node bench/phaseprobe.ts
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const A = join(homedir(), 'Library/Application Support/cz.drabek.lightningstrike/cache');
const C = join(homedir(), 'Library/Application Support/cz.drabek.lightningstrike/cache-C');
const BEATS = join(import.meta.dirname, 'corpus/.beats');
const snapshot = JSON.parse(
	readFileSync(join(import.meta.dirname, 'judged/round-2026-08-14/snapshot.json'), 'utf8')
) as { tracks: { id: string; title: string; notes: { t: number; bar: number | null; text: string }[] }[] };

interface Grid {
	barTimes: number[];
	beatsPerBar: number;
	meterConfidence: number;
	bpm: number;
}

function gridFor(cache: string, id: string): Grid | null {
	const p = join(cache, `${id}.analysis.json`);
	if (!existsSync(p)) return null;
	const a = JSON.parse(readFileSync(p, 'utf8'));
	return {
		barTimes: a.tempo.barTimes,
		beatsPerBar: a.tempo.beatsPerBar,
		meterConfidence: a.tempo.meterConfidence,
		bpm: a.tempo.bpm
	};
}

/** Beats into the bar containing t, 0..beatsPerBar. */
function beatInBar(g: Grid, t: number): number | null {
	const bt = g.barTimes;
	let b = 0;
	while (b < bt.length - 2 && bt[b + 1] <= t) b++;
	const len = bt[b + 1] - bt[b];
	if (!(len > 0) || t < bt[0]) return null;
	return ((t - bt[b]) / len) * g.beatsPerBar;
}

console.log('=== (A) owner marks, beats into the bar (reaction lag drifts them LATE ~0.3-0.8)');
const rows: { title: string; conf: number; positions: number[] }[] = [];
for (const t of snapshot.tracks) {
	const g = gridFor(A, t.id);
	if (!g) continue;
	const positions = t.notes
		.filter((n) => n.bar !== null)
		.map((n) => beatInBar(g, n.t))
		.filter((v): v is number => v !== null);
	if (positions.length) rows.push({ title: t.title, conf: g.meterConfidence, positions });
}
// Fresh C-judge notes against C's grids.
for (const f of readdirSync(join(C, 'judge')).filter((f) => f.endsWith('.json'))) {
	const j = JSON.parse(readFileSync(join(C, 'judge', f), 'utf8'));
	const orig = snapshot.tracks.find((t) => t.id === j.trackId);
	const known = new Set((orig?.notes ?? []).map((n) => `${n.bar}|${n.text}`));
	const fresh = (j.notes ?? []).filter((n: { bar: number; text: string }) => !known.has(`${n.bar}|${n.text}`));
	if (!fresh.length) continue;
	const g = gridFor(C, j.trackId);
	if (!g) continue;
	const positions = fresh
		.map((n: { t: number }) => beatInBar(g, n.t))
		.filter((v: number | null): v is number => v !== null);
	if (positions.length) rows.push({ title: `${j.title} (fresh)`, conf: g.meterConfidence, positions });
}
for (const r of rows.sort((a, b) => a.conf - b.conf)) {
	const list = r.positions.map((p) => p.toFixed(1)).join(' ');
	console.log(`  conf ${r.conf.toFixed(2)}  ${r.title.slice(0, 34).padEnd(36)} [${list}]`);
}

console.log('\n=== (B) Beat This downbeats vs the shipped grid (median offset in beats, mod bar)');
for (const f of readdirSync(BEATS).filter((f) => f.startsWith('judged-'))) {
	const id = f.slice(7, -5);
	const g = gridFor(A, id) ?? gridFor(C, id);
	if (!g) continue;
	const tracked = JSON.parse(readFileSync(join(BEATS, f), 'utf8')) as { downbeats: number[] };
	const offs: number[] = [];
	for (const d of tracked.downbeats) {
		const p = beatInBar(g, d);
		if (p !== null) offs.push(p);
	}
	if (!offs.length) continue;
	// Circular median over 0..beatsPerBar: cheap version, histogram the quarter-beats.
	const hist = new Array(g.beatsPerBar * 4).fill(0);
	for (const o of offs) hist[Math.floor(o * 4) % hist.length]++;
	const peak = hist.indexOf(Math.max(...hist)) / 4;
	const share = Math.max(...hist) / offs.length;
	const title = snapshot.tracks.find((t) => t.id === id)?.title ?? id;
	console.log(
		`  conf ${g.meterConfidence.toFixed(2)}  ${title.slice(0, 34).padEnd(36)} model downbeats at +${peak.toFixed(2)} beats (${(share * 100).toFixed(0)}% agree, n=${offs.length})`
	);
}
