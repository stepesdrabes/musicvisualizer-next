<script lang="ts">
	import type { Show, TrackAnalysis } from '@mv/core';
	import { buildTimeline, densityColumns } from '$lib/timeline.ts';

	let {
		analysis,
		show,
		position,
		duration,
		onseek
	}: {
		analysis: TrackAnalysis | null;
		show: Show | null;
		position: number;
		duration: number;
		onseek: (t: number) => void;
	} = $props();

	let host: HTMLDivElement | undefined = $state();
	let width = $state(0);
	let canvas: HTMLCanvasElement | undefined = $state();
	let tip = $state<{ x: number; title: string; lines: string[] } | null>(null);

	const timeline = $derived(buildTimeline(analysis, show, duration));

	const pct = (t: number) => (duration > 0 ? Math.max(0, Math.min(100, (t / duration) * 100)) : 0);
	const widthPct = (a: number, b: number) => Math.max(0.12, pct(b) - pct(a));

	function clock(t: number): string {
		if (!Number.isFinite(t) || t < 0) return '0:00';
		return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
	}

	function seekFrom(e: PointerEvent) {
		if (!host || duration <= 0) return;
		const rect = host.getBoundingClientRect();
		onseek(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * duration);
	}

	function showTip(e: PointerEvent, title: string, lines: string[]) {
		if (!host) return;
		const rect = host.getBoundingClientRect();
		tip = { x: e.clientX - rect.left, title, lines };
	}

	/**
	 * The drum lane is drawn rather than laid out.
	 *
	 * A four-minute track carries a few thousand onsets, and one element each is tens of
	 * thousands of nodes for a lane eighteen pixels tall. Counting them into one column per
	 * pixel says the same thing - where the kit is busy and where it stops - for a fraction of
	 * the cost, and it is the only lane with nothing worth hovering.
	 */
	$effect(() => {
		const el = canvas;
		const w = width;
		const a = analysis;
		if (!el || w <= 0) return;

		const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
		const h = el.clientHeight || 26;
		el.width = Math.max(1, Math.round(w * dpr));
		el.height = Math.max(1, Math.round(h * dpr));
		const ctx = el.getContext('2d');
		if (!ctx) return;

		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, w, h);
		if (!a || duration <= 0) return;

		const rows: [readonly number[], string][] = [
			[a.onsets.kick.times, '#ff6a1a'],
			[a.onsets.snare.times, '#5aa9ff'],
			[a.onsets.hat.times, '#8f8fa6']
		];
		const rowH = h / rows.length;

		rows.forEach(([times, colour], row) => {
			const counts = densityColumns(times, duration, Math.ceil(w));
			let peak = 1;
			for (const c of counts) if (c > peak) peak = c;

			ctx.fillStyle = colour;
			const top = row * rowH;
			for (let x = 0; x < counts.length; x++) {
				if (counts[x] === 0) continue;
				// Density as opacity, not height: a row six pixels tall has no room for a bar chart.
				ctx.globalAlpha = 0.3 + 0.7 * Math.min(1, counts[x] / peak);
				ctx.fillRect(x, top + 1, 1, Math.max(1, rowH - 2));
			}
		});
		ctx.globalAlpha = 1;
	});

	$effect(() => {
		const el = host;
		if (!el) return;
		const observer = new ResizeObserver(([entry]) => (width = entry.contentRect.width));
		observer.observe(el);
		width = el.getBoundingClientRect().width;
		return () => observer.disconnect();
	});
</script>

