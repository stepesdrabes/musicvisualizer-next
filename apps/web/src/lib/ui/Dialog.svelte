<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		open = false,
		onclose,
		labelledBy,
		children
	}: {
		open?: boolean;
		onclose: () => void;
		labelledBy?: string;
		children: Snippet;
	} = $props();

	let panel: HTMLDivElement | undefined = $state();

	/**
	 * Focus is trapped rather than merely moved: the dialog sits over a screen full of
	 * tabbable controls, and tabbing out of a command palette into the cue table behind it
	 * leaves the keyboard driving something the user cannot see.
	 */
	function onkeydown(e: KeyboardEvent) {
		if (!open) return;
		if (e.key === 'Escape') {
			e.stopPropagation();
			onclose();
			return;
		}
		if (e.key !== 'Tab' || !panel) return;
		const focusable = panel.querySelectorAll<HTMLElement>(
			'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
		);
		if (focusable.length === 0) return;
		const first = focusable[0];
		const last = focusable[focusable.length - 1];
		if (e.shiftKey && document.activeElement === first) {
			e.preventDefault();
			last.focus();
		} else if (!e.shiftKey && document.activeElement === last) {
			e.preventDefault();
			first.focus();
		}
	}
</script>

<svelte:window on:keydown={onkeydown} />

{#if open}
	<div class="backdrop" onclick={onclose} role="presentation"></div>
	<div
		class="panel"
		bind:this={panel}
		role="dialog"
		aria-modal="true"
		aria-labelledby={labelledBy}>
		{@render children()}
	</div>
{/if}

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		background: #05050799;
		backdrop-filter: blur(3px);
		z-index: 60;
		animation: fade 0.14s ease-out;
	}
	.panel {
		position: fixed;
		top: 12vh;
		left: 50%;
		translate: -50% 0;
		width: min(640px, calc(100vw - 32px));
		max-height: 70vh;
		display: flex;
		flex-direction: column;
		background: var(--popover);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-lg);
		overflow: hidden;
		z-index: 61;
		animation: rise 0.16s cubic-bezier(0.16, 1, 0.3, 1);
	}
	@keyframes fade {
		from {
			opacity: 0;
		}
	}
	@keyframes rise {
		from {
			opacity: 0;
			translate: -50% 8px;
			scale: 0.985;
		}
	}
</style>
