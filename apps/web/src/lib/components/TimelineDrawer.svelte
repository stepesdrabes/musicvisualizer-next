<script lang="ts">
	import type { Show, TrackAnalysis } from '@mv/core';
	import type { Viz } from '$lib/viz.svelte.ts';
	import LedBands from './LedBands.svelte';
	import ShowStrip from './ShowStrip.svelte';

	let {
		viz,
		analysis,
		show,
		position,
		duration,
		onseek
	}: {
		viz: Viz | null;
		analysis: TrackAnalysis | null;
		show: Show | null;
		position: number;
		duration: number;
		onseek: (t: number) => void;
	} = $props();
</script>

<div class="drawer floats">
	<LedBands {viz} />
	<ShowStrip {analysis} {show} {position} {duration} {onseek} />
</div>

<style>
	.drawer {
		flex: none;
		background: var(--panel);
		backdrop-filter: var(--panel-blur);
		border-top: 1px solid var(--border);
		animation: open 0.18s cubic-bezier(0.16, 1, 0.3, 1);
	}
	@keyframes open {
		from {
			opacity: 0;
			translate: 0 6px;
		}
	}
</style>
