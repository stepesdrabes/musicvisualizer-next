<script lang="ts">
	import type { LinkState } from '$lib/hardware.ts';

	let { state, size = 7 }: { state: LinkState; size?: number } = $props();
</script>

<!-- Shape carries nothing; colour and motion do. Only a live stream pulses, so a glance at
     the top bar tells a board that is merely reachable from one that is being fed. -->
<span class="dot {state}" style:width={`${size}px`} style:height={`${size}px`}></span>

<style>
	.dot {
		display: inline-block;
		border-radius: 50%;
		flex: none;
		background: var(--subtle-foreground);
	}
	.unconfigured {
		background: #3f3f47;
	}
	.searching {
		background: var(--muted-foreground);
		animation: breathe 1.1s ease-in-out infinite;
	}
	.offline {
		background: var(--bad);
	}
	.online {
		background: var(--muted-foreground);
	}
	.streaming {
		background: var(--ok);
		animation: breathe 1.6s ease-in-out infinite;
	}
	.degraded {
		background: var(--warn);
		animation: breathe 0.8s ease-in-out infinite;
	}
	@keyframes breathe {
		50% {
			opacity: 0.35;
		}
	}
</style>
