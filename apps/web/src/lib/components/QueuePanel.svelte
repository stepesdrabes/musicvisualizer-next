<script lang="ts">
	import type { QueueItem } from '$lib/queueModel.ts';
	import { clock } from '$lib/format.ts';
	import Icon from '$lib/ui/Icon.svelte';
	import Button from '$lib/ui/Button.svelte';
	import Badge from '$lib/ui/Badge.svelte';
	import Spinner from '$lib/ui/Spinner.svelte';
	import RoomInvite from './RoomInvite.svelte';

	let {
		items = [],
		currentKey = null,
		playing = false,
		onjump,
		onremove,
		onplayNext,
		onmove,
		onretry,
		onclear,
		onsearch
	}: {
		items?: QueueItem[];
		currentKey?: string | null;
		playing?: boolean;
		onjump: (key: string) => void;
		onremove: (key: string) => void;
		onplayNext: (key: string) => void;
		onmove: (key: string, to: number) => void;
		onretry: (key: string) => void;
		onclear: () => void;
		onsearch: () => void;
	} = $props();

	let dragKey = $state<string | null>(null);
	let dragOver = $state<number | null>(null);

	const upNext = $derived(items.length - 1 - items.findIndex((i) => i.key === currentKey));

	function statusLabel(item: QueueItem): string {
		return item.status === 'error' ? item.message || 'Failed' : item.message;
	}

	function drop(index: number) {
		if (dragKey) onmove(dragKey, index);
		dragKey = null;
		dragOver = null;
	}
</script>

