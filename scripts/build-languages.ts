import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import https from 'node:https';
import http from 'node:http';

const RELEASES_URL = 'https://api.github.com/repos/unicode-org/cldr-json/releases/latest';
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const OUTPUT_PATH = path.resolve('.resources/cldr/languages.json');
const CACHE_DIR = path.join(os.tmpdir(), 'cldr-languages-cache');

interface LanguageEntry {
	tag: string;
	subtag?: string;
	name: string;
}

interface LanguageData {
	[langCode: string]: string;
}

function delay(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchUrl(url: string, headers: Record<string, string> = {}): Promise<string> {
	return new Promise((resolve, reject) => {
		const protocol = url.startsWith('https') ? https : http;
		const req = protocol.get(url, { headers: { 'User-Agent': 'node', ...headers } }, (res) => {
			if (res.statusCode === 403 || res.statusCode === 429) {
				reject(new Error(`Rate limited or access denied (${res.statusCode})`));
				return;
			}
			if (res.statusCode !== 200) {
				reject(new Error(`HTTP ${res.statusCode}`));
				return;
			}
			let data = '';
			res.on('data', chunk => data += chunk);
			res.on('end', () => resolve(data));
		});
		req.on('error', reject);
		req.setTimeout(30000, () => {
			req.destroy();
			reject(new Error('Request timeout'));
		});
	});
}

async function downloadFile(url: string, destPath: string): Promise<void> {
	await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
	let finalUrl = url;
	let maxRedirects = 5;

	while (maxRedirects > 0) {
		const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
			const protocol = finalUrl.startsWith('https') ? https : http;
			const req = protocol.get(finalUrl, { headers: { 'User-Agent': 'node' } }, resolve);
			req.on('error', reject);
			req.setTimeout(60000, () => {
				req.destroy();
				reject(new Error('Download timeout'));
			});
		});

		if (response.statusCode === 302 || response.statusCode === 301) {
			const location = response.headers.location;
			if (location) {
				finalUrl = location.startsWith('http') ? location : new URL(location, finalUrl).toString();
				maxRedirects--;
				continue;
			}
		}

		if (response.statusCode !== 200) {
			throw new Error(`Download failed: HTTP ${response.statusCode}`);
		}

		await pipeline(response, createWriteStream(destPath));
		return;
	}
	throw new Error('Too many redirects');
}

function isLanguageDir(name: string): boolean {
	return !name.includes('-') && /^[a-z]{2,3}$/.test(name);
}

async function buildLanguagesJson(): Promise<LanguageData> {
	const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cldr-build-'));
	const tarPath = path.join(tempDir, 'cldr.tar.gz');
	const extractDir = path.join(tempDir, 'cldr');

	try {
		console.log('Fetching latest CLDR release info...');
		let releaseData: { assets?: Array<{ browser_download_url?: string; name?: string }>; tag_name?: string };
		let downloadUrl: string | undefined;
		let maxRetries = 3;

		for (let attempt = 0; attempt < maxRetries; attempt++) {
			try {
				const response = await fetchUrl(RELEASES_URL, { Accept: 'application/vnd.github.v3+json' });
				releaseData = JSON.parse(response);
				const asset = releaseData.assets?.find(a => a.name?.endsWith('-json-full.zip'));
				if (asset?.browser_download_url) {
					downloadUrl = asset.browser_download_url;
				}
				break;
			} catch (err) {
				if (attempt < maxRetries - 1) {
					console.log(`Attempt ${attempt + 1} failed, retrying in 2s...`);
					await delay(2000);
				} else {
					throw err;
				}
			}
		}

		if (!downloadUrl) {
			throw new Error('Could not find cldr-localenames-full.zip asset');
		}

		console.log(`Downloading CLDR from ${downloadUrl}...`);
		await downloadFile(downloadUrl, tarPath);

		console.log('Extracting archive...');
		const admZip = await import('adm-zip').then(m => new m.default(tarPath));
		admZip.extractAllTo(extractDir, true);

		const mainDir = path.join(extractDir, 'cldr-localenames-full', 'main');
		const entries = await fs.promises.readdir(mainDir, { withFileTypes: true });
		const langDirs = entries.filter(e => e.isDirectory() && isLanguageDir(e.name)).map(e => e.name);

		console.log(`Found ${langDirs.length} language directories`);
		const allLanguages: LanguageData = {};

		for (const langCode of langDirs) {
			const langJsonPath = path.join(mainDir, langCode, 'languages.json');
			if (!fs.existsSync(langJsonPath)) continue;

			try {
				const content = JSON.parse(await fs.promises.readFile(langJsonPath, 'utf-8'));
				const langSection = content?.main?.[langCode]?.localeDisplayNames?.languages;
				if (langSection && typeof langSection === 'object') {
					for (const [tag, name] of Object.entries(langSection)) {
						if (typeof name === 'string' && name.trim()) {
							allLanguages[tag] = name;
						}
					}
				}
			} catch (err) {
				console.warn(`Skipping ${langCode}: ${err}`);
			}
		}

		return allLanguages;
	} finally {
		await fs.promises.rm(tempDir, { recursive: true, force: true });
		console.log('Removed temporary files (cleaned up).');
	}
}

async function main() {
	const cachePath = path.join(CACHE_DIR, 'languages.json');

	let existingData: LanguageData = {};
	let needsRebuild = false;

	if (fs.existsSync(OUTPUT_PATH)) {
		try {
			existingData = JSON.parse(await fs.promises.readFile(OUTPUT_PATH, 'utf-8'));
			const stat = await fs.promises.stat(OUTPUT_PATH);
			const age = Date.now() - stat.mtimeMs;
			if (age < ONE_DAY_MS) {
				console.log('Using existing build/cldr/languages.json (less than 1 day old)');
				await fs.promises.writeFile(OUTPUT_PATH, JSON.stringify(existingData, null, 2), 'utf-8');
				return;
			}
			console.log('Existing file is stale, fetching fresh data...');
		} catch {
			needsRebuild = true;
		}
	} else {
		needsRebuild = true;
	}

	if (needsRebuild) {
		await fs.promises.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
		const languages = await buildLanguagesJson();
		await fs.promises.writeFile(OUTPUT_PATH, JSON.stringify(languages, null, 2), 'utf-8');
		console.log(`Wrote ${Object.keys(languages).length} languages to ${OUTPUT_PATH}`);
	}
}

main().catch(err => {
	console.error('Failed:', err);
	process.exit(1);
});