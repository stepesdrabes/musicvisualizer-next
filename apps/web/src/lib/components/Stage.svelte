<script lang="ts">
	import { RoomRenderer, type CameraView } from '@mv/preview3d';
	import type { Readout, Viz } from '$lib/viz.svelte.ts';
	import type { LoadState, Step } from '$lib/types.ts';
	import Activity from './Activity.svelte';

	let {
		viz,
		readout,
		load,
		steps,
		hasShow
	}: {
		viz: Viz | null;
		readout: Readout;
		load: LoadState;
		steps: Step[];
		hasShow: boolean;
	} = $props();

	let renderer: RoomRenderer | null = $state(null);
	let view = $state<CameraView>('orbit');
	let dots = $state(false);
	let diffused = $state(true);
	let bloom = $state(2.1);

	// {@attach} rather than $effect: the canvas is the only dependency, and an $effect reading
	// the other controls would tear down and rebuild the whole WebGL context on every tweak.
	function mount(canvas: HTMLCanvasElement) {
		const v = viz;
		if (!v) return;
		const r = new RoomRenderer(canvas, v.geometry, { spec: v.spec });
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
	$effect(() => {
		if (renderer) renderer.showDots = dots;
	});
	$effect(() => {
		if (renderer) renderer.diffused = diffused;
	});
	$effect(() => {
		if (renderer) renderer.bloomIntensity = bloom;
	});

	const busy = $derived(load.phase !== 'idle' && load.phase !== 'ready' && load.phase !== 'error');
</script>

<div class="stage">
	<canvas {@attach mount}></canvas>

	<div class="overlay top">
		<div class="views">
			{#each ['orbit', 'top', 'front'] as const as v (v)}
				<button class:on={view === v} onclick={() => (view = v)}>{v}</button>
			{/each}
		</div>

		<span class="spacer"></span>

		<div class="toggles">
			<button class:on={diffused} onclick={() => (diffused = !diffused)} title="Diffuser blending">
				diffuse
			</button>
			<button class:on={dots} onclick={() => (dots = !dots)} title="Show discrete LEDs">
				pixels
			</button>
			<label title="Bloom">
				<span class="faint">bloom</span>
				<input type="range" min="0" max="5" step="0.1" bind:value={bloom} />
			</label>
		</div>
	</div>

	<div class="overlay bottom">
		<span class="mono faint">
			{viz ? `${viz.geometry.count} px · ${viz.spec.width}x${viz.spec.depth} m` : ''}
		</span>
		<span class="spacer"></span>
		{#if readout.headroom < 0.995}
			<span class="mono warn" title="Photosensitivity limiter is reducing output">
				flash limit {(readout.headroom * 100).toFixed(0)}%
			</span>
		{/if}
		<span class="mono faint">{readout.fps} fps</span>
	</div>

	{#if !hasShow}
		<div class="empty">
			{#if busy}
				<div class="big-spinner"></div>
				<h1>{load.message}</h1>
				{#if load.progress !== null}
					<div class="bar"><div style:width={`${load.progress * 100}%`}></div></div>
				{/if}
				{#if load.phase === 'authoring'}
					{#if steps.length > 0}
						<div class="live"><Activity {steps} compact /></div>
					{:else}
						<p class="dim">Claude is researching the track.</p>
					{/if}
				{:else}
					<p class="dim">Downloading and analysing.</p>
				{/if}
			{:else if readout.duration > 0}
				<h1>Track ready</h1>
				<p class="dim">Press Generate show to have Claude design the lighting.</p>
			{:else}
				<h1>The room is dark</h1>
				<p class="dim">Paste a YouTube link to begin.</p>
			{/if}
		</div>
	{/if}
</div>

<style>
	.stage {
		position: relative;
		flex: 1;
		min-height: 0;
		background: #04040a;
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
		padding: 10px 12px;
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

	.views,
	.toggles {
		display: flex;
		align-items: center;
		gap: 2px;
		background: #0b0b0ec4;
		backdrop-filter: blur(9px);
		border: 1px solid #ffffff14;
		border-radius: 999px;
		padding: 3px;
	}
	.toggles {
		gap: 4px;
		padding: 3px 9px 3px 3px;
	}
	.views button,
	.toggles button {
		font-family: var(--mono);
		font-size: 10px;
		letter-spacing: 0.05em;
		color: var(--dim);
		padding: 4px 10px;
		border-radius: 999px;
		transition:
			background 0.12s,
			color 0.12s;
	}
	.views button:hover,
	.toggles button:hover {
		color: var(--text);
	}
	.views button.on,
	.toggles button.on {
		background: #ffffff17;
		color: var(--text);
	}
	.toggles label {
		display: flex;
		align-items: center;
		gap: 5px;
		font-family: var(--mono);
		font-size: 10px;
	}
	.toggles input {
		width: 62px;
		accent-color: var(--dim);
	}

	.warn {
		color: var(--warn);
	}

	.empty {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 10px;
		text-align: center;
		padding: 24px;
		background: radial-gradient(ellipse at center, #0b0b12e0 0%, #05050ac0 70%);
		pointer-events: none;
	}
	.empty h1 {
		margin: 0;
		font-size: 19px;
		font-weight: 600;
		letter-spacing: -0.015em;
	}
	.empty p {
		margin: 0;
		max-width: 360px;
		font-size: 12.5px;
	}
	.big-spinner {
		width: 26px;
		height: 26px;
		border-radius: 50%;
		border: 2px solid #ffffff1a;
		border-top-color: var(--accent);
		animation: spin 0.75s linear infinite;
		margin-bottom: 4px;
	}
	@keyframes spin {
		to {
			rotate: 360deg;
		}
	}
	.bar {
		width: 190px;
		height: 3px;
		border-radius: 2px;
		background: #ffffff1a;
		overflow: hidden;
	}
	.bar div {
		height: 100%;
		background: var(--accent);
		transition: width 0.25s;
	}
	.live {
		width: min(560px, 90%);
		margin-top: 4px;
		text-align: left;
	}
</style>
