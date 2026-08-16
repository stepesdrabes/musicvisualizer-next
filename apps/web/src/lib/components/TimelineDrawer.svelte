<script lang="ts">
	import type { Show, TrackAnalysis } from '@mv/core';
	import type { Viz } from '$lib/viz.svelte.ts';
	import type { JudgedSection } from '$lib/types.ts';
	import { FULL_WINDOW, type TimeWindow } from '$lib/timeline.ts';
	import LedBands from './LedBands.svelte';
	import ShowStrip from './ShowStrip.svelte';

	let {
		viz,
		analysis,
		show,
		position,
		duration,
		view = $bindable(FULL_WINDOW),
		onseek,
		editing = false,
		sections = null,
		blind = false,
		onsections = () => {}
	}: {
		viz: Viz | null;
		analysis: TrackAnalysis | null;
		show: Show | null;
		position: number;
		duration: number;
		view?: TimeWindow;
		onseek: (t: number) => void;
		editing?: boolean;
		sections?: JudgedSection[] | null;
		/** Withhold the lanes the analyser's labelling reaches, for a blind sitting. */
		blind?: boolean;
		onsections?: (s: JudgedSection[]) => void;
	} = $props();
</script>

<div class="drawer floats">
	<!-- The bands are the strips themselves, so their axis is the room rather than the track;
	     only the lanes below have a time window to zoom.

	     They go dark for a blind sitting: they are a readout of the show, sitting directly above
	     the surface the map is being drawn on, and a cue change in them is the analyser saying
	     where it thinks a section began. The stage still shows the room, which this cannot hide
	     - the protocol asks for the rails collapsed instead. -->
	{#if !blind}
		<LedBands {viz} />
	{/if}
	<ShowStrip {analysis} {show} {position} {duration} bind:view {onseek} {editing} {blind} {sections} {onsections} />
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
