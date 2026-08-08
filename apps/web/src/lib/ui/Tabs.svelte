<script lang="ts">
	let {
		tabs,
		value = $bindable(''),
		live = []
	}: {
		tabs: { id: string; label: string }[];
		value?: string;
		/** Tab ids that should carry a live dot. */
		live?: string[];
	} = $props();
</script>

<div class="tabs" role="tablist">
	{#each tabs as t (t.id)}
		<button
			role="tab"
			aria-selected={value === t.id}
			class:on={value === t.id}
			onclick={() => (value = t.id)}>
			{t.label}
			{#if live.includes(t.id)}<span class="dot"></span>{/if}
		</button>
	{/each}
</div>

<style>
	.tabs {
		display: flex;
		gap: 2px;
		padding: 4px;
		background: var(--muted);
		border-radius: var(--radius-md);
	}
	button {
		flex: 1;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 5px;
		height: 28px;
		padding: 0 8px;
		border-radius: var(--radius-sm);
		font-size: 13px;
		font-weight: 500;
		color: var(--subtle-foreground);
		transition:
			background-color 0.13s ease,
			color 0.13s ease;
	}
	button:hover:not(.on) {
		color: var(--muted-foreground);
	}
	button.on {
		background: var(--card-raised);
		color: var(--foreground);
		box-shadow: 0 1px 2px #0000004d;
	}
	.dot {
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: var(--live);
		animation: pulse 1.2s ease-in-out infinite;
	}
	@keyframes pulse {
		50% {
			opacity: 0.25;
		}
	}
</style>
