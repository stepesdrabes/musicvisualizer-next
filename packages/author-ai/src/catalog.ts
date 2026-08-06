import type { EffectDef, TrackAnalysis } from '@mv/core';
import { BUILT_IN_EFFECTS, LAYER_ROLES, SLOT } from '@mv/core';

/**
 * One line per effect. With forty of them a three-line entry each is a thousand tokens of
 * catalog the author reads on every turn.
 */
export function renderCatalog(effects: readonly EffectDef[] = BUILT_IN_EFFECTS): string {
	const lines: string[] = [];
	for (const role of LAYER_ROLES) {
		const inRole = effects.filter((e) => e.role === role);
		if (inRole.length === 0) continue;
		lines.push(`${role}:`);
		for (const e of inRole) {
			const params = e.params
				.filter((p) => p.key !== 'intensity')
				.map((p) => p.key)
				.join(',');
			lines.push(
				`  ${e.id} (e${e.taste.energy}) ${e.blurb}${params ? `  [${params}]` : ''}${
					e.taste.peakReserved ? '  ONCE' : ''
				}`
			);
		}
	}
	return lines.join('\n');
}

export function renderDslReference(): string {
	return `Available inside a generated effect (no imports; everything below is already in scope):

Math and time
  clamp(v, lo=0, hi=1) · lerp(a, b, t) · frac(v) · smoothstep(e0, e1, v)
  envelope(current, target, dt, tauAttack, tauRelease) - asymmetric follower
  alphaFor(dt, tau) · lerpAngle01(a, b, t) - shortest arc on a 0..1 circle

Waveforms and noise
  sinewave(v) · triwave(v) · pulse(phase, falloff=6) - hard edge, exponential tail
  noise3(x, y, z) -> 0..1 improved Perlin

Determinism (never use Math.random; the gate rejects it)
  new Rng(seed) -> .float() .int(n) .range(lo, hi) · hash01(k) - stateless per-index

Envelopes
  new PulseEnv() -> .fire(strength) .decay(dt, beatPeriod, beats) .reset()
  new FlashEnvelope(hold, releaseTau) -> .fire(s) .update(dt) .reset()
  new Schmitt(lo, hi) -> .update(v) · ratchet(current, target, dt, riseTau)

Buffers (out is length g.count*3, RGB interleaved, persistent across frames)
  fadeToBlack(buf, dt, tau) - never clear, always decay
  nblend(dst, src, amount) · scaleBuf(buf, k) · fillSolid(buf, count, [r,g,b])
  setPixel/addPixel(buf, i, r, g, b) · addPixelF(buf, pos, n, r, g, b, wrap) - sub-pixel
  stampGaussian(buf, n, centre, sigma, r, g, b, wrap, lo, hi) - PASS lo/hi when stamping
    into the global buffer, or a blob near one strip's end bleeds onto an unrelated strip
  stampOnStrip(buf, count, strip, pos, sigma, [r,g,b]) - the same, already clipped
  blur1d(buf, n, amount, wrap)

Colour (address by slot, never by hue)
  SLOT = { ${Object.entries(SLOT)
			.map(([k, v]) => `${k}: ${v}`)
			.join(', ')} }
  sample(palette, u, brightness) -> [r,g,b] · setSample(buf, i, palette, u, brightness)
  addSample(buf, i, palette, u, brightness)

Space
  ringU(g, i) - one LED's position around the perimeter, or along the beam
  ringsFor(g) -> { perimeter, perimeterHalf, beam, all }; each has .map, .length, .metres
  scatter(ring, src, dst) · scatterAdd · scatterMirrored(full, half, src, dst)
  pxPerSecond(ring, metresPerSecond)
  computeU(out, g, projection, angle) with projection one of
    'perimeter' 'radial' 'height' 'sweep' 'pinwheel' 'local' 'index' 'dist'
  paint(dst, g, u, src, srcLen, add) - lay a 1-D pattern across the room via any projection

Geometry (g)
  g.count · g.strips[] (id, name, offset, count, start, end, normal, inPerimeter)
  g.x/y/z (metres) · g.nx/ny/nz (0..1, one shared divisor) · g.r · g.theta · g.dist
  g.strip[i] · g.local[i] · g.perim[i] (-1 off-perimeter) · g.pitch · g.extent

Frame (ctx.f)
  t dt · beat downbeat phraseStart · beatIndex barIndex · beatPhase barPhase phrasePhase
  beatPeriod bpm · section sectionProgress buildProgress timeToDrop timeSinceDrop
  energy · bands[0..3] = sub low mid air
  pan (-1 left .. +1 right) · panWidth (0 mono .. 1 fully decorrelated)
    Where the mix is sitting across the room, from the stereo file. Use it to BIAS a position
    an effect is already choosing, multiplied by panWidth so a mono passage does not move:
    a chopped vocal flicked hard left and right every sixteenth is invisible to every other
    field here, because the sum of the two channels does not move at all.
  kick snare hat (booleans, one frame) · kickEnv snareEnv hatEnv (use these for brightness)

Also on ctx: g, p (your params), palette, hueShift, motion (multiply your speeds by it).`;
}

