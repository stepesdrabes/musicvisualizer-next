<script lang="ts">
	import type { Step } from '$lib/types.ts';
	import Icon from '$lib/ui/Icon.svelte';
	import Spinner from '$lib/ui/Spinner.svelte';

	let { steps, compact = false }: { steps: Step[]; compact?: boolean } = $props();

	let el: HTMLDivElement | undefined = $state();

	$effect(() => {
		void steps.length;
		if (el) el.scrollTop = el.scrollHeight;
	});

	const shown = $derived(compact ? steps.slice(-7) : steps);
</script>

<div class="feed" class:compact bind:this={el}>
	{#each shown as step (step.id)}
		<div class="step {step.kind}" class:pending={step.state === 'pending'}>
			<span class="glyph">
				{#if step.state === 'pending'}
					<Spinner size={11} accent />
				{:else if step.state === 'failed'}
					<span class="bad"><Icon name="x" size={11} /></span>
				{:else if step.kind === 'phase'}
					<span class="live"><Icon name="chevronRight" size={11} /></span>
				{:else}
					<span class="ok"><Icon name="check" size={11} /></span>
				{/if}
			</span>

			<span class="body">
				<span class="label">{step.label}</span>
				{#if step.detail}<span class="detail mono">{step.detail}</span>{/if}
				{#if step.result}<span class="result mono">{step.result}</span>{/if}
			</span>
		</div>
	{/each}
</div>

<style>
	.feed {
		display: flex;
		flex-direction: column;
		gap: 7px;
		overflow-y: auto;
		min-height: 0;
	}
	.feed.compact {
		gap: 6px;
		max-height: 190px;
		overflow: hidden;
		mask-image: linear-gradient(to bottom, transparent, #000 22px);
	}
	.step {
		display: flex;
		gap: 9px;
		align-items: flex-start;
		text-align: left;
		animation: in 0.18s ease-out;
	}
	@keyframes in {
		from {
			opacity: 0;
			translate: 0 4px;
		}
	}
	.glyph {
		width: 13px;
		flex: none;
		display: grid;
		place-items: center;
		padding-top: 3px;
	}
	.ok {
		color: var(--ok);
		opacity: 0.8;
	}
	.bad {
		color: var(--bad);
	}
	.live {
		color: var(--live);
	}

	.body {
		display: flex;
		flex-wrap: wrap;
		gap: 2px 8px;
		min-width: 0;
		align-items: baseline;
	}
	.label {
		font-size: 12.5px;
		color: var(--muted-foreground);
	}
	.step.phase .label {
		color: var(--foreground);
		font-weight: 600;
		font-size: 13px;
	}
	.step.think .label {
		color: var(--subtle-foreground);
		font-style: italic;
	}
	.detail,
	.result {
		color: var(--subtle-foreground);
		font-size: 11.5px;
	}
	.result {
		width: 100%;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.step.pending .label {
		color: var(--foreground);
	}
</style>
