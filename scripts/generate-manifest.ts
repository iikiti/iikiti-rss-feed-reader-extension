import fs from 'node:fs';
import path from 'node:path';
import pkg from '../package.json' with { type: 'json' };

export function generateManifest() {
	const buildDir = path.resolve('build');
	let iconPath = 'internal/immutable/assets/iikiti.webp'; // Fallback

	// 1. Path to SvelteKit's native asset manifest file
	const svelteKitManifestPath = path.resolve('.svelte-kit/output/client/_app/immutable/manifest.json');

	if (fs.existsSync(svelteKitManifestPath)) {
		const manifestData = JSON.parse(fs.readFileSync(svelteKitManifestPath, 'utf-8'));

		// 2. Find the entry ending with your image filename
		const hashedAssetKey = Object.keys(manifestData).find(key => key.endsWith('iikiti.webp'));

		if (hashedAssetKey) {
			// SvelteKit keys map to things like "_app/immutable/assets/iikiti.7sNKNBi0.webp"
			// We map it to your final output structure: "internal/immutable/assets/..."
			const assetFilename = path.basename(hashedAssetKey);
			iconPath = `internal/immutable/assets/${assetFilename}`;
		}
	} else {
		// Strategy B: If running post-adapter, look directly at the output folder
		const finalAssetDir = path.join(buildDir, 'internal/immutable/assets');
		if (fs.existsSync(finalAssetDir)) {
			const files = fs.readdirSync(finalAssetDir);
			const matchedFile = files.find(f => f.startsWith('iikiti') && f.endsWith('.webp'));
			if (matchedFile) {
				iconPath = `internal/immutable/assets/${matchedFile}`;
			}
		}
	}

	// 3. Define the Web Extension manifest
	const manifest = {
		"manifest_version": 3,
		"name": pkg.name,
		"version": pkg.version,
		"description": pkg.description,
		"permissions": ["storage", "unlimitedStorage", "alarms", "activeTab", "scripting"],
		"host_permissions": ["<all_urls>"],
		"browser_specific_settings": {
			"gecko": { "id": "iikiti@example.com" }
		},
		"background": {
			"scripts": ["background.js"],
			"type": "module"
		},
		"icons": {
			"16": iconPath,
			"32": iconPath,
			"48": iconPath,
			"128": iconPath
		},
		"action": {
			"default_popup": "popup/index.html",
			"default_title": "iikiti Feed Reader"
		},
		"options_ui": {
			"page": "reader/index.html",
			"open_in_tab": true
		},
		"content_scripts": [
			{
				"matches": ["<all_urls>"],
				"js": ["content.js"],
				"run_at": "document_end"
			}
		],
		"web_accessible_resources": [
			{
				"resources": ["popup/index.html", "reader/index.html", "internal/**/*"],
				"matches": ["<all_urls>"]
			}
		]
	};

	// 4. Write out the finalized extension manifest
	fs.writeFileSync(
		path.join(buildDir, 'manifest.json'),
		JSON.stringify(manifest, null, 2)
	);

	console.log(`Manifest.json written. Icon successfully matched to: ${iconPath}`);
}