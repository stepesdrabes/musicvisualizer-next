<script lang="ts">
	import Dialog from '$lib/ui/Dialog.svelte';
	import Button from '$lib/ui/Button.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import QrCode from './QrCode.svelte';

	interface Room {
		token: string;
		address: string | null;
		url: string | null;
	}

	let room = $state<Room | null>(null);
	let open = $state(false);
	let rotating = $state(false);

	async function load() {
		try {
			const res = await fetch('/api/room');
			if (res.ok) room = (await res.json()) as Room;
		} catch {
			// No room means no code to show, which the empty state already covers.
		}
	}

	async function rotate() {
		rotating = true;
		try {
			const res = await fetch('/api/room', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ action: 'rotate' })
			});
			if (res.ok) room = (await res.json()) as Room;
		} finally {
			rotating = false;
		}
	}

	$effect(() => {
		void load();
	});
</script>

{#if room?.url}
	<!-- Small enough to live in the rail, and a phone needs about a hand's width of code to
	     read it, so the whole thing opens larger rather than pretending this size scans. -->
	<button class="invite" onclick={() => (open = true)} title="Show the code full size">
		<QrCode value={room.url} size={64} />
		<span class="text">
			<span class="lead">Scan to add tracks</span>
			<span class="addr mono truncate">{room.address}</span>
		</span>
	</button>
{/if}

<Dialog {open} onclose={() => (open = false)} labelledBy="invite-title">
	<div class="big">
		<h2 id="invite-title">Scan to add tracks</h2>
		{#if room?.url}
			<QrCode value={room.url} size={264} />
			<p class="url mono">{room.url}</p>
			<p class="note">
				Anyone on this network who scans this can search and add to the queue, and take back
				what they added. Rotating the code shuts out everyone who has it.
			</p>
			<Button variant="outline" size="sm" disabled={rotating} onclick={rotate}>
				<Icon name="retry" size={14} />
				New code
			</Button>
		{:else}
			<p class="note">
				This machine has no network address, so there is nothing a phone could reach. Join a
				network and reopen this.
			</p>
		{/if}
	</div>
</Dialog>

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

	.big {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 16px;
		padding: 28px 24px;
		text-align: center;
	}
	.big h2 {
		font-size: 15px;
		font-weight: 600;
	}
	.url {
		font-size: 12.5px;
		color: var(--muted-foreground);
		word-break: break-all;
	}
	.note {
		font-size: 12.5px;
		line-height: 1.6;
		color: var(--subtle-foreground);
		max-width: 40ch;
	}
</style>
