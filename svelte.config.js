import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),

	kit: {
	adapter: adapter({
	fallback: 'app.html' // SPA fallback
	}),
		    appDir: 'internal', // Make it cleaner for extension
	prerender: {
		handleHttpError: ({ path, referrer, message }) => {
			// Ignore 404s for favicon during prerender
			if (path.includes('.webp') && message.includes('404')) {
				return;
			}
			throw new Error(message);
		}
	},
	csp: {
	directives: {
	'script-src': ['self']
	}
	}
	}
};

export default config;
