// Stage a variant analysis whose bar grid absorbs half-bar edits the record actually
// contains, so the owner can hear a piecewise-phase hypothesis. Safir's five prescription
// marks are bimodal against any single phase: the track inserts 2 beats twice, and no
// global flip can serve both halves (round-5 record, "piecewise-phase track").
//
// Mechanism: delete the two listed beats ENDING at each cut point from the cached
// BeatThis stream, and rebuild downbeats every 4th surviving beat from phase 0. A
// uniform 4-beat reader over the doctored list then lands bar lines exactly on the
// owner's marks; the bar spanning a cut runs physically long, which is the honest
// short-bar wart until the real variable-grid design lands. The full pipeline re-runs
// on the doctored inputs - nothing downstream is forced.
//
//   MV_CACHE_DIR=<cache> node bench/gridedit.ts <trackId> <cutT1,cutT2,...>
//   MV_CACHE_DIR=<cache> node bench/gridedit.ts <trackId> restore
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

// Drop the two beats immediately BEFORE each cut point (the beat nearest the cut and
// its predecessor), so the next surviving beat begins the re-phased passage on the mark.
let beats = [...tracked.beats];
for (const cut of cuts) {
	let nearest = 0;
	for (let i = 1; i < beats.length; i++) if (Math.abs(beats[i] - cut) < Math.abs(beats[nearest] - cut)) nearest = i;
	if (nearest < 2) throw new Error(`cut ${cut} too early`);
	beats.splice(nearest - 2, 2);
	console.log(`cut 2 beats before ${cut}s (removed ~${(beats[nearest - 2] ?? cut).toFixed(2)}s neighbourhood)`);
}
const downbeats = beats.filter((_, i) => i % 4 === 0);

const decoded = await decodeAudio(join(cache, audioFile));
const analysis = analyzeTrack({
	mono: decoded.mono,
	sampleRate: decoded.sampleRate,
	duration: decoded.duration,
	hash: orig.hash,
	trackId: orig.trackId,
	title: meta.title,
	context,
	beats,
	downbeats
});

if (!existsSync(origPath)) copyFileSync(blobPath, origPath);
writeFileSync(blobPath, JSON.stringify(analysis));
rmSync(showPath, { force: true });

console.log(`staged piecewise grid, downbeatPhase ${analysis.tempo.downbeatPhase}, meterConf ${analysis.tempo.meterConfidence}`);
console.log('sections:', analysis.sections.map((s) => `${s.kind}@${s.startBar}`).join(' '));
const bt = analysis.tempo.barTimes;
for (const t of [...cuts, 14.8, 67.3, 132.8]) {
	let b = 0;
	for (let i = 0; i < bt.length - 1; i++) if (Math.abs(bt[i] - t) < Math.abs(bt[b] - t)) b = i;
	console.log(`  nearest bar line to ${t}s: bar ${b} at ${bt[b].toFixed(2)}s (off ${(bt[b] - t).toFixed(2)}s)`);
}
