<script lang="ts">
	import { RoomRenderer, type CameraView } from '@mv/preview3d';
	import type { Readout, Viz } from '$lib/viz.svelte.ts';
	import type { LoadState, Step } from '$lib/types.ts';
	import Activity from './Activity.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import Spinner from '$lib/ui/Spinner.svelte';

	let {
		viz,
		readout,
		load,
		steps,
		hasShow,
		queued = 0,
		lounge = false,
		onlounge
	}: {
		viz: Viz | null;
		readout: Readout;
		load: LoadState;
		steps: Step[];
		hasShow: boolean;
		queued?: number;
		lounge?: boolean;
		onlounge: () => void;
	} = $props();

	/**
	 * Down from 5. At full bloom every lit pixel wore a halo wider than the strip, which
	 * reads as a music visualiser rather than as a room; at this level a bright cue still
	 * blooms and a dim one is honestly dim, which is what judging a show in here needs.
	 */
	const MAX_BLOOM = 3.2;

	let renderer: RoomRenderer | null = $state(null);
	let view = $state<CameraView>('orbit');

	// {@attach} rather than $effect: the canvas is the only dependency, and an $effect reading
	// the other controls would tear down and rebuild the whole WebGL context on every tweak.
	function mount(canvas: HTMLCanvasElement) {
		const v = viz;
		if (!v) return;
		const r = new RoomRenderer(canvas, v.geometry, { spec: v.spec });
		// Fixed rather than exposed. Diffused is how the strips actually read behind a channel,
		// and bloom at full is what makes a lit room look lit; both were only ever turned down
		// to inspect the raw emitters, which the LED bands in the timeline drawer show better.
		r.diffused = true;
		r.showDots = false;
		r.bloomIntensity = MAX_BLOOM;
		renderer = r;
		v.roomRenderer = r;

		const host = canvas.parentElement!;
		const ro = new ResizeObserver(() => {
			const rect = host.getBoundingClientRect();
			r.resize(rect.width, rect.height);
		});
		ro.observe(host);

		return () => {
			ro.disconnect();
			v.roomRenderer = null;
			renderer = null;
			r.dispose();
		};
	}

	$effect(() => {
		if (renderer) renderer.setView(view);
	});

	const busy = $derived(load.phase !== 'idle' && load.phase !== 'ready' && load.phase !== 'error');
	const VIEWS: { id: CameraView; label: string }[] = [
		{ id: 'orbit', label: 'Orbit' },
		{ id: 'top', label: 'Top' },
		{ id: 'front', label: 'Front' }
	];
</script>

<div class="room-layer"><canvas {@attach mount}></canvas></div>

