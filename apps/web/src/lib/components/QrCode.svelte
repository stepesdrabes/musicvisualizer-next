<script lang="ts">
	import { encode } from 'uqr';

	let {
		value,
		size = 160,
		quiet = 2
	}: {
		value: string;
		size?: number;
		/** Modules of empty margin. The spec says four; two scans fine on a lit screen. */
		quiet?: number;
	} = $props();

	const code = $derived(encode(value, { ecc: 'M' }));
	const span = $derived(code.size + quiet * 2);

	/**
	 * One path for every dark module rather than one rect each.
	 *
	 * A version-4 code is about 900 modules, and 900 elements is a lot of DOM for something
	 * that never changes between renders. Drawn light-on-dark to match everything else, which
	 * scanners handle as readily as the other way round.
	 */
	const path = $derived(
		code.data
			.flatMap((row, y) =>
				row.map((on, x) => (on ? `M${x + quiet} ${y + quiet}h1v1h-1z` : ''))
			)
			.join('')
	);
</script>

<svg
	viewBox={`0 0 ${span} ${span}`}
	width={size}
	height={size}
	shape-rendering="crispEdges"
	role="img"
	aria-label="Scan to join the room">
	<rect width={span} height={span} fill="#09090b" />
	<path d={path} fill="#fafafa" />
</svg>

<style>
	svg {
		display: block;
		border-radius: var(--radius-sm);
	}
</style>
