import { writeFile, readFile } from 'node:fs/promises';
import { buildGeometry, DEFAULT_ROOM, BUILT_IN_EFFECTS, type Cue, type Show, type TrackAnalysis } from '@mv/core';
import { analysisPath, showPath } from '@mv/analysis';
import { lintShow, formatFindings } from '@mv/author';

const id = process.argv[2];
const analysis = JSON.parse(await readFile(analysisPath(id), 'utf8')) as TrackAnalysis;
const at = (k: string) => analysis.sections.find((s) => s.kind === k);
const cues: Cue[] = [{ bar: 0, section: 'intro', layers: { bed: { effect: 'wash' } }, intensity: 0.3, note: 'intro' }];
for (const [kind, layers, extra] of [
  ['groove', { bed: { effect: 'wash' }, rhythm: { effect: 'pump' } }, { intensity: 0.7 }],
  ['breakdown', { bed: { effect: 'wash' }, rhythm: { effect: 'comet' } }, { intensity: 0.5 }],
  ['build', { rhythm: { effect: 'riser' } }, { intensity: 0.8 }],
  ['void', { bed: { effect: 'blackout' } }, { intensity: 0.02, fadeBeats: 0 }],
  ['drop', { bed: { effect: 'wash' }, rhythm: { effect: 'chase' }, transient: { effect: 'shockwave' }, accent: { effect: 'sparkle' } }, { intensity: 1, fadeBeats: 0, palette: 'swap' }],
  ['outro', { bed: { effect: 'wash' } }, { intensity: 0.25 }]
] as const) {
  const s = at(kind); if (!s) continue;
  cues.push({ bar: s.startBar, section: kind as Cue['section'], layers: layers as Cue['layers'], note: kind, ...(extra as object) });
}
const drop = at('drop');
const show: Show = {
  version: 1, trackId: id, title: analysis.title, analysisHash: analysis.hash,
  brief: 'Hand-built reference show for verifying the pipeline.',
  palette: { base: 320, accent: 185, sat: 0.94, shade: 0.08, white: 0.06 },
  defaults: { intensity: 0.8, motion: 1, fadeBeats: 8 },
  generatedEffects: [],
  cues, hits: drop ? [{ bar: drop.startBar, beat: 0, kind: 'slam', beats: 1, note: 'drop' }] : []
};
const verdict = lintShow(show, { analysis, effects: new Map(BUILT_IN_EFFECTS.map((e) => [e.id, e])) });
console.log(formatFindings(verdict));
if (!verdict.ok) process.exit(1);
await writeFile(showPath(id), JSON.stringify(show, null, '\t'));
console.log('wrote', showPath(id));
