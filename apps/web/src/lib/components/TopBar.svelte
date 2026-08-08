<script lang="ts">
	import type { HardwareStatus } from '$lib/hardware.ts';
	import { linkLabel } from '$lib/hardware.svelte.ts';
	import Icon from '$lib/ui/Icon.svelte';
	import Button from '$lib/ui/Button.svelte';
	import Spinner from '$lib/ui/Spinner.svelte';
	import StatusDot from './StatusDot.svelte';

	let {
		busy = false,
		busyLabel = '',
		failure = '',
		hardware,
		leftOpen = true,
		rightOpen = true,
		onsearch,
		onhardware,
		ontoggleLeft,
		ontoggleRight
	}: {
		busy?: boolean;
		busyLabel?: string;
		failure?: string;
		hardware: HardwareStatus;
		leftOpen?: boolean;
		rightOpen?: boolean;
		onsearch: (seed: string) => void;
		onhardware: () => void;
		ontoggleLeft: () => void;
		ontoggleRight: () => void;
	} = $props();

	/**
	 * A button dressed as a field.
	 *
	 * Everything typed here belongs in the palette, so a real input would only have to hand
	 * its first keystroke over and then fight the modal for focus. A keypress opens the
	 * palette seeded with that character instead.
	 */
	function onkeydown(e: KeyboardEvent) {
		if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
			e.preventDefault();
			onsearch(e.key);
		}
	}
</script>

<header class="floats">
	<div class="side">
		<Button
			variant="ghost"
			size="icon"
			title="Queue"
			ariaLabel="Toggle the queue"
			onclick={ontoggleLeft}>
			<Icon name="panelLeft" size={17} />
		</Button>
		<span class="brand">
			<span class="bolt"><Icon name="bolt" size={13} fill /></span>
			<span class="mark">LightningStrike</span>
		</span>
	</div>

	<button class="search" aria-label="Search" onclick={() => onsearch('')} {onkeydown}>
		<Icon name="search" size={15} />
		<span>Search YouTube, or paste a link</span>
		<kbd>⌘K</kbd>
	</button>

	<div class="side end">
		{#if busy}
			<span class="status">
				<Spinner size={13} accent />
				<span class="truncate">{busyLabel}</span>
			</span>
		{:else if failure}
			<span class="status bad truncate" title={failure}>
				<Icon name="alert" size={14} />
				<span class="truncate">{failure}</span>
			</span>
		{/if}

		<button
			class="link"
			class:live={hardware.state === 'streaming'}
			class:warn={hardware.state === 'degraded'}
			class:bad={hardware.state === 'offline'}
			onclick={onhardware}
			title={hardware.host ? `${hardware.host} - ${linkLabel(hardware)}` : 'No device configured'}>
			<StatusDot state={hardware.state} />
			<span class="label">{linkLabel(hardware)}</span>
		</button>

		<Button
			variant="ghost"
			size="icon"
			title="Inspector"
			ariaLabel="Toggle the inspector"
			onclick={ontoggleRight}>
			<Icon name="panelRight" size={17} />
		</Button>
	</div>
</header>

<style>
	header {
		display: grid;
		/* Three tracks rather than flex, so the field stays optically centred whatever the
		   status text on the right happens to be doing. */
		grid-template-columns: 1fr minmax(280px, 460px) 1fr;
		align-items: center;
		gap: 16px;
		height: var(--topbar-h);
		flex: none;
		padding: 0 12px;
		background: var(--panel);
		backdrop-filter: var(--panel-blur);
		border-bottom: 1px solid var(--border);
	}

	.side {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}
	.side.end {
		justify-content: flex-end;
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 8px;
		padding-left: 2px;
		min-width: 0;
	}
	.bolt {
		display: grid;
		place-items: center;
		width: 22px;
		height: 22px;
		border-radius: 6px;
		background: var(--foreground);
		color: var(--primary-foreground);
		flex: none;
	}
	.mark {
		font-size: 14px;
		font-weight: 600;
		letter-spacing: -0.012em;
		white-space: nowrap;
	}
	/* The wordmark is the first thing to go: the search field matters more than the name. */
	@media (max-width: 1200px) {
		.mark {
			display: none;
		}
	}

	.search {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		height: var(--h);
		padding: 0 10px 0 12px;
		border-radius: var(--radius-md);
		border: 1px solid var(--border);
		background: var(--card-raised);
		color: var(--subtle-foreground);
		font-size: 13.5px;
		transition:
			background-color 0.13s ease,
			border-color 0.13s ease;
	}
	.search:hover {
		background: var(--muted);
		border-color: #33333c;
	}
	.search span {
		flex: 1;
		text-align: left;
	}
	kbd {
		font-family: var(--sans);
		font-size: 11.5px;
		padding: 2px 5px;
		border: 1px solid var(--border);
		border-radius: 5px;
		background: var(--muted);
	}

	.status {
		display: flex;
		align-items: center;
		gap: 7px;
		min-width: 0;
		max-width: 260px;
		font-size: 12.5px;
		color: var(--muted-foreground);
	}
	.status.bad {
		color: var(--bad);
	}

	/*
	 * Deliberately quiet. This is a readout that happens to be clickable, not a call to
	 * action, and the room is what should be lit up on this screen.
	 */
	.link {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		height: var(--h);
		padding: 0 13px;
		border-radius: var(--radius-md);
		border: 1px solid var(--border);
		background: var(--card-raised);
		color: var(--muted-foreground);
		font-size: 13px;
		font-weight: 500;
		transition:
			background-color 0.13s ease,
			border-color 0.13s ease,
			color 0.13s ease;
	}
	.link:hover {
		background: var(--muted);
		border-color: #33333c;
		color: var(--foreground);
	}
	.link.live {
		color: var(--foreground);
	}
	.link.warn {
		color: var(--warn);
	}
	.link.bad {
		color: var(--bad);
	}
	.link .label {
		font-variant-numeric: tabular-nums;
	}
</style>
