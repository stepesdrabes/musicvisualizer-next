import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	// lucide-svelte ships uncompiled .svelte files. Left external, the SSR pass hands them to
	// Node, which has no idea what a .svelte file is; bundling them lets the Svelte plugin
	// compile them first.
	ssr: { noExternal: ['lucide-svelte'] },
	// Bound to every interface so a phone on the same network can reach the queue. The queue
	// is server state precisely so that people in the room can add to it from their own
	// devices, and that is impossible from localhost only.
	server: { port: 5180, host: true }
});
