<script lang="ts">
	import { BUILT_IN_EFFECTS, LAYER_ROLES, type EffectDef, type LayerRole } from '@mv/core';
	import { renderFilmstrip } from '$lib/filmstrip.ts';

	let {
		generated = [],
		previewing = null,
		params = {},
		onpreview,
		onparam
	}: {
		generated?: EffectDef[];
		previewing?: string | null;
		params?: Record<string, number>;
		onpreview: (def: EffectDef | null) => void;
		onparam: (key: string, value: number) => void;
	} = $props();

	const STRIP_W = 220;
	const STRIP_H = 26;

	let role = $state<LayerRole | 'all'>('all');
	let query = $state('');

	const all = $derived([...BUILT_IN_EFFECTS, ...generated]);
	const live = $derived(all.find((e) => e.id === previewing) ?? null);
	const shown = $derived(
		all.filter((e) => {
			if (role !== 'all' && e.role !== role) return false;
			if (!query.trim()) return true;
			const q = query.toLowerCase();
			return (
				e.id.toLowerCase().includes(q) ||
				e.name.toLowerCase().includes(q) ||
				e.blurb.toLowerCase().includes(q) ||
				e.taste.sections.some((s) => s.includes(q))
			);
		})
	);

	/**
	 * Rendering forty effects over a scripted journey each is about a second of work, so it
	 * happens once a card is on screen rather than when the tab opens.
	 */
	function strip(node: HTMLCanvasElement, def: EffectDef) {
		let drawn = false;
		const paint = () => {
			if (drawn) return;
			drawn = true;
			const ctx = node.getContext('2d');
			if (!ctx) return;
			try {
				const pixels = renderFilmstrip(def, STRIP_W, STRIP_H);
				ctx.putImageData(new ImageData(pixels, STRIP_W, STRIP_H), 0, 0);
			} catch {
				// A generated effect can throw on a frame the gate never reached. A blank strip is
				// a better answer than taking the whole gallery down with it.
				ctx.fillStyle = '#2a1a1a';
				ctx.fillRect(0, 0, STRIP_W, STRIP_H);
			}
		};

		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((e) => e.isIntersecting)) {
					paint();
					observer.disconnect();
				}
			},
			{ rootMargin: '200px' }
		);
		observer.observe(node);
		return { destroy: () => observer.disconnect() };
	}
</script>

