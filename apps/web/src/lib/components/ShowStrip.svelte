<script lang="ts">
	import { untrack } from 'svelte';
	import { SECTION_KINDS, barAtTime, barTimeAt, type Show, type TrackAnalysis } from '@mv/core';
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
	import type { JudgedSection } from '$lib/types.ts';
	import Icon from '$lib/ui/Icon.svelte';

	let {
		analysis,
		show,
		position,
		duration,
		view = $bindable(FULL_WINDOW),
		onseek,
		editing = false,
		sections = null,
		onsections = () => {}
	}: {
		analysis: TrackAnalysis | null;
		show: Show | null;
		position: number;
		duration: number;
		/** Bound, because the scrubber above draws the same range and the drawer unmounts. */
		view?: TimeWindow;
		onseek: (t: number) => void;
		/** Section editing: the lane grows handles and the draft below replaces the analysis. */
		editing?: boolean;
		/** The hand-drawn draft being edited; owned by the page, committed via onsections. */
		sections?: JudgedSection[] | null;
		onsections?: (s: JudgedSection[]) => void;
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

	// ---- Section editing ------------------------------------------------------------------
	// The draft is owned by the page; a gesture works on local state for smoothness and
	// commits once on release, so each drag is one save rather than a stream of them.

	let drag = $state<{ boundary: number; t: number } | null>(null);
	let picker = $state<{ index: number; x: number } | null>(null);

	/**
	 * Snap to BAR lines, which is the only coordinate a section has.
	 *
	 * This used to snap to beats, on the reasoning that a hand mark should land where the
	 * hand put it. But every consumer addresses sections by whole bars - the adoption, the
	 * preview, every cue - so a boundary drawn between two bar lines is one the engine
	 * cannot keep: it rounds, and the arrangement then disagrees with the map on screen by
	 * up to half a bar. Sixteen boundaries on one judged track, six of them off a bar line,
	 * one by two whole bars. Snapping here is what makes the drawn line the heard line.
	 */
	function snapT(t: number, fine = false): number {
		const tempo = analysis?.tempo;
		if (!tempo) return t;
		const bars = barAtTime(tempo, t);
		// Shift drops to the beat grid, for the case bars cannot express: the ear hears the
		// change between two bar lines, which is a statement about the GRID rather than about
		// the section. The mark is kept where it was put; the adoption still rounds it onto a
		// bar, and the durable answer to a grid that disagrees with the ear is a movement mark
		// or a listener cut, both of which move the bar lines themselves.
		if (fine) return barTimeAt(tempo, Math.round(bars * tempo.beatsPerBar) / tempo.beatsPerBar);
		return barTimeAt(tempo, Math.round(bars));
	}

	/** A section cannot be shorter than the bar it is addressed in. */
	const barLen = $derived(
		analysis ? analysis.tempo.beatPeriod * analysis.tempo.beatsPerBar : 1
	);
	const beatLen = $derived(analysis ? analysis.tempo.beatPeriod : 0.25);

	function timeFrom(e: { clientX: number }): number {
		return fractionAt(view, across(e)) * duration;
	}

	function withBars(s: JudgedSection): JudgedSection {
		const tempo = analysis?.tempo;
		// Fractional, because a shift-drag is allowed to sit between bar lines and the stored
		// bar is what a mining session reads. Rounding it here would report a boundary as
		// being on a bar line it was deliberately placed off.
		const bar = (t: number) => (tempo ? Math.round(barAtTime(tempo, t) * 1000) / 1000 : 0);
		// The plain drag snaps to bar lines, so a start that is off one was placed there with
		// the fine drag - a statement that the bar line belongs at the mark. Recorded here
		// rather than inferred later, because maps drawn before the editor snapped to bars are
		// full of beat-snapped boundaries that meant no such thing.
		const offBar = tempo ? Math.abs(bar(s.startTime) - Math.round(bar(s.startTime))) > 0.001 : false;
		return {
			...s,
			startBar: bar(s.startTime),
			endBar: bar(s.endTime),
			...(offBar ? { offGrid: true } : {})
		};
	}

	function commit(next: JudgedSection[]) {
		onsections(next.map(withBars));
	}

	function handleDown(e: PointerEvent, boundary: number) {
		if (!sections) return;
		e.stopPropagation();
		if (e.altKey) {
			// Merge: the seam disappears and the left section absorbs the right one's span.
			const next = sections.map((s) => ({ ...s }));
			next[boundary - 1].endTime = next[boundary].endTime;
			next.splice(boundary, 1);
			commit(next);
			return;
		}
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		drag = { boundary, t: sections[boundary].startTime };
	}

	function handleMove(e: PointerEvent) {
		if (!drag || !sections) return;
		const step = e.shiftKey ? beatLen : barLen;
		const lo = sections[drag.boundary - 1].startTime + step;
		const hi = sections[drag.boundary].endTime - step;
		// Snapped AFTER the clamp: clamping a snapped value pushes it back off the grid, by
		// however much the local bar differs from the median one.
		const t = snapT(Math.max(lo, Math.min(hi, timeFrom(e))), e.shiftKey);
		drag = { boundary: drag.boundary, t };
	}

	function handleUp(e: PointerEvent) {
		if (!drag || !sections) return;
		(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
		const next = sections.map((s) => ({ ...s }));
		next[drag.boundary - 1].endTime = drag.t;
		next[drag.boundary].startTime = drag.t;
		drag = null;
		commit(next);
	}

	function split(e: MouseEvent, index: number) {
		if (!sections) return;
		e.stopPropagation();
		const s = sections[index];
		const t = snapT(timeFrom(e), e.shiftKey);
		const step = e.shiftKey ? beatLen : barLen;
		if (t < s.startTime + step || t > s.endTime - step) return;
		const next = sections.map((x) => ({ ...x }));
		next.splice(index + 1, 0, { ...next[index], startTime: t });
		next[index] = { ...next[index], endTime: t };
		commit(next);
	}

	function pickKind(index: number, kind: string) {
		if (!sections) return;
		const next = sections.map((s, i) => (i === index ? { ...s, kind } : { ...s }));
		picker = null;
		commit(next);
	}

	/** The seam positions being rendered: the dragged one follows the pointer. */
	function boundaryTime(i: number): number {
		if (!sections) return 0;
		return drag && drag.boundary === i ? drag.t : sections[i].startTime;
	}

	function editStart(i: number): number {
		if (!sections) return 0;
		return i === 0 ? sections[0].startTime : boundaryTime(i);
	}

	function editEnd(i: number): number {
		if (!sections) return 0;
		return i === sections.length - 1 ? sections[i].endTime : boundaryTime(i + 1);
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
		{#if editing && sections}
			<div class="lane sections editing" aria-label="Sections, adjustable">
				{#each sections as s, i (i)}
					<div
						class="sec"
						style:left={`${pct(editStart(i))}%`}
						style:width={`${widthPct(editStart(i), editEnd(i))}%`}
						style:background={`var(--sec-${s.kind})`}
						onpointerdown={(e) => e.stopPropagation()}
						onclick={(e) => {
							e.stopPropagation();
							picker = picker?.index === i ? null : { index: i, x: e.clientX - (host?.getBoundingClientRect().left ?? 0) };
						}}
						ondblclick={(e) => split(e, i)}
						role="presentation">
						<span class="label">{titleCase(s.kind)}</span>
					</div>
				{/each}
				{#each sections as s, i (i)}
					{#if i > 0}
						<div
							class="handle"
							class:held={drag?.boundary === i}
							style:left={`${pct(boundaryTime(i))}%`}
							title="Drag to move the boundary. Alt-click merges the two sections."
							onpointerdown={(e) => handleDown(e, i)}
							onpointermove={handleMove}
							onpointerup={handleUp}
							role="presentation">
						</div>
					{/if}
				{/each}
			</div>
		{:else}
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
		{/if}

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

		{#if picker && sections}
			<div
				class="picker"
				style:left={`${picker.x}px`}
				class:flip={width > 0 && picker.x > width - 180}
				onpointerdown={(e) => e.stopPropagation()}
				role="presentation">
				{#each SECTION_KINDS as kind (kind)}
					<button
						class="kind"
						class:on={sections[picker.index]?.kind === kind}
						onclick={() => picker && pickKind(picker.index, kind)}>
						<i class="swatch" style:background={`var(--sec-${kind})`}></i>
						{titleCase(kind)}
					</button>
				{/each}
			</div>
		{/if}
	</div>

	<div class="legend subtle">
		{#if editing}
			<span>drag a boundary · double-click splits · alt-click a handle merges · click a section for its kind</span>
			<span class="sep">·</span>
		{/if}
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

	/* Handles rise above the lane, so the lane must not clip while editing (the .hits precedent). */
	.sections.editing {
		overflow: visible;
	}
	.sections.editing .sec {
		cursor: pointer;
	}
	.handle {
		position: absolute;
		top: -3px;
		bottom: -3px;
		width: 9px;
		transform: translateX(-50%);
		cursor: col-resize;
		z-index: 3;
	}
	.handle::after {
		content: '';
		position: absolute;
		inset: 0 3px;
		border-radius: 2px;
		background: var(--foreground);
		opacity: 0.55;
	}
	.handle:hover::after,
	.handle.held::after {
		opacity: 1;
		box-shadow: 0 0 5px #ffffff80;
	}

	.picker {
		position: absolute;
		bottom: calc(100% + 8px);
		transform: translateX(-6px);
		display: flex;
		flex-direction: column;
		gap: 1px;
		padding: 5px;
		background: var(--popover);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		box-shadow: var(--shadow-md);
		z-index: 6;
	}
	.picker.flip {
		transform: translateX(calc(-100% + 6px));
	}
	.kind {
		display: flex;
		align-items: center;
		gap: 7px;
		padding: 4px 9px;
		border-radius: var(--radius-sm);
		font-size: 12px;
		color: var(--muted-foreground);
		text-align: left;
	}
	.kind:hover {
		background: var(--hover);
		color: var(--foreground);
	}
	.kind.on {
		color: var(--foreground);
		background: var(--muted);
	}
	.kind .swatch {
		width: 9px;
		height: 9px;
		border-radius: 2px;
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
