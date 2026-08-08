<script lang="ts">
	import Icon from './Icon.svelte';
	import type { IconName } from './icons.ts';

	let {
		value = $bindable(''),
		placeholder = '',
		icon,
		disabled = false,
		size = 'default',
		ariaLabel,
		element = $bindable(),
		onkeydown,
		oninput
	}: {
		value?: string;
		placeholder?: string;
		icon?: IconName;
		disabled?: boolean;
		size?: 'default' | 'sm';
		ariaLabel?: string;
		element?: HTMLInputElement;
		onkeydown?: (e: KeyboardEvent) => void;
		oninput?: (e: Event) => void;
	} = $props();
</script>

<div class="wrap {size}" class:has-icon={!!icon}>
	{#if icon}
		<span class="icon"><Icon name={icon} size={size === 'sm' ? 14 : 16} /></span>
	{/if}
	<input
		bind:this={element}
		bind:value
		type="text"
		{placeholder}
		{disabled}
		aria-label={ariaLabel ?? placeholder}
		{onkeydown}
		{oninput} />
</div>

<style>
	.wrap {
		position: relative;
		display: flex;
		align-items: center;
		width: 100%;
		min-width: 0;
	}
	.icon {
		position: absolute;
		left: 11px;
		display: grid;
		place-items: center;
		color: var(--subtle-foreground);
		pointer-events: none;
	}
	input {
		width: 100%;
		min-width: 0;
		height: var(--h);
		padding: 0 12px;
		background: var(--card-raised);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		color: var(--foreground);
		font-size: 13.5px;
		transition:
			border-color 0.13s ease,
			background-color 0.13s ease;
	}
	.has-icon input {
		padding-left: 35px;
	}
	.sm input {
		height: var(--h-sm);
		font-size: 13px;
	}
	.sm.has-icon input {
		padding-left: 31px;
	}
	input::placeholder {
		color: var(--subtle-foreground);
	}
	input:hover:not(:disabled) {
		border-color: #33333c;
	}
	input:focus {
		outline: none;
		border-color: var(--ring);
		background: var(--popover);
	}
	input:disabled {
		opacity: 0.5;
	}
</style>
