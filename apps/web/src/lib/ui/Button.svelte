<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		variant = 'secondary',
		size = 'default',
		disabled = false,
		title,
		ariaLabel,
		type = 'button',
		onclick,
		children
	}: {
		variant?: 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger';
		size?: 'default' | 'sm' | 'icon' | 'icon-sm';
		disabled?: boolean;
		title?: string;
		ariaLabel?: string;
		type?: 'button' | 'submit';
		onclick?: (e: MouseEvent) => void;
		children: Snippet;
	} = $props();
</script>

<button class="btn {variant} {size}" {type} {disabled} {title} aria-label={ariaLabel} {onclick}>
	{@render children()}
</button>

<style>
	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 7px;
		height: var(--h);
		padding: 0 14px;
		border-radius: var(--radius-md);
		border: 1px solid transparent;
		font-size: 13.5px;
		font-weight: 500;
		white-space: nowrap;
		transition:
			background-color 0.13s ease,
			border-color 0.13s ease,
			color 0.13s ease,
			opacity 0.13s ease;
	}
	.btn:disabled {
		opacity: 0.4;
	}

	.primary {
		background: var(--primary);
		color: var(--primary-foreground);
		font-weight: 600;
	}
	.primary:hover:not(:disabled) {
		background: #fff;
	}

	.secondary {
		background: var(--muted);
		color: var(--foreground);
		border-color: var(--border);
	}
	.secondary:hover:not(:disabled) {
		background: var(--hover);
		border-color: #33333c;
	}

	.outline {
		border-color: var(--border);
		color: var(--muted-foreground);
	}
	.outline:hover:not(:disabled) {
		background: var(--muted);
		color: var(--foreground);
	}

	.ghost {
		color: var(--muted-foreground);
	}
	.ghost:hover:not(:disabled) {
		background: var(--muted);
		color: var(--foreground);
	}

	.danger {
		color: var(--bad);
	}
	.danger:hover:not(:disabled) {
		background: #f871711f;
	}

	.sm {
		height: var(--h-sm);
		padding: 0 11px;
		font-size: 13px;
	}
	.icon {
		width: var(--h);
		padding: 0;
	}
	.icon-sm {
		width: var(--h-sm);
		height: var(--h-sm);
		padding: 0;
		border-radius: var(--radius-sm);
	}
</style>
