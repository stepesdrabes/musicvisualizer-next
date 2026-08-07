<script lang="ts">
	import type { EffectDef, Show, TrackAnalysis } from '@mv/core';
	import type { Readout } from '$lib/viz.svelte.ts';
	import type { Step } from '$lib/types.ts';
	import Activity from './Activity.svelte';
	import Gallery from './Gallery.svelte';

	let {
		analysis,
		show,
		readout,
		log,
		steps,
		warnings,
		ddpHost = $bindable(''),
		ddpRunning,
		ontoggleOutput,
		generatedEffects = [],
		previewing = null,
		previewParams = {},
		onpreview,
		onparam,
		onrelevel,
		relevelling = false
	}: {
		analysis: TrackAnalysis | null;
		show: Show | null;
		readout: Readout;
		log: string[];
		steps: Step[];
		warnings: string[];
		ddpHost?: string;
		ddpRunning: boolean;
		ontoggleOutput: () => void;
		generatedEffects?: EffectDef[];
		previewing?: string | null;
		previewParams?: Record<string, number>;
		onpreview: (def: EffectDef | null) => void;
		onparam: (key: string, value: number) => void;
		onrelevel: (level: number) => void;
		relevelling?: boolean;
	} = $props();

	let tab = $state<'show' | 'cues' | 'effects' | 'design' | 'log'>('show');

	// Follow the agent automatically while it works, then hand the view back.
	let followed = $state(false);
	$effect(() => {
		if (steps.length > 0 && !followed) {
			followed = true;
			tab = 'design';
		}
	});
	let logEl: HTMLPreElement | undefined = $state();

	$effect(() => {
		// Depend on length so a new line scrolls the view.
		void log.length;
		if (logEl) logEl.scrollTop = logEl.scrollHeight;
	});

	const activeCue = $derived(
		show ? [...show.cues].reverse().find((c) => c.bar <= readout.bar) : undefined
	);

	function layerList(cue: Show['cues'][number]): string {
		return Object.entries(cue.layers)
			.filter(([, v]) => v)
			.map(([role, v]) => `${role[0]}:${v!.effect}`)
			.join(' ');
	}
</script>

