<script lang="ts">
	import type { Show, TrackAnalysis } from '@mv/core';
	import type { Readout } from '$lib/viz.svelte.ts';
	import type { AuthorBackend, Settings, Step } from '$lib/types.ts';
	import { titleCase } from '$lib/format.ts';
	import Activity from './Activity.svelte';
	import Badge from '$lib/ui/Badge.svelte';
	import Button from '$lib/ui/Button.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import Input from '$lib/ui/Input.svelte';
	import Section from '$lib/ui/Section.svelte';
	import Spinner from '$lib/ui/Spinner.svelte';
	import Tabs from '$lib/ui/Tabs.svelte';

	let {
		analysis,
		show,
		readout,
		log,
		steps,
		warnings,
		settings,
		canAuthor = false,
		authoring = false,
		onauthor,
		onbackend,
		onkey,
		onrelevel,
		relevelling = false
	}: {
		analysis: TrackAnalysis | null;
		show: Show | null;
		readout: Readout;
		log: string[];
		steps: Step[];
		warnings: string[];
		settings: Settings;
		canAuthor?: boolean;
		authoring?: boolean;
		onauthor: (backend: AuthorBackend) => void;
		onbackend: (backend: AuthorBackend) => void;
		onkey: (key: string) => void;
		onrelevel: (level: number) => void;
		relevelling?: boolean;
	} = $props();

	/**
	 * Which model spends the evening's credits.
	 *
	 * A choice rather than a setting because the two are not interchangeable: one costs about a
	 * hundred times what the other does, and which one a track deserves is a decision made while
	 * looking at the track.
	 */
	const BACKENDS: { id: AuthorBackend; label: string; note: string }[] = [
		{ id: 'claude', label: 'Claude', note: 'Opus 5' },
		{ id: 'deepseek', label: 'DeepSeek', note: 'V4 Flash, far cheaper per show' }
	];

	const backend = $derived(settings.authorBackend);
	let draftKey = $state('');

	const TABS = [
		{ id: 'show', label: 'Show' },
		{ id: 'cues', label: 'Cues' },
		{ id: 'design', label: 'Design' },
		{ id: 'log', label: 'Log' }
	];

	let tab = $state('show');

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
	const liveTabs = $derived(steps.some((s) => s.state === 'pending') ? ['design'] : []);

	function layerList(cue: Show['cues'][number]): string {
		return Object.entries(cue.layers)
			.filter(([, v]) => v)
			.map(([role, v]) => `${role[0]}:${v!.effect}`)
			.join(' ');
	}
</script>

