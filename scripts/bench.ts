import { readFile } from 'node:fs/promises';
import { DEFAULT_ROOM, EffectRegistry, Mixer, ShowPlayer, buildGeometry, type Show, type TrackAnalysis } from '@mv/core';
import { analysisPath, showPath } from '@mv/analysis';

const id = process.argv[2];
const analysis = JSON.parse(await readFile(analysisPath(id), 'utf8')) as TrackAnalysis;
const show = JSON.parse(await readFile(showPath(id), 'utf8')) as Show;

const g = buildGeometry(DEFAULT_ROOM);
const mixer = new Mixer(g);
const player = new ShowPlayer(mixer, new EffectRegistry());
player.load(analysis, show);

const drop = analysis.sections.find((s) => s.kind === 'drop')!;
const dt = 1 / 60;
const N = 3000;

// Warm up so JIT compilation is not in the measurement.
for (let i = 0; i < 500; i++) mixer.render(player.update(drop.startTime + i * dt, dt));

let t0 = performance.now();
for (let i = 0; i < N; i++) {
	const f = player.update(drop.startTime + i * dt, dt);
	mixer.render(f);
}
const full = performance.now() - t0;

t0 = performance.now();
for (let i = 0; i < N; i++) player.update(drop.startTime + i * dt, dt);
const playerOnly = performance.now() - t0;

console.log(`LEDs: ${g.count}`);
console.log(`player.update      ${(playerOnly / N).toFixed(3)} ms/frame`);
console.log(`+ mixer.render     ${(full / N).toFixed(3)} ms/frame total`);
console.log(`headroom at 60 fps ${(16.67 / (full / N)).toFixed(1)}x  -> max ${(1000 / (full / N)).toFixed(0)} fps`);
