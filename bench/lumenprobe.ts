import {
	BUILT_IN_EFFECTS,
	DEFAULT_ROOM,
	buildGeometry,
	makePalette,
	scriptFrames,
	type EffectDef,
	type RenderCtx
} from '@mv/core';

/**
 * How much light each effect actually puts in the room, and what byte that becomes.
 *
 * The gate calls an effect lit if one pixel ever exceeds 0.001, which an invisible effect
 * passes trivially. Gamma is where it matters: `quantize` raises the authoring value to the
 * power 2.2, so anything under 0.08 is byte 0 and anything under 0.21 is under byte 8. A bed
 * that renders 0.05 and is the only layer in its cue is not dim, it is off.
 */
const geometry = buildGeometry(DEFAULT_ROOM);
const frames = scriptFrames();

/** What the mixer does to a layer before quantising: cue intensity, then the exposure headroom. */
const CUE_INTENSITY = 0.4;
const HEADROOM = 1.4;

function meanOf(def: EffectDef, section: string): number {
	const effect = def.create(geometry);
	const p: Record<string, number> = {};
	for (const spec of def.params) p[spec.key] = spec.default;
	if ('trigger' in p) p.trigger = 1;
	const ctx: RenderCtx = {
		g: geometry,
		f: frames[0],
		p,
		palette: makePalette({ base: 320, accent: 185 }),
		hueShift: 0,
		motion: 1
	};
	const out = new Float32Array(geometry.count * 3);
	let acc = 0;
	let n = 0;
	for (const f of frames) {
		ctx.f = f;
		effect.render(out, ctx);
		if (f.section !== section) continue;
		let sum = 0;
		for (let i = 0; i < out.length; i += 3) sum += Math.max(out[i], out[i + 1], out[i + 2]);
		acc += sum / (out.length / 3);
		n++;
	}
	return n > 0 ? acc / n : 0;
}

const byteAt = (v: number) => Math.round(Math.pow(Math.min(1, v * CUE_INTENSITY * HEADROOM), 2.2) * 255);

const rows = BUILT_IN_EFFECTS.map((def) => {
	const groove = meanOf(def, 'groove');
	const drop = meanOf(def, 'drop');
	return { def, groove, drop, byte: byteAt(groove) };
}).sort((a, b) => a.groove - b.groove);

console.log(
	`${'effect'.padEnd(20)}${'role'.padEnd(11)}${'groove'.padStart(8)}${'drop'.padStart(8)}${'byte@0.4'.padStart(10)}`
);
for (const r of rows) {
	console.log(
		`${r.def.id.padEnd(20)}${r.def.role.padEnd(11)}${r.groove.toFixed(3).padStart(8)}${r.drop.toFixed(3).padStart(8)}${String(r.byte).padStart(10)}`
	);
}

const beds = rows.filter((r) => r.def.role === 'bed' && r.def.id !== 'blackout');
console.log(
	`\nbeds excluding blackout: min ${beds[0].def.id} ${beds[0].groove.toFixed(3)}, median ${beds[beds.length >> 1].groove.toFixed(3)}, max ${beds[beds.length - 1].groove.toFixed(3)}`
);
console.log(`authoring value needed for byte 1: ${Math.pow(1 / 255, 1 / 2.2).toFixed(3)}`);
console.log(`... for byte 8:  ${Math.pow(8 / 255, 1 / 2.2).toFixed(3)}`);
console.log(`... for byte 40: ${Math.pow(40 / 255, 1 / 2.2).toFixed(3)}`);