<aside class="floats">
	<div class="head">
		<Tabs tabs={TABS} bind:value={tab} live={liveTabs} />
	</div>

	<div class="scroll">
		{#if tab === 'show'}
			<div class="action">
				<Button variant="primary" disabled={!canAuthor || authoring} onclick={() => onauthor(backend)}>
					{#if authoring}
						<Spinner size={14} />
						Designing
					{:else}
						<Icon name="sparkles" size={15} />
						{show ? 'Revise with' : 'Design with'}
						{BACKENDS.find((b) => b.id === backend)?.label}
					{/if}
				</Button>

				<div class="backends" role="group" aria-label="Which model designs the show">
					{#each BACKENDS as option (option.id)}
						<button
							class="pick"
							class:on={backend === option.id}
							disabled={authoring}
							title={option.id === 'deepseek' && !settings.hasDeepseekKey
								? 'Needs a DeepSeek API key'
								: option.note}
							onclick={() => onbackend(option.id)}>
							{option.label}
						</button>
					{/each}
				</div>

				{#if backend === 'deepseek' && !settings.hasDeepseekKey}
					<form
						class="key"
						onsubmit={(e) => {
							e.preventDefault();
							onkey(draftKey);
							draftKey = '';
						}}>
						<Input bind:value={draftKey} placeholder="DeepSeek API key" size="sm" />
						<Button type="submit" size="sm" variant="outline" disabled={draftKey.trim().length === 0}>
							Save
						</Button>
					</form>
				{/if}
			</div>

			{#if analysis}
				<Section title="Track">
					<dl>
						<dt>Tempo</dt>
						<dd>
							<span class="mono">{analysis.tempo.bpm}</span> bpm
							<span class="sep">·</span> confidence
							<span class="mono">{analysis.tempo.confidence.toFixed(2)}</span>
							{#if analysis.tempo.ambiguous}
								<!-- Only where the evidence really is split. Offering the correction on every
								     track would teach people to ignore it. -->
								<Badge
									variant="warn"
									title="an unusual tempo for a tactus; a commoner reading of the same beats is offered below">
									Ambiguous
								</Badge>
							{/if}
						</dd>

						{#if analysis.tempo.alternativeBpm.length > 0}
							<dt>Re-read at</dt>
							<dd class="levels">
								{#each analysis.tempo.alternativeBpm as alt (alt)}
									<Button
										variant="outline"
										size="sm"
										disabled={relevelling}
										onclick={() => onrelevel(alt / analysis.tempo.bpm)}>
										{Math.round(alt)} bpm
									</Button>
								{/each}
							</dd>
						{/if}

						<dt>Grid</dt>
						<dd>
							{analysis.tempo.beatsPerBar}/4 <span class="sep">·</span> phrase
							<span class="mono">{analysis.tempo.barsPerPhrase}</span>
							<span class="sep">·</span> anchor
							<span class="mono">{analysis.tempo.phraseAnchorBar}</span>
						</dd>
						<dt>Bars</dt>
						<dd><span class="mono">{analysis.bars.length}</span></dd>
						<dt>Loudness</dt>
						<dd><span class="mono">{analysis.integratedLufs}</span> LUFS</dd>
					</dl>
				</Section>

				<Section title="Arrangement">
					<ul class="sections">
						{#each analysis.sections as s (s.index)}
							<li class:now={readout.bar >= s.startBar && readout.bar < s.endBar}>
								<span class="swatch" style:background={`var(--sec-${s.kind})`}></span>
								<span class="kind">{titleCase(s.kind)}</span>
								<span class="mono subtle">{s.startBar}-{s.endBar}</span>
								<span class="spacer"></span>
								{#if s.energyRank === 1}<Badge variant="live">Peak</Badge>{/if}
								<span class="mono subtle">{s.meanEnergy}</span>
							</li>
						{/each}
					</ul>
				</Section>
			{/if}

			{#if show}
				<Section title="Palette">
					<div class="palette">
						{#each [['Base', show.palette.base], ['Accent', show.palette.accent], ...(show.palette.third !== undefined ? [['Third', show.palette.third] as const] : [])] as const as [label, hue] (label)}
							<div class="chip">
								<span class="fill" style:background={`hsl(${hue} 88% 50%)`}></span>
								<span class="chip-label subtle">{label} <span class="mono">{hue}</span></span>
							</div>
						{/each}
					</div>
				</Section>

				<Section title="Brief">
					<p class="brief">{show.brief}</p>
				</Section>

				{#if show.generatedEffects.length > 0}
					<Section title="Written for this track">
						{#each show.generatedEffects as g (g.id)}
							<div class="gen">
								<span class="gen-head">
									<strong class="mono">{g.id}</strong>
									<Badge variant="outline">{g.role}</Badge>
								</span>
								<span class="muted">{g.blurb}</span>
							</div>
						{/each}
					</Section>
				{/if}
			{/if}

			{#if warnings.length > 0}
				<Section title="Linter notes">
					<ul class="warns">
						{#each warnings as w (w)}<li>{w}</li>{/each}
					</ul>
				</Section>
			{/if}

		{:else if tab === 'design'}
			{#if steps.length > 0}
				<div class="pad"><Activity {steps} /></div>
			{:else}
				<p class="empty subtle">Nothing yet. Press Design with Claude.</p>
			{/if}
		{:else if tab === 'cues'}
			{#if show}
				<table class="cues">
					<thead>
						<tr><th>Bar</th><th>Section</th><th>Layers</th><th>Int</th></tr>
					</thead>
					<tbody>
						{#each show.cues as c (c.bar)}
							<tr class:now={activeCue?.bar === c.bar}>
								<td class="mono">{c.bar}</td>
								<td>
									<span class="dot" style:background={`var(--sec-${c.section})`}></span>{titleCase(
										c.section
									)}
								</td>
								<td class="layers mono" title={c.note}>{layerList(c)}</td>
								<td class="mono">{((c.intensity ?? show.defaults.intensity) * 100).toFixed(0)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{:else}
				<p class="empty subtle">No show yet.</p>
			{/if}
		{:else}
			<pre class="mono" bind:this={logEl}>{log.join('\n')}</pre>
		{/if}
	</div>
</aside>

<style>
	aside {
		width: var(--rail-right);
		flex: none;
		display: flex;
		flex-direction: column;
		background: var(--panel);
		backdrop-filter: var(--panel-blur);
		border-left: 1px solid var(--border);
		min-height: 0;
	}
	.head {
		flex: none;
		padding: 8px;
		border-bottom: 1px solid var(--border);
	}
	.scroll {
		flex: 1;
		overflow-y: auto;
		min-height: 0;
	}
	.pad {
		padding: 16px;
	}
	/* The panel's one action, and it is about the show the panel describes. */
	.action {
		padding: 16px 16px 0;
	}
	.action :global(.btn) {
		width: 100%;
	}

	.backends {
		display: flex;
		gap: 2px;
		margin-top: 8px;
		padding: 2px;
		border-radius: var(--radius-md);
		background: var(--muted);
	}
	.pick {
		flex: 1;
		padding: 5px 0;
		border-radius: calc(var(--radius-md) - 3px);
		font-size: 12px;
		color: var(--subtle-foreground);
		transition:
			background-color 0.13s ease,
			color 0.13s ease;
	}
	.pick:hover:not(:disabled) {
		color: var(--foreground);
	}
	.pick.on {
		background: var(--card-raised);
		color: var(--foreground);
	}
	.pick:disabled {
		opacity: 0.4;
	}

	.key {
		display: flex;
		gap: 6px;
		margin-top: 8px;
	}
	.key :global(.btn) {
		width: auto;
		flex: none;
	}

	dl {
		display: grid;
		grid-template-columns: 78px 1fr;
		gap: 7px 10px;
		margin: 0;
		font-size: 13px;
	}
	dt {
		color: var(--subtle-foreground);
	}
	dd {
		margin: 0;
		color: var(--muted-foreground);
		display: flex;
		align-items: center;
		gap: 5px;
		flex-wrap: wrap;
	}
	.sep {
		opacity: 0.4;
	}
	.levels {
		gap: 6px;
	}

	ul.sections {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	ul.sections li {
		display: flex;
		align-items: center;
		gap: 9px;
		padding: 5px 8px;
		border-radius: var(--radius-sm);
		font-size: 13px;
		color: var(--muted-foreground);
	}
	ul.sections li.now {
		background: var(--muted);
		color: var(--foreground);
	}
	.swatch {
		width: 9px;
		height: 9px;
		border-radius: 3px;
		flex: none;
	}
	.kind {
		font-weight: 500;
	}
	.spacer {
		flex: 1;
	}

	.palette {
		display: flex;
		gap: 8px;
	}
	.chip {
		display: flex;
		flex-direction: column;
		gap: 6px;
		align-items: center;
	}
	.fill {
		width: 56px;
		height: 32px;
		border-radius: var(--radius-sm);
		box-shadow: inset 0 0 0 1px #ffffff1f;
	}
	.chip-label {
		font-size: 12px;
	}

	.brief {
		font-size: 13px;
		line-height: 1.6;
		color: var(--muted-foreground);
		white-space: pre-wrap;
	}
	.gen {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin-bottom: 12px;
		font-size: 13px;
	}
	.gen:last-child {
		margin-bottom: 0;
	}
	.gen-head {
		display: flex;
		align-items: center;
		gap: 7px;
	}
	ul.warns {
		margin: 0;
		padding-left: 17px;
		color: var(--warn);
		font-size: 12.5px;
		line-height: 1.6;
	}
	ul.warns li {
		margin-bottom: 5px;
	}

	table.cues {
		width: 100%;
		border-collapse: collapse;
		font-size: 12.5px;
	}
	table.cues th {
		text-align: left;
		color: var(--subtle-foreground);
		font-weight: 500;
		padding: 10px 12px;
		position: sticky;
		top: 0;
		background: var(--panel-strong);
		backdrop-filter: var(--panel-blur);
		border-bottom: 1px solid var(--border);
	}
	table.cues td {
		padding: 7px 12px;
		color: var(--muted-foreground);
		border-bottom: 1px solid var(--border-soft);
		white-space: nowrap;
	}
	table.cues tr.now td {
		background: var(--muted);
		color: var(--foreground);
	}
	.layers {
		max-width: 140px;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.dot {
		display: inline-block;
		width: 7px;
		height: 7px;
		border-radius: 50%;
		margin-right: 7px;
	}

	pre {
		margin: 0;
		padding: 16px;
		white-space: pre-wrap;
		word-break: break-word;
		color: var(--muted-foreground);
		line-height: 1.65;
		font-size: 11.5px;
	}
	.empty {
		padding: 24px 16px;
		font-size: 13px;
	}
</style>
