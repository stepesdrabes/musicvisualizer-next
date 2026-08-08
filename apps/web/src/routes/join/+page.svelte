<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { loadGuest, saveGuest } from '$lib/guest.svelte.ts';
	import Icon from '$lib/ui/Icon.svelte';
	import Spinner from '$lib/ui/Spinner.svelte';

	const token = $derived(page.url.searchParams.get('t') ?? '');

	let name = $state('');
	let busy = $state(false);
	let failure = $state('');

	// Somebody who has been here before only has to scan; the name is already on the phone.
	$effect(() => {
		const known = loadGuest();
		if (known) name = known.name;
	});

	async function join() {
		const trimmed = name.trim();
		if (!trimmed || busy) return;
		busy = true;
		failure = '';
		try {
			const res = await fetch('/api/guest', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ action: 'join', token, name: trimmed })
			});
			if (!res.ok) throw new Error((await res.text()).slice(0, 200));
			saveGuest({ token, name: trimmed });
			await goto('/guest');
		} catch (e) {
			failure = (e as Error).message;
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>Join the room</title></svelte:head>

<main>
	<span class="bolt"><Icon name="bolt" size={20} fill /></span>
	<h1>LightningStrike</h1>

	{#if token}
		<p class="lead">Put your name to the tracks you add.</p>
		<form onsubmit={(e) => (e.preventDefault(), join())}>
			<input
				bind:value={name}
				type="text"
				placeholder="Your name"
				maxlength="24"
				autocomplete="nickname"
				autocapitalize="words"
				enterkeyhint="go" />
			<button type="submit" disabled={busy || !name.trim()}>
				{#if busy}<Spinner size={15} />{/if}
				Join
			</button>
		</form>
		{#if failure}<p class="bad">{failure}</p>{/if}
	{:else}
		<p class="lead">This link has no room code in it. Scan the QR on the screen again.</p>
	{/if}
</main>

<style>
	main {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 14px;
		min-height: 100svh;
		padding: 32px 24px calc(32px + env(safe-area-inset-bottom));
		text-align: center;
	}
	.bolt {
		display: grid;
		place-items: center;
		width: 46px;
		height: 46px;
		border-radius: 13px;
		background: var(--foreground);
		color: var(--primary-foreground);
	}
	h1 {
		font-size: 21px;
		font-weight: 600;
		letter-spacing: -0.02em;
	}
	.lead {
		font-size: 15px;
		color: var(--muted-foreground);
		max-width: 30ch;
		line-height: 1.5;
	}
	form {
		display: flex;
		flex-direction: column;
		gap: 10px;
		width: min(340px, 100%);
		margin-top: 6px;
	}
	input {
		/* 16px or larger, or iOS zooms the whole page when the field takes focus. */
		height: 52px;
		padding: 0 16px;
		font-size: 16px;
		text-align: center;
		background: var(--card-raised);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		color: var(--foreground);
	}
	input:focus {
		outline: none;
		border-color: var(--ring);
	}
	button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		height: 52px;
		border-radius: var(--radius-md);
		background: var(--primary);
		color: var(--primary-foreground);
		font-size: 16px;
		font-weight: 600;
	}
	button:disabled {
		opacity: 0.4;
	}
	.bad {
		color: var(--bad);
		font-size: 14px;
		max-width: 32ch;
	}
</style>
