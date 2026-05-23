import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit(),
		{
			name: 'generate-manifest',
			apply: 'build',
			async closeBundle() {
				const { generateManifest } = await import('./scripts/generate-manifest.ts');
				generateManifest();
			}
		},
	],
});