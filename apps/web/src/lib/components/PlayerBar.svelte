<script lang="ts">
	import type { Show, TrackAnalysis } from '@mv/core';
	import type { TrackMeta } from '$lib/types.ts';
	import type { Readout } from '$lib/viz.svelte.ts';
	import Scrubber from './Scrubber.svelte';

	let {
		meta,
		analysis,
		show,
		readout,
		volume = $bindable(0.8),
		ontoggle,
		onseek,
		onstep
	}: {
		meta: TrackMeta | null;
		analysis: TrackAnalysis | null;
		show: Show | null;
		readout: Readout;
		volume?: number;
		ontoggle: () => void;
		onseek: (t: number) => void;
		onstep: (dir: -1 | 1) => void;
	} = $props();

	const ready = $derived(readout.duration > 0);

	// Placeholder art for local files: the show's own two hues, so it still says something.
	const artGradient = $derived(
		show
			? `linear-gradient(135deg, hsl(${show.palette.base} 82% 46%), hsl(${show.palette.accent} 82% 42%))`
			: 'linear-gradient(135deg, #23232b, #14141a)'
	);
</script>

<div class="player">
	<div class="now">
		<div class="art" style:background={artGradient}>
			{#if meta?.thumbnail}
				<img src={meta.thumbnail} alt="" />
			{/if}
		</div>
		<div class="meta">
			<span class="title" title={meta?.title ?? ''}>{meta?.title ?? 'Nothing loaded'}</span>
			<span class="sub dim">
				{#if meta}
					{meta.uploader}
					{#if analysis}
						<span class="faint">·</span> {analysis.tempo.bpm.toFixed(0)} bpm
					{/if}
				{:else}
					Paste a YouTube link above
				{/if}
			</span>
		</div>
	</div>

	<div class="controls">
		<div class="buttons">
			<button
				class="step"
				onclick={() => onstep(-1)}
				disabled={!ready}
				title="Previous section"
				aria-label="Previous section">
				<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
					<path d="M4 2h2v12H4zM14 2.5v11L6.5 8z" />
				</svg>
			</button>

			<button class="play" onclick={ontoggle} disabled={!ready} aria-label="Play or pause">
				{#if readout.playing}
					<svg viewBox="0 0 16 16" width="17" height="17" fill="currentColor">
						<path d="M3.5 2h3.2v12H3.5zM9.3 2h3.2v12H9.3z" />
					</svg>
				{:else}
					<svg viewBox="0 0 16 16" width="17" height="17" fill="currentColor">
						<path d="M4.5 2.2v11.6L13.5 8z" />
					</svg>
				{/if}
			</button>

			<button
				class="step"
				onclick={() => onstep(1)}
				disabled={!ready}
				title="Next section"
				aria-label="Next section">
				<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
					<path d="M10 2h2v12h-2zM2 2.5v11L9.5 8z" />
				</svg>
			</button>
		</div>

		<Scrubber {analysis} {show} position={readout.position} duration={readout.duration} {onseek} />
	</div>

	<div class="right">
		{#if ready}
			<span class="pill" style:background={`var(--sec-${readout.section})`}>{readout.section}</span>
			<span class="mono faint">bar {readout.bar}</span>
		{/if}
		<label class="vol" title="Volume">
			<svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" class="dim">
				<path d="M8 2 4.5 5H2v6h2.5L8 14zM11 5.6a3.4 3.4 0 0 1 0 4.8l.9.9a4.7 4.7 0 0 0 0-6.6z" />
			</svg>
			<input type="range" min="0" max="1" step="0.01" bind:value={volume} aria-label="Volume" />
		</label>
	</div>
</div>

<style>
	.player {
		display: grid;
		grid-template-columns: minmax(180px, 1fr) minmax(340px, 2.1fr) minmax(180px, 1fr);
		align-items: center;
		gap: 16px;
		padding: 10px 16px 12px;
		background: var(--surface);
		border-top: 1px solid var(--line);
	}

	.now {
		display: flex;
		align-items: center;
		gap: 11px;
		min-width: 0;
	}
	.art {
		width: 46px;
		height: 46px;
		flex: none;
		border-radius: var(--r-md);
		overflow: hidden;
		box-shadow: 0 2px 10px #0008;
	}
	.art img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	.meta {
		display: flex;
		flex-direction: column;
		min-width: 0;
		gap: 1px;
	}
	.title {
		font-weight: 600;
		font-size: 13px;
		letter-spacing: -0.01em;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.sub {
		font-size: 11.5px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.controls {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 5px;
		min-width: 0;
	}
	.buttons {
		display: flex;
		align-items: center;
		gap: 16px;
	}
	.step {
		color: var(--dim);
		display: grid;
		place-items: center;
		transition:
			color 0.12s,
			transform 0.08s;
	}
	.step:hover:not(:disabled) {
		color: var(--text);
	}
	.step:active:not(:disabled) {
		transform: scale(0.9);
	}
	.step:disabled {
		opacity: 0.3;
	}
	.play {
		width: 34px;
		height: 34px;
		border-radius: 50%;
		background: var(--text);
		color: #0b0b0e;
		display: grid;
		place-items: center;
		transition:
			transform 0.1s,
			background 0.12s;
	}
	.play:hover:not(:disabled) {
		background: #fff;
		transform: scale(1.06);
	}
	.play:active:not(:disabled) {
		transform: scale(0.97);
	}
	.play:disabled {
		background: var(--surface-3);
		color: var(--faint);
	}

	.right {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 10px;
		min-width: 0;
	}
	.pill {
		font-family: var(--mono);
		font-size: 9.5px;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: #00000099;
		padding: 2px 7px;
		border-radius: 999px;
	}
	.vol {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.vol input {
		width: 82px;
		accent-color: var(--text);
	}
</style>
