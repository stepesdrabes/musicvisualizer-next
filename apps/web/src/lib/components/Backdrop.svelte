<script lang="ts">
	let { thumbnail = '' }: { thumbnail?: string } = $props();
</script>

<!--
	The cover, blurred past recognition, as the room's ambient light.

	Blurred this hard it carries no detail and no edges - only the record's own colour, which
	is the one thing about a track the chrome can honestly borrow. Keyed on the URL so a track
	change cross-fades rather than cutting.
-->
<div class="backdrop" aria-hidden="true">
	{#key thumbnail}
		{#if thumbnail}
			<img src={thumbnail} alt="" />
		{/if}
	{/key}
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 0;
		overflow: hidden;
		pointer-events: none;
		background: var(--background);
	}
	img {
		position: absolute;
		/* Overscanned, because a blur of this radius samples transparency past the edges and
		   would otherwise draw a pale frame around the whole window. */
		inset: -25%;
		width: 150%;
		height: 150%;
		object-fit: cover;
		/* Enough blur that no edge survives; the saturation lift puts back what a blur this
		   wide averages away. Opacity is the one dial worth tuning - past about 0.45 the wash
		   starts competing with the LEDs, which is the one thing it must never do. */
		filter: blur(90px) saturate(1.7);
		opacity: 0.4;
		animation: fade 0.6s ease-out;
	}
	@keyframes fade {
		from {
			opacity: 0;
		}
	}
</style>