<div class="stage floats">
	<div class="overlay top">
		<div class="segmented">
			{#each VIEWS as v (v.id)}
				<button class:on={view === v.id} onclick={() => (view = v.id)}>{v.label}</button>
			{/each}
		</div>

		<span class="spacer"></span>

		<!--
			Over the room rather than in the player bar, because it is about the room rather than about
			the track: what it says while the room is resting is the name of the look on the walls.
		-->
		<button
			class="lounge"
			class:on={lounge || readout.resting}
			onclick={onlounge}
			title={lounge
				? 'Calm scenes are lighting the room'
				: readout.resting
					? 'The room is resting'
					: 'Lounge, and how the room rests'}>
			<Icon name="lounge" size={14} />
			<span>{readout.resting && readout.scene ? readout.scene : 'Lounge'}</span>
		</button>
	</div>

	<div class="overlay bottom">
		<span class="mono subtle">
			{viz ? `${viz.geometry.count} px · ${viz.spec.width}x${viz.spec.depth} m` : ''}
		</span>
		<span class="spacer"></span>
		<span class="mono subtle">{readout.fps} fps</span>
	</div>

	{#if !hasShow}
		<div class="empty">
			{#if busy}
				<Spinner size={26} accent />
				<h1>{load.message}</h1>
				{#if load.phase === 'authoring'}
					{#if steps.length > 0}
						<div class="live"><Activity {steps} compact /></div>
					{:else}
						<p>Claude is researching the track.</p>
					{/if}
				{/if}
			{:else if readout.duration > 0}
				<h1>Track ready</h1>
			{:else if queued > 0}
				<h1>Preparing the queue</h1>
			{:else if readout.resting}
				<Icon name="lounge" size={26} />
				<h1>The room is resting</h1>
				<p>{readout.scene}. Search for a track and it will hand over.</p>
			{:else}
				<Icon name="radio" size={26} />
				<h1>The room is dark</h1>
				<p>Search for a track to light it.</p>
			{/if}
		</div>
	{/if}
</div>

<style>
	/*
	 * A transparent column, not a viewport. The canvas is full-window underneath; this only
	 * reserves the space the room is meant to read as its own and anchors the controls.
	 */
	.stage {
		position: relative;
		flex: 1;
		min-width: 0;
		min-height: 0;
		/* Transparent to the pointer as well as to the eye, so a drag over the room reaches the
		   canvas underneath. The controls inside take their events back individually. */
		pointer-events: none;
	}
	canvas {
		display: block;
		width: 100%;
		height: 100%;
	}

	.overlay {
		position: absolute;
		left: 0;
		right: 0;
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 12px 14px;
		pointer-events: none;
	}
	.overlay.top {
		top: 0;
	}
	.overlay.bottom {
		bottom: 0;
	}
	.overlay > * {
		pointer-events: auto;
	}
	.spacer {
		flex: 1;
		pointer-events: none;
	}

	.segmented {
		display: flex;
		align-items: center;
		gap: 2px;
		padding: 3px;
		border-radius: var(--radius-md);
		background: #0d0d10cc;
		backdrop-filter: blur(10px);
		border: 1px solid #ffffff14;
	}
	.segmented button {
		height: 26px;
		padding: 0 11px;
		border-radius: var(--radius-sm);
		font-size: 12.5px;
		font-weight: 500;
		color: var(--muted-foreground);
		transition:
			background-color 0.12s ease,
			color 0.12s ease;
	}
	.segmented button:hover {
		color: var(--foreground);
	}
	.segmented button.on {
		background: #ffffff17;
		color: var(--foreground);
	}

	/* The same floating tray as the view presets, as one pill rather than a row of them. */
	.lounge {
		display: flex;
		align-items: center;
		gap: 7px;
		height: 32px;
		padding: 0 12px;
		border-radius: var(--radius-md);
		background: #0d0d10cc;
		backdrop-filter: blur(10px);
		border: 1px solid #ffffff14;
		font-size: 12.5px;
		font-weight: 500;
		color: var(--muted-foreground);
		transition:
			background-color 0.25s ease,
			border-color 0.25s ease,
			color 0.25s ease;
	}
	.lounge:hover {
		color: var(--foreground);
		border-color: #ffffff2b;
	}
	/*
	 * Lit for what the room is doing rather than for what the switch says, so the accent means the
	 * same thing here as everywhere else: the walls are being driven by something other than the
	 * track on the scrubber.
	 */
	.lounge.on {
		background: color-mix(in srgb, var(--live) 20%, #0d0d10cc);
		border-color: color-mix(in srgb, var(--live) 45%, transparent);
		color: var(--live);
	}

	.empty {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 12px;
		text-align: center;
		padding: 24px;
		pointer-events: none;
		color: var(--subtle-foreground);
	}
	.empty h1 {
		font-size: 20px;
		font-weight: 600;
		letter-spacing: -0.015em;
		color: var(--foreground);
	}
	.empty p {
		max-width: 360px;
		font-size: 13.5px;
		color: var(--muted-foreground);
	}
	.live {
		width: min(560px, 90%);
		margin-top: 2px;
		text-align: left;
	}
</style>
