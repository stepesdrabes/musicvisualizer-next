<script lang="ts">
	let { size = 14, accent = false }: { size?: number; accent?: boolean } = $props();
</script>

<span
	class="spinner"
	class:accent
	style:width={`${size}px`}
	style:height={`${size}px`}
	style:border-width={`${Math.max(1.5, size / 9)}px`}></span>

<style>
	.spinner {
		display: inline-block;
		border-radius: 50%;
		border-style: solid;
		border-color: #ffffff1f;
		border-top-color: var(--muted-foreground);
		animation: spin 0.7s linear infinite;
		flex: none;
	}
	.accent {
		border-top-color: var(--live);
	}
</style>
