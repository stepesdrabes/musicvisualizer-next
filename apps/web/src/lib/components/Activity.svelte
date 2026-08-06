<script lang="ts">
	import type { Step } from '$lib/types.ts';

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
					<span class="spin"></span>
				{:else if step.state === 'failed'}
					<span class="mark bad">×</span>
				{:else if step.kind === 'phase'}
					<span class="mark accent">▸</span>
				{:else}
					<span class="mark ok">✓</span>
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
		gap: 5px;
		overflow-y: auto;
		min-height: 0;
	}
	.feed.compact {
		gap: 4px;
		max-height: 190px;
		overflow: hidden;
		mask-image: linear-gradient(to bottom, transparent, #000 22px);
	}
	.step {
		display: flex;
		gap: 8px;
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
		width: 12px;
		flex: none;
		display: grid;
		place-items: center;
		padding-top: 2px;
	}
	.mark {
		font-size: 10px;
		line-height: 1;
	}
	.mark.ok {
		color: var(--ok);
		opacity: 0.75;
	}
	.mark.bad {
		color: var(--bad);
		font-size: 13px;
	}
	.mark.accent {
		color: var(--accent);
	}
	.spin {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		border: 1.5px solid #ffffff1f;
		border-top-color: var(--accent);
		animation: spin 0.7s linear infinite;
	}
	@keyframes spin {
		to {
			rotate: 360deg;
		}
	}

	.body {
		display: flex;
		flex-wrap: wrap;
		gap: 2px 7px;
		min-width: 0;
		align-items: baseline;
	}
	.label {
		font-size: 12px;
		color: var(--dim);
	}
	.step.phase .label {
		color: var(--text);
		font-weight: 600;
		font-size: 12.5px;
	}
	.step.think .label {
		color: var(--faint);
		font-style: italic;
	}
	.detail {
		color: var(--faint);
	}
	.result {
		color: var(--faint);
		width: 100%;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.step.pending .label {
		color: var(--text);
	}
</style>
