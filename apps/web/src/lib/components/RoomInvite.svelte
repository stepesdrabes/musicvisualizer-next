<script lang="ts">
	import { room } from '$lib/room.svelte.ts';
	import QrCode from './QrCode.svelte';

	$effect(() => {
		void room.load();
	});
</script>

{#if room.info?.url}
	<!-- Full rail width, which is enough for a phone held over the desk. Clicking it opens the
	     same code large enough to read from across the room. -->
	<button class="invite" onclick={() => (room.open = true)} title="Show the code full size">
		<QrCode value={room.info.url} fluid />
		<span class="lead">Scan to add tracks</span>
	</button>
{/if}

<style>
	.invite {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
		width: 100%;
		padding: 14px;
		border-top: 1px solid var(--border);
		transition: background-color 0.12s ease;
	}
	.invite:hover {
		background: var(--muted);
	}
	.lead {
		font-size: 12.5px;
		font-weight: 500;
		color: var(--muted-foreground);
	}
</style>
