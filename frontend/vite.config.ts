import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		fs: {
			// package.json is imported for the app version in +layout.svelte
			allow: ['.']
		}
	}
});