<aside>
	<nav>
		{#each ['show', 'cues', 'effects', 'design', 'log'] as const as t (t)}
			<button class:on={tab === t} onclick={() => (tab = t)}>
				{t}
				{#if t === 'design' && steps.some((s) => s.state === 'pending')}
					<span class="dot-live"></span>
				{/if}
			</button>
		{/each}
	</nav>

	<div class="scroll">
		{#if tab === 'show'}
			{#if analysis}
				<section>
					<h2 class="caption">Track</h2>
					<dl class="mono">
						<dt>tempo</dt>
						<dd>
							{analysis.tempo.bpm} bpm · confidence {analysis.tempo.confidence.toFixed(2)}
							{#if analysis.tempo.ambiguous}
								<!-- Only where the evidence really is split. Offering the correction on every
								     track would teach people to ignore it. -->
								<span class="ambiguous" title="an unusual tempo for a tactus; a commoner reading of the same beats is offered below"
									>ambiguous</span>
							{/if}
						</dd>
						{#if analysis.tempo.alternativeBpm.length > 0}
							<dt>re-read at</dt>
							<dd class="levels">
								{#each analysis.tempo.alternativeBpm as alt (alt)}
									<button
										type="button"
										disabled={relevelling}
										onclick={() => onrelevel(alt / analysis.tempo.bpm)}>
										{Math.round(alt)} bpm
									</button>
								{/each}
							</dd>
						{/if}
						<dt>grid</dt>
						<dd>
							{analysis.tempo.beatsPerBar}/4 · phrase {analysis.tempo.barsPerPhrase} · anchor {analysis
								.tempo.phraseAnchorBar}
						</dd>
						<dt>bars</dt>
						<dd>{analysis.bars.length}</dd>
						<dt>loudness</dt>
						<dd>{analysis.integratedLufs} LUFS</dd>
					</dl>
				</section>

				<section>
					<h2 class="caption">Arrangement</h2>
					<ul class="sections">
						{#each analysis.sections as s (s.index)}
							<li class:now={readout.bar >= s.startBar && readout.bar < s.endBar}>
								<span class="swatch" style:background={`var(--sec-${s.kind})`}></span>
								<span class="kind">{s.kind}</span>
								<span class="mono faint">{s.startBar}-{s.endBar}</span>
								<span class="spacer"></span>
								{#if s.energyRank === 1}<span class="peak mono">peak</span>{/if}
								<span class="mono faint">{s.meanEnergy}</span>
							</li>
						{/each}
					</ul>
				</section>
			{/if}

			{#if show}
				<section>
					<h2 class="caption">Palette</h2>
					<div class="palette">
						{#each [['base', show.palette.base], ['accent', show.palette.accent], ...(show.palette.third !== undefined ? [['third', show.palette.third] as const] : [])] as const as [label, hue] (label)}
							<div class="chip">
								<span class="fill" style:background={`hsl(${hue} 88% 50%)`}></span>
								<span class="mono faint">{label} {hue}</span>
							</div>
						{/each}
					</div>
				</section>

				<section>
					<h2 class="caption">Brief</h2>
					<p class="brief">{show.brief}</p>
				</section>

				{#if show.generatedEffects.length > 0}
					<section>
						<h2 class="caption">Written for this track</h2>
						{#each show.generatedEffects as g (g.id)}
							<div class="gen">
								<span class="mono"><strong>{g.id}</strong> · {g.role}</span>
								<span class="dim">{g.blurb}</span>
							</div>
						{/each}
					</section>
				{/if}
			{/if}

			{#if warnings.length > 0}
				<section>
					<h2 class="caption">Linter notes</h2>
					<ul class="warns mono">
						{#each warnings as w (w)}<li>{w}</li>{/each}
					</ul>
				</section>
			{/if}

			<section>
				<h2 class="caption">Hardware</h2>
				<div class="ddp">
					<input
						type="text"
						placeholder="WLED host, comma-separated"
						bind:value={ddpHost}
						disabled={ddpRunning} />
					<button
						class="btn ghost"
						onclick={ontoggleOutput}
						disabled={!show || (!ddpHost.trim() && !ddpRunning)}>
						{ddpRunning ? 'Stop' : 'Send'}
					</button>
				</div>
				{#if ddpRunning}
					<span class="mono live">DDP live · 60 fps · port 4048</span>
				{:else}
					<span class="mono faint">Sends the same bytes as the preview, over DDP.</span>
				{/if}
			</section>
		{:else if tab === 'effects'}
			<section class="gallery">
				<Gallery
					generated={generatedEffects}
					{previewing}
					params={previewParams}
					{onpreview}
					{onparam} />
			</section>
		{:else if tab === 'design'}
			{#if steps.length > 0}
				<div class="design"><Activity {steps} /></div>
			{:else}
				<p class="empty faint">Nothing yet. Press Design with Claude.</p>
			{/if}
		{:else if tab === 'cues'}
			{#if show}
				<table class="cues mono">
					<thead>
						<tr><th>bar</th><th>section</th><th>layers</th><th>int</th></tr>
					</thead>
					<tbody>
						{#each show.cues as c (c.bar)}
							<tr class:now={activeCue?.bar === c.bar}>
								<td>{c.bar}</td>
								<td><span class="dot" style:background={`var(--sec-${c.section})`}></span>{c.section}</td
								>
								<td class="layers" title={c.note}>{layerList(c)}</td>
								<td>{((c.intensity ?? show.defaults.intensity) * 100).toFixed(0)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{:else}
				<p class="empty faint">No show yet.</p>
			{/if}
		{:else}
			<pre class="mono" bind:this={logEl}>{log.join('\n')}</pre>
		{/if}
	</div>
</aside>

<style>
	.ambiguous {
		font-size: 10px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--warn, #d8a33a);
		border: 1px solid currentColor;
		padding: 0 4px;
		margin-left: 6px;
	}
	.levels {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
	}
	.levels button {
		font: inherit;
		font-size: 11px;
		color: inherit;
		background: transparent;
		border: 1px solid currentColor;
		padding: 2px 7px;
		cursor: pointer;
		opacity: 0.75;
	}
	.levels button:hover:not(:disabled) {
		opacity: 1;
	}
	.levels button:disabled {
		opacity: 0.35;
		cursor: default;
	}

	aside {
		width: 336px;
		flex: none;
		display: flex;
		flex-direction: column;
		background: var(--surface);
		border-left: 1px solid var(--line);
		min-height: 0;
	}
	nav {
		display: flex;
		gap: 2px;
		padding: 8px 10px 0;
		border-bottom: 1px solid var(--line);
	}
	nav button {
		font-family: var(--mono);
		font-size: 10px;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--faint);
		padding: 6px 11px;
		border-bottom: 2px solid transparent;
		margin-bottom: -1px;
		transition: color 0.12s;
	}
	nav button:hover {
		color: var(--dim);
	}
	nav button.on {
		color: var(--text);
		border-bottom-color: var(--accent);
	}
	.scroll {
		flex: 1;
		overflow-y: auto;
		min-height: 0;
	}
	section {
		padding: 11px 12px;
		border-bottom: 1px solid var(--line-soft);
	}
	section.gallery {
		border-bottom: none;
	}
	h2 {
		margin: 0 0 7px;
	}
	dl {
		display: grid;
		grid-template-columns: 64px 1fr;
		gap: 3px 8px;
		margin: 0;
	}
	dt {
		color: var(--faint);
	}
	dd {
		margin: 0;
		color: var(--dim);
	}

	ul.sections {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	ul.sections li {
		display: flex;
		align-items: center;
		gap: 7px;
		padding: 3px 5px;
		border-radius: var(--r-sm);
		font-size: 12px;
	}
	ul.sections li.now {
		background: #ffffff0d;
	}
	.swatch {
		width: 3px;
		height: 13px;
		border-radius: 2px;
		flex: none;
	}
	.kind {
		text-transform: capitalize;
	}
	.spacer {
		flex: 1;
	}
	.peak {
		color: var(--accent);
		font-size: 9px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}

	.palette {
		display: flex;
		gap: 7px;
	}
	.chip {
		display: flex;
		flex-direction: column;
		gap: 4px;
		align-items: center;
	}
	.fill {
		width: 42px;
		height: 26px;
		border-radius: var(--r-sm);
		box-shadow: inset 0 0 0 1px #ffffff1a;
	}

	.brief {
		margin: 0;
		font-size: 12.5px;
		line-height: 1.55;
		color: var(--dim);
		white-space: pre-wrap;
	}
	.gen {
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin-bottom: 7px;
		font-size: 12px;
	}
	ul.warns {
		margin: 0;
		padding-left: 15px;
		color: var(--warn);
		line-height: 1.55;
	}
	ul.warns li {
		margin-bottom: 3px;
	}

	.ddp {
		display: flex;
		gap: 6px;
		margin-bottom: 6px;
	}
	.ddp input {
		flex: 1;
		min-width: 0;
	}
	.live {
		color: var(--ok);
	}

	table.cues {
		width: 100%;
		border-collapse: collapse;
	}
	table.cues th {
		text-align: left;
		color: var(--faint);
		font-weight: 600;
		padding: 7px 8px;
		position: sticky;
		top: 0;
		background: var(--surface);
		border-bottom: 1px solid var(--line);
	}
	table.cues td {
		padding: 4px 8px;
		color: var(--dim);
		border-bottom: 1px solid var(--line-soft);
		white-space: nowrap;
	}
	table.cues tr.now td {
		background: #ffffff0d;
		color: var(--text);
	}
	.layers {
		max-width: 130px;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.dot {
		display: inline-block;
		width: 6px;
		height: 6px;
		border-radius: 50%;
		margin-right: 5px;
	}

	pre {
		margin: 0;
		padding: 11px 12px;
		white-space: pre-wrap;
		word-break: break-word;
		color: var(--dim);
		line-height: 1.6;
		max-height: 100%;
	}
	.empty {
		padding: 16px 12px;
	}
	.design {
		padding: 11px 12px;
	}
	.dot-live {
		display: inline-block;
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: var(--accent);
		margin-left: 4px;
		vertical-align: middle;
		animation: pulse 1.1s ease-in-out infinite;
	}
	@keyframes pulse {
		50% {
			opacity: 0.25;
		}
	}
</style>