<div class="controls">
	<input class="search" type="search" placeholder="filter" bind:value={query} />
	<div class="roles">
		<button class:on={role === 'all'} onclick={() => (role = 'all')}>all</button>
		{#each LAYER_ROLES as r (r)}
			<button class:on={role === r} onclick={() => (role = r)}>{r}</button>
		{/each}
	</div>
</div>

{#if live}
	<div class="live-panel">
		<div class="live-head">
			<span class="name">{live.name}</span>
			<span class="role mono">{live.role}</span>
			<button class="back" onclick={() => onpreview(null)}>back to the show</button>
		</div>
		<p class="blurb faint">{live.blurb}</p>
		{#if live.params.length > 0}
			<div class="params">
				{#each live.params as spec (spec.key)}
					<label>
						<span class="key">{spec.label}</span>
						<input
							type="range"
							min={spec.min}
							max={spec.max}
							step={spec.step}
							value={params[spec.key] ?? spec.default}
							oninput={(e) => onparam(spec.key, Number(e.currentTarget.value))} />
						<span class="val mono">{(params[spec.key] ?? spec.default).toFixed(2)}</span>
					</label>
				{/each}
			</div>
		{:else}
			<p class="faint small">No parameters.</p>
		{/if}
	</div>
{:else}
	<p class="hint faint">
		Each strip is the room top to bottom - four walls then the ceiling beam - over one groove
		into a build, a void and a drop. Click one to run it in the room against the loaded track.
	</p>
{/if}

<div class="grid">
	{#each shown as def (def.id)}
		<button
			class="card"
			class:live={previewing === def.id}
			onclick={() => onpreview(previewing === def.id ? null : def)}
		>
			<canvas width={STRIP_W} height={STRIP_H} use:strip={def}></canvas>
			<div class="meta">
				<span class="name">{def.name}</span>
				<span class="role mono">{def.role}</span>
				<span class="energy" title="energy {def.taste.energy} of 5">
					{'●'.repeat(def.taste.energy)}<span class="dim"
						>{'○'.repeat(5 - def.taste.energy)}</span
					>
				</span>
			</div>
			<p class="blurb faint">{def.blurb}</p>
			<p class="sections mono faint">
				{def.taste.sections.join(' ')} · {def.taste.minBars}-{def.taste.maxBars} bars{def.taste
					.peakReserved
					? ' · peak only'
					: ''}
			</p>
		</button>
	{/each}
</div>

{#if shown.length === 0}
	<p class="empty faint">Nothing matches.</p>
{/if}

<style>
	.controls {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		flex-wrap: wrap;
		margin-bottom: 0.5rem;
	}
	.search {
		flex: 1 1 6rem;
		min-width: 5rem;
		background: var(--panel-2, #16161a);
		border: 1px solid var(--line, #2a2a30);
		border-radius: 4px;
		color: inherit;
		font: inherit;
		padding: 0.25rem 0.45rem;
	}
	.roles {
		display: flex;
		gap: 2px;
	}
	.roles button {
		background: var(--panel-2, #16161a);
		border: 1px solid var(--line, #2a2a30);
		color: inherit;
		font: inherit;
		font-size: 0.72rem;
		padding: 0.2rem 0.4rem;
		border-radius: 4px;
		cursor: pointer;
	}
	.roles button.on {
		background: var(--accent, #4a4aff);
		border-color: var(--accent, #4a4aff);
		color: #fff;
	}
	.hint {
		margin: 0 0 0.6rem;
		font-size: 0.72rem;
		line-height: 1.35;
	}
	.live-panel {
		background: var(--panel-2, #16161a);
		border: 1px solid var(--accent, #4a4aff);
		border-radius: 6px;
		padding: 0.5rem 0.6rem;
		margin-bottom: 0.6rem;
	}
	.live-head {
		display: flex;
		align-items: baseline;
		gap: 0.4rem;
	}
	.back {
		margin-left: auto;
		background: var(--accent, #4a4aff);
		border: none;
		border-radius: 4px;
		color: #fff;
		font: inherit;
		font-size: 0.7rem;
		padding: 0.2rem 0.5rem;
		cursor: pointer;
	}
	.params {
		display: grid;
		gap: 0.2rem;
		margin-top: 0.4rem;
	}
	.params label {
		display: grid;
		grid-template-columns: 5.5rem 1fr 2.4rem;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.68rem;
	}
	.params .key {
		opacity: 0.7;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.params input[type='range'] {
		width: 100%;
		accent-color: var(--accent, #4a4aff);
	}
	.params .val {
		font-size: 0.64rem;
		opacity: 0.6;
		text-align: right;
	}
	.small {
		font-size: 0.68rem;
		margin: 0.3rem 0 0;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
		gap: 0.5rem;
	}
	.card {
		display: block;
		width: 100%;
		text-align: left;
		background: var(--panel-2, #16161a);
		border: 1px solid var(--line, #2a2a30);
		border-radius: 6px;
		padding: 0;
		overflow: hidden;
		cursor: pointer;
		color: inherit;
		font: inherit;
	}
	.card:hover {
		border-color: #4a4a55;
	}
	.card.live {
		border-color: var(--accent, #4a4aff);
		box-shadow: 0 0 0 1px var(--accent, #4a4aff);
	}
	canvas {
		display: block;
		width: 100%;
		height: 26px;
		/* Nearest-neighbour: the strip is one pixel per LED and smoothing it invents motion. */
		image-rendering: pixelated;
		background: #000;
	}
	.meta {
		display: flex;
		align-items: baseline;
		gap: 0.4rem;
		padding: 0.35rem 0.45rem 0;
	}
	.name {
		font-weight: 600;
		font-size: 0.78rem;
	}
	.role {
		font-size: 0.66rem;
		opacity: 0.6;
	}
	.energy {
		margin-left: auto;
		font-size: 0.6rem;
		letter-spacing: 0.05em;
	}
	.energy .dim {
		opacity: 0.25;
	}
	.blurb {
		margin: 0.2rem 0.45rem 0;
		font-size: 0.7rem;
		line-height: 1.3;
	}
	.sections {
		margin: 0.25rem 0.45rem 0.45rem;
		font-size: 0.62rem;
		opacity: 0.55;
	}
	.empty {
		padding: 1rem 0;
	}
</style>
