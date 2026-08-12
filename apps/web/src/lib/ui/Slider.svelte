<script lang="ts">
	let {
		value = $bindable(0),
		min = 0,
		max = 1,
		step = 0.01,
		width,
		track,
		ariaLabel,
		oninput,
		onchange
	}: {
		value?: number;
		min?: number;
		max?: number;
		step?: number;
		width?: string;
		/**
		 * A CSS background for the track, replacing the filled-to-the-thumb gradient.
		 *
		 * For the sliders where the value IS a colour: filling one of those to the thumb says the
		 * hue at 200 degrees is more of something than the hue at 100, which it is not.
		 */
		track?: string;
		ariaLabel: string;
		/** For owners that keep the value somewhere a two-way binding cannot reach. */
		oninput?: (v: number) => void;
		/** Once, on release. For an owner that persists the value rather than just following it. */
		onchange?: (v: number) => void;
	} = $props();

	const pct = $derived(max > min ? ((value - min) / (max - min)) * 100 : 0);
</script>

<input
	class="slider"
	type="range"
	{min}
	{max}
	{step}
	bind:value
	aria-label={ariaLabel}
	oninput={(e) => oninput?.(Number(e.currentTarget.value))}
	onchange={(e) => onchange?.(Number(e.currentTarget.value))}
	style:width
	style:--pct={`${pct}%`}
	style:--track={track} />

<style>
	.slider {
		appearance: none;
		height: 16px;
		background: transparent;
		cursor: pointer;
		margin: 0;
	}
	.slider::-webkit-slider-runnable-track {
		height: 4px;
		border-radius: 999px;
		/* The filled portion is the track itself rather than a second element, so the thumb
		   cannot drift away from the boundary between filled and empty. */
		background: var(
			--track,
			linear-gradient(to right, var(--foreground) var(--pct), var(--muted) var(--pct))
		);
	}
	.slider::-moz-range-track {
		height: 4px;
		border-radius: 999px;
		background: var(
			--track,
			linear-gradient(to right, var(--foreground) var(--pct), var(--muted) var(--pct))
		);
	}
	.slider::-webkit-slider-thumb {
		appearance: none;
		width: 12px;
		height: 12px;
		margin-top: -4px;
		border-radius: 50%;
		background: var(--foreground);
		/* A ring as well as a shadow, so the thumb is still findable over a bright track. */
		box-shadow:
			0 0 0 1.5px #000000a6,
			0 1px 3px #000000a6;
		transition: transform 0.12s ease;
	}
	.slider::-moz-range-thumb {
		width: 12px;
		height: 12px;
		border: none;
		border-radius: 50%;
		background: var(--foreground);
		box-shadow: 0 0 0 1.5px #000000a6;
	}
	.slider:hover::-webkit-slider-thumb {
		transform: scale(1.15);
	}
</style>
