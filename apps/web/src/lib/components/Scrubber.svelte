<script lang="ts">
	import type { Show, TrackAnalysis } from '@mv/core';

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

	let el: HTMLDivElement | undefined = $state();
	let dragging = $state(false);
	let hoverAt = $state<number | null>(null);

	const played = $derived(duration > 0 ? Math.min(1, position / duration) : 0);

	function timeAt(e: PointerEvent | MouseEvent): number {
		if (!el) return 0;
		const rect = el.getBoundingClientRect();
		return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * duration;
	}

	function down(e: PointerEvent) {
		dragging = true;
		el?.setPointerCapture(e.pointerId);
		onseek(timeAt(e));
	}

	function move(e: PointerEvent) {
		hoverAt = timeAt(e);
		if (dragging) onseek(hoverAt);
	}

	function up(e: PointerEvent) {
		dragging = false;
		el?.releasePointerCapture(e.pointerId);
	}

	function clock(t: number): string {
		if (!Number.isFinite(t) || t < 0) return '0:00';
		return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
	}

	function barAt(t: number): number {
		if (!analysis) return 0;
		const g = analysis.tempo;
		const beats = (t - g.firstBeat) / g.beatPeriod;
		return Math.max(0, Math.floor((beats - g.downbeatPhase) / g.beatsPerBar));
	}

	function sectionAt(t: number): string {
		return analysis?.sections.find((s) => t >= s.startTime && t < s.endTime)?.kind ?? '';
	}

	function span(a: number, b: number) {
		if (duration <= 0) return { left: '0%', width: '0%' };
		const l = Math.max(0, Math.min(100, (a / duration) * 100));
		const w = Math.max(0.15, Math.min(100 - l, ((b - a) / duration) * 100));
		return { left: `${l.toFixed(3)}%`, width: `${w.toFixed(3)}%` };
	}
</script>

<div class="scrubber" class:active={dragging}>
	<span class="t mono">{clock(position)}</span>

	<div
		class="track"
		bind:this={el}
		onpointerdown={down}
		onpointermove={move}
		onpointerup={up}
		onpointerleave={() => (hoverAt = null)}
		role="slider"
		tabindex="0"
		aria-label="Seek"
		aria-valuemin={0}
		aria-valuemax={Math.round(duration)}
		aria-valuenow={Math.round(position)}
		onkeydown={(e) => {
			if (e.key === 'ArrowLeft') onseek(Math.max(0, position - 5));
			if (e.key === 'ArrowRight') onseek(Math.min(duration, position + 5));
		}}>
		<!-- The sections ARE the progress bar. There is no separate timeline to consult. -->
		<div class="sections">
			{#each analysis?.sections ?? [] as s (s.index)}
				{@const g = span(s.startTime, s.endTime)}
				<div
					class="sec"
					style:left={g.left}
					style:width={g.width}
					style:background={`var(--sec-${s.kind})`}></div>
			{/each}
		</div>

		{#each show?.hits ?? [] as h, i (i)}
			{@const t = analysis
				? analysis.tempo.firstBeat +
					(analysis.tempo.downbeatPhase + h.bar * analysis.tempo.beatsPerBar) *
						analysis.tempo.beatPeriod
				: 0}
			<div
				class="hit {h.kind}"
				style:left={`${duration > 0 ? ((t / duration) * 100).toFixed(3) : 0}%`}
				title={`${h.kind} at bar ${h.bar}`}></div>
		{/each}

		<div class="veil" style:left={`${(played * 100).toFixed(3)}%`}></div>
		<div class="knob" style:left={`${(played * 100).toFixed(3)}%`}></div>

		{#if hoverAt !== null}
			<div class="tip" style:left={`${((hoverAt / duration) * 100).toFixed(3)}%`}>
				<span class="mono">{clock(hoverAt)}</span>
				{#if analysis}
					<span class="mono faint">bar {barAt(hoverAt)} · {sectionAt(hoverAt)}</span>
				{/if}
			</div>
		{/if}
	</div>

	<span class="t mono faint">{clock(duration - position)}</span>
</div>

<style>
	.scrubber {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
	}
	.t {
		width: 38px;
		flex: none;
		color: var(--dim);
	}
	.t:last-child {
		text-align: right;
	}
	.track {
		position: relative;
		flex: 1;
		height: 16px;
		display: flex;
		align-items: center;
		cursor: pointer;
		touch-action: none;
	}
	.sections {
		position: absolute;
		inset: 0 0;
		top: 50%;
		translate: 0 -50%;
		height: 5px;
		border-radius: 3px;
		overflow: hidden;
		background: var(--surface-3);
		transition: height 0.12s;
	}
	.track:hover .sections,
	.scrubber.active .sections {
		height: 8px;
	}
	.sec {
		position: absolute;
		top: 0;
		bottom: 0;
	}
	/* Dim what has not played yet, rather than drawing a fill over what has: the section
	   colours stay legible ahead of the playhead, which is the point of showing them. */
	.veil {
		position: absolute;
		top: 50%;
		translate: 0 -50%;
		right: 0;
		height: 8px;
		background: #08080ab8;
		border-radius: 0 3px 3px 0;
		pointer-events: none;
	}
	.knob {
		position: absolute;
		top: 50%;
		width: 11px;
		height: 11px;
		border-radius: 50%;
		background: #fff;
		translate: -50% -50%;
		box-shadow: 0 0 0 1px #0009;
		opacity: 0;
		transition: opacity 0.12s;
		pointer-events: none;
	}
	.track:hover .knob,
	.scrubber.active .knob {
		opacity: 1;
	}
	.hit {
		position: absolute;
		top: 50%;
		width: 2px;
		height: 13px;
		translate: -50% -50%;
		pointer-events: none;
		opacity: 0.9;
	}
	.hit.slam {
		background: #fff;
	}
	.hit.strobe {
		background: var(--warn);
	}
	.hit.blackout {
		background: var(--bad);
	}
	.tip {
		position: absolute;
		bottom: 20px;
		translate: -50% 0;
		background: var(--surface-3);
		border: 1px solid var(--line);
		border-radius: var(--r-sm);
		padding: 3px 7px;
		display: flex;
		flex-direction: column;
		gap: 1px;
		white-space: nowrap;
		pointer-events: none;
		box-shadow: 0 6px 18px #0007;
	}
</style>
