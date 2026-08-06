import adapter from '@sveltejs/adapter-node';

export default {
	kit: {
		adapter: adapter(),
		alias: { $components: 'src/lib/components' }
	}
};
