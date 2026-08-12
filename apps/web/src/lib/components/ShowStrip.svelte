<script lang="ts">
	import { untrack } from 'svelte';
	import type { Show, TrackAnalysis } from '@mv/core';
	import {
		FULL_WINDOW,
		buildTimeline,
		densityColumns,
		follow,
		fractionAt,
		fractionIn,
		isFullWindow,
		panBy,
		windowSpan,
		zoomAt,
		type TimeWindow
	} from '$lib/timeline.ts';
	import { clock, titleCase } from '$lib/format.ts';
	import Icon from '$lib/ui/Icon.svelte';

	let {
		analysis,
		show,
		position,
		duration,
		view = $bindable(FULL_WINDOW),
		onseek
	}: {
		analysis: TrackAnalysis | null;
		show: Show | null;
		position: number;
		duration: number;
		/** Bound, because the scrubber above draws the same range and the drawer unmounts. */
		view?: TimeWindow;
		onseek: (t: number) => void;
	} = $props();

	let host: HTMLDivElement | undefined = $state();
	let width = $state(0);
	let canvas: HTMLCanvasElement | undefined = $state();
	let tip = $state<{ x: number; title: string; lines: string[] } | null>(null);

	/** Suppresses the auto-follow for a moment after a manual pan, so a drag is not fought. */
	let heldUntil = 0;

	const timeline = $derived(buildTimeline(analysis, show, duration));

	/**
	 * Four bars, which is the closest a zoom gets.
	 *
	 * A floor in bars rather than in seconds, because the useful limit is "one phrase and its
	 * approach" on every track, and that is four seconds at 240 bpm and sixteen at 60.
	 */
	const minSpan = $derived.by(() => {
		if (!analysis || duration <= 0) return 0.02;
		const bar = analysis.tempo.beatPeriod * analysis.tempo.beatsPerBar;
		return Math.min(1, (4 * bar) / duration);
	});

	const pct = (t: number) =>
		duration > 0 ? Math.max(-20, Math.min(120, fractionIn(view, t / duration) * 100)) : 0;
	// A span that starts before the window still has to end where it does, so both ends are
	// mapped and the width taken from the difference rather than from the span's own length.
	const widthPct = (a: number, b: number) => Math.max(0.12, pct(b) - pct(a));

	function across(e: { clientX: number }): number {
		if (!host) return 0;
		const rect = host.getBoundingClientRect();
		return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
	}

	function seekFrom(e: PointerEvent) {
		if (!host || duration <= 0) return;
		onseek(fractionAt(view, across(e)) * duration);
	}

	/**
	 * Vertical for zoom, horizontal for pan.
	 *
	 * That is what a trackpad already sends for pinch and for a two-finger swipe, and the drawer
	 * has nothing else a scroll could mean. Non-passive because zooming has to stop the gesture
	 * reaching whatever is behind it.
	 */
	function wheel(el: HTMLElement) {
		const onWheel = (e: WheelEvent) => {
			if (duration <= 0) return;
			e.preventDefault();
			heldUntil = performance.now() + 2500;
			if (!e.ctrlKey && Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
				view = panBy(view, (e.deltaX / (el.clientWidth || 1)) * windowSpan(view));
				return;
			}
			view = zoomAt(view, fractionAt(view, across(e)), Math.exp(e.deltaY * 0.004), minSpan);
		};
		el.addEventListener('wheel', onWheel, { passive: false });
		return () => el.removeEventListener('wheel', onWheel);
	}

	function reset() {
		view = FULL_WINDOW;
	}

	/**
	 * The playhead pulls the window along once it has left it, unless a pan just happened.
	 *
	 * Untracked on purpose: this runs when the playhead moves, not when the window does. Reading
	 * `view` as a dependency here would make the effect its own trigger.
	 */
	$effect(() => {
		const at = duration > 0 ? position / duration : 0;
		untrack(() => {
			if (isFullWindow(view) || performance.now() < heldUntil) return;
			view = follow(view, at);
		});
	});

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
		const range = view;
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
			const counts = densityColumns(times, duration, Math.ceil(w), range);
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
		{@attach wheel}
		onpointerdown={seekFrom}
		ondblclick={reset}
		onpointerleave={() => (tip = null)}
		role="presentation">
		<div class="lane sections" aria-label="Sections">
			{#each timeline.sections as s (s.index)}
				<div
					class="sec"
					style:left={`${pct(s.start)}%`}
					style:width={`${widthPct(s.start, s.end)}%`}
					style:background={`var(--sec-${s.kind})`}
					onpointerenter={(e) => showTip(e, titleCase(s.title), s.lines)}
					role="presentation">
					<span class="label">{titleCase(s.kind)}</span>
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
					<span class="label">{titleCase(c.section)}</span>
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
					onpointerenter={(e) => showTip(e, titleCase(m.title), m.lines)}
					role="presentation">
					<span class="glyph">{m.kind === 'strobe' ? '⚡' : m.kind === 'blackout' ? '■' : '▲'}</span>
				</div>
			{/each}
		</div>

		<!-- Only while it is in view. `.lanes` does not clip, because the tooltip rises out of it. -->
		{#if duration > 0 && fractionIn(view, position / duration) >= 0 && fractionIn(view, position / duration) <= 1}
			<div class="playhead" style:left={`${pct(position)}%`}></div>
		{/if}

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

	<div class="legend subtle">
		<span><i class="swatch kick"></i>Kick</span>
		<span><i class="swatch snare"></i>Snare</span>
		<span><i class="swatch hat"></i>Hat</span>
		<span class="sep">·</span>
		<span>⚡ Strobe</span>
		<span>■ Blackout</span>
		<span>▲ Slam</span>
		<span class="spacer"></span>
		{#if !isFullWindow(view)}
			<!-- Only while there is something to say: at full width the range is the track. -->
			<button class="zoom" onclick={reset} title="Show the whole track">
				<Icon name="search" size={12} />
				<span class="mono">
					{clock(view.start * duration)}-{clock(view.end * duration)}
				</span>
			</button>
			<span class="sep">·</span>
		{/if}
		{#if show}
			<span class="mono">{timeline.cues.length} cues · {timeline.markers.length} hits</span>
			<span class="sep">·</span>
			<span class="mono">{clock(position)} / {clock(duration)}</span>
		{/if}
	</div>
</div>

<style>
	.strip {
		padding: 4px 14px 12px;
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
		border-radius: var(--radius-sm);
		overflow: hidden;
	}
	.sections {
		height: 24px;
		background: var(--muted);
	}
	.cues {
		height: 20px;
		background: var(--muted);
	}
	.drums {
		height: 26px;
		background: #08080b;
	}
	.hits {
		height: 24px;
		background: var(--muted);
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
		border-right: 1px solid #00000091;
	}
	/* The divider between cues is drawn as a full inset rule rather than a coloured left edge,
	   so a one-bar cue reads as a block rather than as a stripe. */
	.cue {
		background: var(--card-raised);
		box-shadow: inset 1px 0 0 #ffffff2e;
	}
	.sec:hover,
	.cue:hover {
		filter: brightness(1.4);
	}
	.label {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		padding-left: 7px;
		font-size: 11px;
		font-weight: 500;
		color: #ffffffd6;
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
		background: #fbbf2445;
		box-shadow: inset 0 0 0 1px var(--warn);
		color: #ffe9a8;
	}
	.hit.blackout {
		background: #78788c45;
		box-shadow: inset 0 0 0 1px #7a7a8c;
		color: #c9c9d6;
	}
	.hit.slam,
	.hit.bump {
		background: #ff6a1a45;
		box-shadow: inset 0 0 0 1px var(--live);
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
		background: var(--foreground);
		box-shadow: 0 0 5px #ffffff80;
		pointer-events: none;
	}

	.tooltip {
		position: absolute;
		bottom: calc(100% + 8px);
		transform: translateX(-6px);
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 130px;
		max-width: 300px;
		padding: 9px 11px;
		background: var(--popover);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		font-size: 12px;
		line-height: 1.5;
		color: var(--muted-foreground);
		white-space: pre-line;
		pointer-events: none;
		box-shadow: var(--shadow-md);
		z-index: 5;
	}
	.tooltip.flip {
		transform: translateX(calc(-100% + 6px));
	}
	.tooltip strong {
		color: var(--foreground);
		font-size: 12.5px;
		font-weight: 600;
	}

	.legend {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-top: 10px;
		font-size: 11.5px;
	}
	.legend span {
		display: inline-flex;
		align-items: center;
		gap: 5px;
	}
	.legend .sep {
		opacity: 0.4;
	}
	.legend .spacer {
		flex: 1;
	}
	.zoom {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 2px 7px;
		border-radius: var(--radius-sm);
		background: var(--muted);
		font-size: 11.5px;
		color: var(--muted-foreground);
	}
	.zoom:hover {
		background: var(--hover);
		color: var(--foreground);
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
