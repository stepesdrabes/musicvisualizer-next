<script lang="ts">
	import { room } from '$lib/room.svelte.ts';
	import QrCode from './QrCode.svelte';

	$effect(() => {
		void room.load();
	});
</script>

{#if room.info?.url}
	<!-- A phone needs about a hand's width of code to read one, and this is a rail, so the
	     small copy is a handle for the full-size one rather than something to scan. -->
	<button class="invite" onclick={() => (room.open = true)} title="Show the code full size">
		<QrCode value={room.info.url} size={64} />
		<span class="text">
			<span class="lead">Scan to add tracks</span>
			<span class="addr mono truncate">{room.info.address}</span>
		</span>
	</button>
{/if}

<style>
	.invite {
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
		padding: 12px;
		border-top: 1px solid var(--border);
		text-align: left;
		transition: background-color 0.12s ease;
	}
	.invite:hover {
		background: var(--muted);
	}
	.text {
		display: flex;
		flex-direction: column;
		gap: 3px;
		min-width: 0;
	}
	.lead {
		font-size: 12.5px;
		font-weight: 500;
		color: var(--foreground);
	}
	.addr {
		font-size: 11.5px;
		color: var(--subtle-foreground);
	}
</style>
