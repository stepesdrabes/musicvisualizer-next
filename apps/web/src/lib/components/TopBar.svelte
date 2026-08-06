<script lang="ts">
	import type { LoadState } from '$lib/types.ts';

	let {
		load,
		canAuthor,
		hasShow,
		onload,
		onauthor
	}: {
		load: LoadState;
		canAuthor: boolean;
		hasShow: boolean;
		onload: (source: string) => void;
		onauthor: () => void;
	} = $props();

	let value = $state('');
	const busy = $derived(load.phase !== 'idle' && load.phase !== 'ready' && load.phase !== 'error');

	function submit() {
		if (value.trim() && !busy) onload(value.trim());
	}
</script>

<header>
	<span class="mark">ROOM</span>

	<div class="field">
		<svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" class="faint">
			<path
				d="M6.5 1a5.5 5.5 0 0 1 4.38 8.85l4.13 4.14-1.06 1.06-4.14-4.13A5.5 5.5 0 1 1 6.5 1zm0 1.5a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" />
		</svg>
		<input
			type="text"
			placeholder="Paste a YouTube link, or a path to an audio file"
			bind:value
			onkeydown={(e) => e.key === 'Enter' && submit()}
			disabled={busy} />
		<button class="btn ghost" onclick={submit} disabled={busy || !value.trim()}>Load</button>
	</div>

	<span class="spacer"></span>

	{#if busy}
		<span class="status mono">
			<span class="spinner"></span>
			{load.message}
			{#if load.progress !== null}<span class="faint">{Math.round(load.progress * 100)}%</span>{/if}
		</span>
	{:else if load.phase === 'error'}
		<span class="status mono bad">{load.message}</span>
	{/if}

	<button class="btn solid" onclick={onauthor} disabled={busy || !canAuthor}>
		{hasShow ? 'Re-generate show' : 'Generate show'}
	</button>
</header>

<style>
	header {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 16px;
		background: var(--surface);
		border-bottom: 1px solid var(--line);
	}
	.mark {
		font-family: var(--mono);
		font-size: 11px;
		letter-spacing: 0.2em;
		font-weight: 700;
		color: var(--accent);
		flex: none;
	}
	.field {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: 1;
		max-width: 560px;
		position: relative;
	}
	.field svg {
		position: absolute;
		left: 13px;
		pointer-events: none;
	}
	.field input {
		flex: 1;
		padding-left: 33px;
	}
	.spacer {
		flex: 1;
	}
	.status {
		display: flex;
		align-items: center;
		gap: 7px;
		color: var(--dim);
	}
	.status.bad {
		color: var(--bad);
		max-width: 380px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.spinner {
		width: 11px;
		height: 11px;
		border-radius: 50%;
		border: 1.5px solid var(--line);
		border-top-color: var(--accent);
		animation: spin 0.7s linear infinite;
	}
	@keyframes spin {
		to {
			rotate: 360deg;
		}
	}
</style>