<aside class="floats">
	<header>
		<h2>Queue</h2>
		{#if items.length > 0}
			<span class="count mono subtle">{items.length}</span>
			<Button variant="ghost" size="icon-sm" title="Clear everything but the current track" onclick={onclear}>
				<Icon name="trash" size={14} />
			</Button>
		{/if}
	</header>

	<div class="list">
		{#each items as item, i (item.key)}
			{@const isCurrent = item.key === currentKey}
			<div
				class="row"
				class:current={isCurrent}
				class:over={dragOver === i}
				class:failed={item.status === 'error'}
				draggable="true"
				role="listitem"
				ondragstart={() => (dragKey = item.key)}
				ondragend={() => {
					dragKey = null;
					dragOver = null;
				}}
				ondragover={(e) => {
					e.preventDefault();
					dragOver = i;
				}}
				ondrop={(e) => {
					e.preventDefault();
					drop(i);
				}}>
				<button class="hit" onclick={() => onjump(item.key)} aria-label={`Play ${item.title}`}>
					<span class="art">
						{#if item.thumbnail}
							<img src={item.thumbnail} alt="" loading="lazy" />
						{:else}
							<Icon name="music" size={15} />
						{/if}
						{#if isCurrent}
							<span class="overlay">
								{#if playing}
									<span class="bars"><i></i><i></i><i></i></span>
								{:else}
									<Icon name="play" size={13} fill />
								{/if}
							</span>
						{/if}
					</span>

					<span class="text">
						<span class="title truncate">{item.title}</span>
						<span class="sub truncate">
							{#if item.status === 'error'}
								<span class="bad">{statusLabel(item)}</span>
							{:else if item.status !== 'ready' && item.status !== 'pending'}
								<Spinner size={10} />
								<span class="muted">{statusLabel(item)}</span>
							{:else if item.addedBy}
								<span class="guest">{item.addedBy}</span>
							{:else}
								<span class="muted">{item.uploader}</span>
							{/if}
						</span>
					</span>
				</button>

				<div class="right">
					{#if item.authored === 'claude'}
						<Badge variant="live" title="Claude designed this show">
							<Icon name="sparkles" size={11} />
						</Badge>
					{/if}
					{#if item.duration > 0}
						<span class="mono subtle time">{clock(item.duration)}</span>
					{/if}
					<div class="tools">
						{#if item.status === 'error'}
							<Button variant="ghost" size="icon-sm" title="Try again" onclick={() => onretry(item.key)}>
								<Icon name="retry" size={13} />
							</Button>
						{:else if !isCurrent}
							<Button
								variant="ghost"
								size="icon-sm"
								title="Play next"
								onclick={() => onplayNext(item.key)}>
								<Icon name="playNext" size={13} />
							</Button>
						{/if}
						<Button variant="ghost" size="icon-sm" title="Remove" onclick={() => onremove(item.key)}>
							<Icon name="x" size={13} />
						</Button>
					</div>
				</div>
			</div>

			{#if isCurrent && upNext > 0}
				<p class="divider">Up next</p>
			{/if}
		{/each}

		{#if items.length === 0}
			<div class="empty">
				<Icon name="listMusic" size={22} />
				<p>Nothing queued yet.</p>
				<Button size="sm" onclick={onsearch}>
					<Icon name="search" size={14} />
					Find a track
				</Button>
			</div>
		{/if}
	</div>

	<RoomInvite />
</aside>

<style>
	aside {
		width: var(--rail-left);
		flex: none;
		display: flex;
		flex-direction: column;
		min-height: 0;
		background: var(--panel);
		backdrop-filter: var(--panel-blur);
		border-right: 1px solid var(--border);
	}

	header {
		display: flex;
		align-items: center;
		gap: 8px;
		height: 46px;
		flex: none;
		padding: 0 10px 0 16px;
		border-bottom: 1px solid var(--border);
	}
	h2 {
		font-size: 13.5px;
		font-weight: 600;
	}
	.count {
		margin-left: auto;
	}

	.list {
		flex: 1;
		overflow-y: auto;
		min-height: 0;
		padding: 6px;
	}

	.row {
		position: relative;
		display: flex;
		align-items: center;
		border-radius: var(--radius-md);
		transition: background-color 0.12s ease;
	}
	.row:hover {
		background: var(--muted);
	}
	.row.current {
		background: var(--card-raised);
	}
	.row.over {
		box-shadow: inset 0 2px 0 var(--foreground);
	}
	.row.failed .title {
		color: var(--muted-foreground);
	}

	.hit {
		display: flex;
		align-items: center;
		gap: 10px;
		flex: 1;
		min-width: 0;
		/* The trailing space is the gap to the duration; without it a long title truncates
		   hard against the clock and the two read as one string. */
		padding: 7px 12px 7px 8px;
		text-align: left;
	}

	.art {
		position: relative;
		width: 40px;
		height: 40px;
		flex: none;
		display: grid;
		place-items: center;
		border-radius: var(--radius-sm);
		overflow: hidden;
		background: var(--muted);
		color: var(--subtle-foreground);
	}
	.art img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	.overlay {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		background: #0a0a0bad;
		color: var(--foreground);
	}
	/* Three bars, so a glance at the panel says which row is making the sound. */
	.bars {
		display: flex;
		align-items: flex-end;
		gap: 2px;
		height: 13px;
	}
	.bars i {
		width: 2.5px;
		background: var(--foreground);
		border-radius: 1px;
		animation: bounce 0.9s ease-in-out infinite;
	}
	.bars i:nth-child(1) {
		height: 60%;
	}
	.bars i:nth-child(2) {
		height: 100%;
		animation-delay: 0.18s;
	}
	.bars i:nth-child(3) {
		height: 45%;
		animation-delay: 0.36s;
	}
	@keyframes bounce {
		50% {
			height: 25%;
		}
	}

	.text {
		display: flex;
		flex-direction: column;
		min-width: 0;
		gap: 1px;
	}
	.title {
		font-size: 13px;
		font-weight: 500;
	}
	.sub {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 12px;
	}
	.bad {
		color: var(--bad);
	}
	/* Named rather than coloured: whose track it is matters, which guest it is does not. */
	.guest {
		color: var(--muted-foreground);
		font-weight: 500;
	}

	.right {
		display: flex;
		align-items: center;
		gap: 6px;
		padding-right: 6px;
		flex: none;
	}
	.time {
		font-size: 11.5px;
	}
	.tools {
		display: none;
		gap: 1px;
	}
	.row:hover .tools {
		display: flex;
	}
	/* The clock and the tools occupy the same corner; showing both would reflow on hover. */
	.row:hover .time {
		display: none;
	}

	.divider {
		padding: 12px 10px 6px;
		font-size: 12px;
		font-weight: 500;
		color: var(--subtle-foreground);
	}

	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
		padding: 48px 20px;
		text-align: center;
		color: var(--subtle-foreground);
	}
	.empty p {
		font-size: 13px;
	}
</style>
