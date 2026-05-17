import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit(),
		{
            name: 'generate-manifest',
            // Use closeBundle to ensure all chunks are written and aliases are resolved
            async closeBundle() {
                try {
                    const { generateManifest } = await import('./scripts/generate-manifest.js');
                    await generateManifest();
                } catch (error) {
                    console.error('Failed to generate manifest:', error);
                }
            }
        },
	]
});