/** A monospace shape of the arrangement. Cheap, and it reads at a glance. */
export function renderArrangementChart(analysis: TrackAnalysis, width = 60): string {
	const lines: string[] = [];
	const bars = analysis.bars;
	const step = Math.max(1, Math.ceil(bars.length / width));
	const glyphs = ' .:-=+*#%@';

	lines.push('energy, one column per ' + (step === 1 ? 'bar' : `${step} bars`) + ':');
	let row = '';
	for (let i = 0; i < bars.length; i += step) {
		let peak = 0;
		for (let k = i; k < Math.min(bars.length, i + step); k++) {
			if (bars[k].energy > peak) peak = bars[k].energy;
		}
		row += glyphs[Math.min(glyphs.length - 1, Math.floor((peak / 100) * (glyphs.length - 1)))];
	}
	lines.push(`  ${row}`);

	let ruler = '';
	let labels = '';
	for (let i = 0; i < bars.length; i += step) {
		const onLabel = Math.floor(i / step) % 8 === 0;
		ruler += onLabel ? '|' : ' ';
		if (onLabel) {
			const text = String(i);
			labels += text;
			for (let k = 1; k < 8 - text.length + 1; k++) labels += ' ';
		}
	}
	lines.push(`  ${ruler}`);
	lines.push(`  ${labels.slice(0, row.length + 8)}`);

	lines.push('');
	lines.push('sections:');
	for (const s of analysis.sections) {
		lines.push(
			`  ${String(s.index).padStart(2)} ${s.kind.padEnd(10)} bars ${String(s.startBar).padStart(3)}-${String(
				s.endBar
			).padStart(3)} (${String(s.lengthBars).padStart(2)}) mean ${String(s.meanEnergy).padStart(3)} peak ${String(
				s.peakEnergy
			).padStart(3)} rank ${s.energyRank}${s.repeatOf !== null ? ` repeats §${s.repeatOf}` : ''}`
		);
	}
	return lines.join('\n');
}

export function renderBarTable(analysis: TrackAnalysis, from = 0, to = Infinity): string {
	const rows = analysis.bars.filter((b) => b.bar >= from && b.bar <= to);
	const lines = ['bar\tt\tsection\tenergy\tsub\tlow\tmid\tair\tkicks\tsnares\thats\tevents'];
	for (const b of rows) {
		lines.push(
			[
				b.bar,
				b.t.toFixed(2),
				b.section,
				b.energy,
				b.sub,
				b.low,
				b.mid,
				b.air,
				b.kicks,
				b.snares,
				b.hats,
				b.events.join('|')
			].join('\t')
		);
	}
	return lines.join('\n');
}

export function renderHeader(analysis: TrackAnalysis): string {
	const t = analysis.tempo;
	const squashed =
		analysis.peakToLoudness < 8
			? '   <- heavily limited: per-bar level barely moves, so take the dynamics from onset density and arrangement rather than from energy alone'
			: '';
	return [
		`title: ${analysis.title}`,
		`trackId: ${analysis.trackId}`,
		`analysisHash: ${analysis.hash}   <- copy this into the show verbatim`,
		`duration: ${analysis.duration.toFixed(1)} s`,
		`bpm: ${t.bpm} (confidence ${t.confidence.toFixed(2)}${t.constant ? '' : ', tempo drifts: bar times in the table are the authority'})`,
		`beatsPerBar: ${t.beatsPerBar} (confidence ${t.meterConfidence.toFixed(2)})   barsPerPhrase: ${t.barsPerPhrase}   phraseAnchorBar: ${t.phraseAnchorBar}`,
		`key: ${analysis.key.name} (confidence ${analysis.key.confidence.toFixed(2)})`,
		`bars: 0-${analysis.bars.length - 1}`,
		`integratedLufs: ${analysis.integratedLufs}   loudnessRange: ${analysis.loudnessRange} LU   peakToLoudness: ${analysis.peakToLoudness} LU${squashed}`
	].join('\n');
}

export function renderMoments(analysis: TrackAnalysis): string {
	return analysis.moments
		.map((m) => `bar ${String(m.bar).padStart(3)} · ${m.kind.padEnd(14)} · ${m.note}`)
		.join('\n');
}
