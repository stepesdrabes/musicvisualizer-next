import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeAudio } from '@mv/analysis';
import { assessMetricalLevel } from '../packages/analysis/src/metricalLevel.ts';
import { extractFeatures } from '../packages/analysis/src/features.ts';
import { measureLoudness } from '../packages/analysis/src/loudness.ts';

/** What the app would offer on each of the tracks a listener has already judged. */
const CACHE = join(import.meta.dirname, '..', 'cache');
const WANT: [string, string][] = [
	['HAQQUDbuudY', 'disputed 105 vs 200'],
	['9lfkYc_eqLE', '88 by ear'],
	['tNHXDNaNqsU', '176 by ear'],
	['Yv2p-ffhj1M', '150 by ear'],
	['jojRxf2qvqs', '120 by ear'],
	['PhdmtUuX7J0', 'undisputed']
];

for (const [id, want] of WANT) {
	// The cache is whatever has been ingested lately, so a judged track may simply not be here.
	if (!existsSync(join(CACHE, `${id}.analysis.json`))) {
		console.log(`${id.padEnd(14)} not cached`);
		continue;
	}
	const a = JSON.parse(
		readFileSync(join(CACHE, `${id}.analysis.json`), 'utf8')
	) as { beats: number[] };
	const audio = await decodeAudio(join(CACHE, `${id}.m4a`));
	const loud = measureLoudness(audio.mono, audio.sampleRate);
	const mono = Float32Array.from(audio.mono);
	const g = Math.min(Math.pow(10, (-14 - loud.integrated) / 20), 40);
	if (Number.isFinite(g)) for (let i = 0; i < mono.length; i++) mono[i] *= g;
	const f = extractFeatures(mono, audio.sampleRate);
	const r = assessMetricalLevel(a.beats, f.odf, f.curves.fps);
	console.log(
		`${id.padEnd(14)} ${r.bpm.toFixed(1).padStart(7)}  ambiguous ${String(r.ambiguous).padEnd(5)} alts ${JSON.stringify(r.alternatives.map(Math.round)).padEnd(26)} | ${want}`
	);
}
