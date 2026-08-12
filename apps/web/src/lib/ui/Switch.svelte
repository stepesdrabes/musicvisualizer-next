<script lang="ts">
	let {
		checked = false,
		ariaLabel,
		onchange
	}: {
		checked?: boolean;
		ariaLabel: string;
		onchange: (on: boolean) => void;
	} = $props();
</script>

<!--
	The app's other booleans are segmented pickers, which is right for a choice between two named
	things - a backend, a vocabulary. This is for the other kind: a thing that is simply on or off,
	where naming the off state costs a word that says nothing.
-->
<button
	class="switch"
	class:on={checked}
	role="switch"
	aria-checked={checked}
	aria-label={ariaLabel}
	onclick={() => onchange(!checked)}>
	<span class="knob"></span>
</button>

<style>
	.switch {
		position: relative;
		width: 38px;
		height: 22px;
		flex: none;
		border-radius: 999px;
		background: var(--muted);
		box-shadow: inset 0 0 0 1px var(--border);
		transition:
			background-color 0.18s ease,
			box-shadow 0.18s ease;
	}
	.switch:hover {
		background: var(--hover);
	}
	/* The accent, spent on a state that is genuinely live: the room is being lit by this. */
	.switch.on {
		background: var(--live);
		box-shadow: inset 0 0 0 1px #00000038;
	}
	.switch.on:hover {
		background: color-mix(in srgb, var(--live) 88%, #fff);
	}

	.knob {
		position: absolute;
		top: 3px;
		left: 3px;
		width: 16px;
		height: 16px;
		border-radius: 50%;
		background: var(--foreground);
		box-shadow: 0 1px 3px #00000073;
		transition: translate 0.18s cubic-bezier(0.16, 1, 0.3, 1);
	}
	.switch.on .knob {
		translate: 16px 0;
		background: #fff;
	}
</style>
