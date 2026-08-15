// Stage a cut-grid variant of one track's analysis into a cache, so the owner can hear
// a half-bar hypothesis before drawing the map that makes it permanent. This runs the
// REAL pipeline path - analyzeTrack's gridCuts input, true short bars - so what is
// heard is exactly what a hand-drawn map with these boundaries would produce.
//
//   MV_CACHE_DIR=<cache> node bench/gridedit.ts <trackId> <cutT1,cutT2,...>
//   MV_CACHE_DIR=<cache> node bench/gridedit.ts <trackId> restore
//
// The variant keeps the ORIGINAL blob's audio hash and id, so the app serves it as
// cached; the show.json is removed so composition re-derives. The pre-experiment blob
// is saved beside as <id>.analysis.json.orig - `restore` puts it back. Bench-path
// drums (no Adtof), acceptable for a listening A/B.
import { copyFileSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { decodeAudio } from '@mv/analysis';
import { analyzeTrack } from '../packages/analysis/src/analyze.ts';

const id = process.argv[2];
const arg = process.argv[3];
if (!id || !arg) throw new Error('usage: node bench/gridedit.ts <trackId> <cutT1,cutT2,...|restore>');
const cache = process.env.MV_CACHE_DIR ?? join(homedir(), 'Library/Application Support/cz.drabek.lightningstrike/cache');
const blobPath = join(cache, `${id}.analysis.json`);
const origPath = `${blobPath}.orig`;
const showPath = join(cache, `${id}.show.json`);

if (arg === 'restore') {
	if (!existsSync(origPath)) throw new Error(`nothing to restore at ${origPath}`);
	renameSync(origPath, blobPath);
	rmSync(showPath, { force: true });
	console.log('restored original analysis; show will recompose on next play');
	process.exit(0);
}

const cuts = arg.split(',').map(Number);
if (cuts.some((c) => !Number.isFinite(c))) throw new Error('cut points must be seconds');
const beatsPath = join(import.meta.dirname, 'corpus/.beats', `judged-${id}.json`);
if (!existsSync(beatsPath)) throw new Error(`no cached beats at ${beatsPath} - run earlybars first`);
const tracked = JSON.parse(readFileSync(beatsPath, 'utf8')) as { beats: number[]; downbeats: number[] };

const orig = JSON.parse(readFileSync(blobPath, 'utf8')) as { hash: string; trackId: string };
const meta = JSON.parse(readFileSync(join(cache, `${id}.meta.json`), 'utf8')) as { title: string };
const files = readdirSync(cache);
const audioFile = files.find((x) => x.startsWith(`${id}.`) && !x.includes('.json') && !x.endsWith('.pcm'));
if (!audioFile) throw new Error(`no audio for ${id} in ${cache}`);
const context = existsSync(join(cache, `${id}.context.json`))
	? JSON.parse(readFileSync(join(cache, `${id}.context.json`), 'utf8'))
	: undefined;

const decoded = await decodeAudio(join(cache, audioFile));
const analysis = analyzeTrack({
	mono: decoded.mono,
	sampleRate: decoded.sampleRate,
	duration: decoded.duration,
	hash: orig.hash,
	trackId: orig.trackId,
	title: meta.title,
	context,
	beats: tracked.beats,
	downbeats: tracked.downbeats,
	gridCuts: cuts
});

if (!existsSync(origPath)) copyFileSync(blobPath, origPath);
writeFileSync(blobPath, JSON.stringify(analysis));
rmSync(showPath, { force: true });

console.log(`staged cut grid via the real path, meterConf ${analysis.tempo.meterConfidence}`);
console.log('sections:', analysis.sections.map((s) => `${s.kind}@${s.startBar}`).join(' '));
const bt = analysis.tempo.barTimes;
for (const t of cuts) {
	let b = 0;
	for (let i = 0; i < bt.length - 1; i++) if (Math.abs(bt[i] - t) < Math.abs(bt[b] - t)) b = i;
	console.log(`  cut ${t}s -> bar line ${b} at ${bt[b].toFixed(2)}s (span ${(bt[b] - bt[b - 1]).toFixed(2)}s before it)`);
}
