import fs from 'node:fs';
import path from 'node:path';

// Using a standard dynamic import or relative path for package.json
import pkg from '../package.json' with { type: 'json' };

export function generateManifest(options = { baseAssetPath: 'static' }) {
  const manifest = {
    "manifest_version": 3,
    "name": pkg.name,
    "version": pkg.version,
    "description": pkg.description,
    "permissions": [
      "storage",
      "unlimitedStorage",
      "alarms",
      "activeTab",
      "scripting"
    ],
    "host_permissions": [
      "<all_urls>"
    ],
    "browser_specific_settings": {
      "gecko": {
        "id": "iikiti@example.com"
      }
    },
    "background": {
      "scripts": ["background.js"],
      "type": "module"
    },
    // Reference the relative paths as they will exist inside your /build directory
    "icons": {
      "16": `${options.baseAssetPath}/img/iikiti.webp`,
      "32": `${options.baseAssetPath}/img/iikiti.webp`,
      "48": `${options.baseAssetPath}/img/iikiti.webp`,
      "128": `${options.baseAssetPath}/img/iikiti.webp`
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
        "resources": ["popup/index.html", "reader/index.html", "static/**/*"],
        "matches": ["<all_urls>"]
      }
    ]
  };

  // Ensure the build directory exists before writing
  const outputPath = path.resolve('build');
  if (!fs.existsSync(outputPath)) {
    fs.mkdirSync(outputPath, { recursive: true });
  }

  fs.writeFileSync(
    path.join(outputPath, 'manifest.json'), 
    JSON.stringify(manifest, null, 2)
  );
  
  console.log('Manifest.json generated successfully in /build');
}