<div class="strip" class:empty={!show}>
	<div
		class="lanes"
		bind:this={host}
		onpointerdown={seekFrom}
		onpointerleave={() => (tip = null)}
		role="presentation">
		<div class="lane sections" aria-label="Sections">
			{#each timeline.sections as s (s.index)}
				<div
					class="sec"
					style:left={`${pct(s.start)}%`}
					style:width={`${widthPct(s.start, s.end)}%`}
					style:background={`var(--sec-${s.kind})`}
					onpointerenter={(e) => showTip(e, s.title, s.lines)}
					role="presentation">
					<span class="label">{s.kind}</span>
				</div>
			{/each}
		</div>

		<div class="lane cues" aria-label="Cues">
			{#each timeline.cues as c (c.bar)}
				<div
					class="cue"
					style:left={`${pct(c.start)}%`}
					style:width={`${widthPct(c.start, c.end)}%`}
					style:opacity={0.3 + 0.7 * c.intensity}
					onpointerenter={(e) => showTip(e, c.title, c.lines)}
					role="presentation">
					<span class="label">{c.section}</span>
				</div>
			{/each}
		</div>

		<div class="lane drums" aria-label="Kick, snare and hat density">
			<canvas bind:this={canvas}></canvas>
		</div>

		<div class="lane hits" aria-label="Strobes, blackouts and slams">
			{#each timeline.markers as m, i (i)}
				<div
					class="hit {m.kind}"
					style:left={`${pct(m.start)}%`}
					style:width={`${widthPct(m.start, m.end)}%`}
					onpointerenter={(e) => showTip(e, m.title, m.lines)}
					role="presentation">
					<span class="glyph">{m.kind === 'strobe' ? '⚡' : m.kind === 'blackout' ? '■' : '▲'}</span>
				</div>
			{/each}
		</div>

		<div class="playhead" style:left={`${pct(position)}%`}></div>

		{#if tip}
			<div
				class="tooltip"
				style:left={`${tip.x}px`}
				class:flip={width > 0 && tip.x > width - 180}>
				<strong>{tip.title}</strong>
				{#each tip.lines as line (line)}
					<span>{line}</span>
				{/each}
			</div>
		{/if}
	</div>

	<div class="legend mono faint">
		<span><i class="swatch kick"></i>kick</span>
		<span><i class="swatch snare"></i>snare</span>
		<span><i class="swatch hat"></i>hat</span>
		<span class="sep">·</span>
		<span>⚡ strobe</span>
		<span>■ blackout</span>
		<span>▲ slam</span>
		{#if show}
			<span class="sep">·</span>
			<span>{timeline.cues.length} cues · {timeline.markers.length} hits</span>
			<span class="sep">·</span>
			<span>{clock(position)} / {clock(duration)}</span>
		{/if}
	</div>
</div>

<style>
	.strip {
		border-top: 1px solid var(--line-soft);
		background: var(--surface);
		padding: 8px 12px 9px;
		user-select: none;
	}
	.strip.empty {
		opacity: 0.35;
		pointer-events: none;
	}
	.lanes {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 3px;
		cursor: pointer;
		touch-action: none;
	}
	.lane {
		position: relative;
		width: 100%;
		border-radius: 3px;
		overflow: hidden;
	}
	.sections {
		height: 22px;
		background: var(--surface-2);
	}
	.cues {
		height: 18px;
		background: var(--surface-2);
	}
	.drums {
		height: 26px;
		background: #0b0b0e;
	}
	.hits {
		height: 22px;
		background: var(--surface-2);
		overflow: visible;
	}
	canvas {
		display: block;
		width: 100%;
		height: 26px;
	}

	.sec,
	.cue {
		position: absolute;
		top: 0;
		bottom: 0;
		box-sizing: border-box;
	}
	.sec {
		border-right: 1px solid rgba(0, 0, 0, 0.55);
	}
	.cue {
		background: var(--surface-3);
		border-left: 1px solid var(--dim);
	}
	.sec:hover,
	.cue:hover {
		filter: brightness(1.45);
	}
	.label {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		padding-left: 5px;
		font-size: 10px;
		letter-spacing: 0.02em;
		color: rgba(255, 255, 255, 0.82);
		white-space: nowrap;
		overflow: hidden;
		pointer-events: none;
	}

	.hit {
		position: absolute;
		top: 0;
		bottom: 0;
		min-width: 3px;
		border-radius: 3px;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.hit .glyph {
		font-size: 12px;
		line-height: 1;
		pointer-events: none;
		/* The glyph is a label for the block, so it must not vanish when the block is 2px wide. */
		text-shadow: 0 0 3px #000;
	}
	.hit.strobe {
		background: rgba(255, 214, 92, 0.35);
		box-shadow: inset 0 0 0 1px #ffd65c;
		color: #ffe9a8;
	}
	.hit.blackout {
		background: rgba(120, 120, 140, 0.3);
		box-shadow: inset 0 0 0 1px #7a7a8c;
		color: #c9c9d6;
	}
	.hit.slam {
		background: rgba(255, 106, 26, 0.35);
		box-shadow: inset 0 0 0 1px var(--accent);
		color: #ffc79a;
	}
	.hit:hover {
		filter: brightness(1.5);
	}

	.playhead {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 2px;
		background: var(--text);
		box-shadow: 0 0 4px rgba(255, 255, 255, 0.5);
		pointer-events: none;
	}

	.tooltip {
		position: absolute;
		bottom: calc(100% + 6px);
		transform: translateX(-6px);
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 120px;
		max-width: 300px;
		padding: 7px 9px;
		background: #05050a;
		border: 1px solid var(--line);
		border-radius: 5px;
		font-size: 11.5px;
		line-height: 1.45;
		color: var(--dim);
		white-space: pre-line;
		pointer-events: none;
		z-index: 5;
	}
	.tooltip.flip {
		transform: translateX(calc(-100% + 6px));
	}
	.tooltip strong {
		color: var(--text);
		font-size: 12px;
		font-weight: 600;
	}

	.legend {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-top: 7px;
		font-size: 10.5px;
	}
	.legend span {
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}
	.legend .sep {
		opacity: 0.4;
	}
	.swatch {
		width: 8px;
		height: 8px;
		border-radius: 2px;
	}
	.swatch.kick {
		background: #ff6a1a;
	}
	.swatch.snare {
		background: #5aa9ff;
	}
	.swatch.hat {
		background: #8f8fa6;
	}
</style>
