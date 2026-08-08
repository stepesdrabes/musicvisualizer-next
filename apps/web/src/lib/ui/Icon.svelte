<script lang="ts">
	import { GLYPHS, type IconName } from './icons.ts';

	let {
		name,
		size = 16,
		fill = false,
		strokeWidth = 2
	}: {
		name: IconName;
		size?: number;
		/** Solid rather than stroked. The transport glyphs read better filled. */
		fill?: boolean;
		strokeWidth?: number;
	} = $props();

	const Glyph = $derived(GLYPHS[name]);
</script>

<Glyph {size} {strokeWidth} fill={fill ? 'currentColor' : 'none'} />

<style>
	:global(.lucide-icon) {
		display: block;
		flex: none;
	}
</style>
