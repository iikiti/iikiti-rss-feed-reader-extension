<script lang="ts">
import { onMount } from 'svelte';
import { browser } from '$app/environment';
import { db, getAllUsers, getCurrentUserId, setCurrentUserId, createUser, deleteUser, renameUser, type User, type Feed, type Folder } from '$lib/db';
import Modal from '$lib/components/Modal.svelte';
import { darkMode, setDarkMode, type DarkModeOption } from '$lib/stores/darkMode';
import { allUserSettings, setUserSetting, getUserSettingsSnapshot } from '$lib/stores/settings';
import { resolve } from '$app/paths';

let refreshInterval = 15;
let users: User[] = [];
let feeds: Feed[] = [];
let folders: Folder[] = [];
let currentUserId: number | null = null;
let showUserModal = false;
let newUserName = '';
let dbUsage = 'Calculating...';
let opmlImportError = '';

// Hidden file input for OPML import
let fileInput: HTMLInputElement | null = null;

onMount(async () => {
	if (browser) {
		await loadData();
		if (currentUserId !== null) {
			const settings = getUserSettingsSnapshot($allUserSettings, currentUserId);
			refreshInterval = settings.refreshInterval;
		}
		// Calculate IndexedDB storage usage
		try {
			if (navigator.storage && navigator.storage.estimate) {
				const estimate = await navigator.storage.estimate();
				const used = estimate.usage ?? 0;
				const quota = estimate.quota ?? 0;
				const usedMB = (used / 1024 / 1024).toFixed(2);
				const quotaMB = (quota / 1024 / 1024).toFixed(0);
				dbUsage = `${usedMB} MB used of ${quotaMB} MB`;
			} else {
				dbUsage = 'Not available';
			}
		} catch {
			dbUsage = 'Unable to calculate';
		}
	}
});

async function loadData() {
	users = await getAllUsers();
	currentUserId = await getCurrentUserId();
	if (currentUserId !== null) {
		feeds = await db.feeds.where('userId').equals(currentUserId).toArray();
		folders = await db.folders.where('userId').equals(currentUserId).toArray();
	}
}

async function updateRefreshInterval(event: Event) {
	const target = event.target as HTMLSelectElement;
	refreshInterval = parseInt(target.value, 10);
	if (browser && currentUserId !== null) {
		await setUserSetting(currentUserId, 'refreshInterval', refreshInterval);
	}
}

async function handleCreateUser() {
	if (!newUserName.trim()) return;
	await createUser(newUserName.trim());
	newUserName = '';
	showUserModal = false;
	await loadData();
}

async function handleDeleteUser(userId: number) {
	if (users.length <= 1) {
		alert('Cannot delete the last user. At least one user is required.');
		return;
	}
	if (confirm('Are you sure you want to delete this user? All their feeds, articles, and settings will be permanently deleted.')) {
		await deleteUser(userId);
		await loadData();
	}
}

async function handleRenameUser(userId: number) {
	const user = users.find(u => u.id === userId);
	if (!user) return;

	const newName = prompt('Enter new name:', user.name);
	if (newName && newName.trim() && newName.trim() !== user.name) {
		await renameUser(userId, newName.trim());
		await loadData();
	}
}

async function handleSwitchUser(userId: number) {
	await setCurrentUserId(userId);
	currentUserId = userId;
	if (browser) {
		window.location.reload();
	}
}

function openAddUserModal() {
	newUserName = '';
	showUserModal = true;
}

// ── OPML Export ──────────────────────────────────────────────────────────

function escapeXml(str: string): string {
	return str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function handleExportOPML() {
	const lines: string[] = [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<opml version="2.0">',
		'  <head>',
		`    <title>${escapeXml('iikiti Feeds')}</title>`,
		'  </head>',
		'  <body>',
	];

	// Render folder subtree recursively, starting from root (parentId === undefined)
	function renderOutlines(parentFolderId: number | undefined, indent: string) {
		// Child folders at this level
		for (const folder of folders.filter(f => f.parentId === parentFolderId)) {
			lines.push(`${indent}<outline text="${escapeXml(folder.name)}" title="${escapeXml(folder.name)}">`);
			renderOutlines(folder.id, indent + '  ');
			lines.push(`${indent}</outline>`);
		}
		// Feeds at this level
		for (const feed of feeds.filter(f => f.folderId === parentFolderId)) {
			lines.push(
				`${indent}<outline type="rss" text="${escapeXml(feed.title)}" title="${escapeXml(feed.title)}" xmlUrl="${escapeXml(feed.url)}"/>`
			);
		}
	}

	renderOutlines(undefined, '    ');

	lines.push('  </body>', '</opml>');

	const blob = new Blob([lines.join('\n')], { type: 'text/xml' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = 'iikiti-feeds.opml';
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}

// ── OPML Import ──────────────────────────────────────────────────────────

function triggerImportPicker() {
	opmlImportError = '';
	fileInput?.click();
}

async function handleImportFileSelected(event: Event) {
	const input = event.target as HTMLInputElement;
	const file = input.files?.[0];
	if (!file || currentUserId === null) return;

	// Reset so the same file can be re-selected if needed
	input.value = '';

	try {
		await importOPML(file, currentUserId);
	} catch (err) {
		opmlImportError = err instanceof Error ? err.message : String(err);
	}
}

async function importOPML(file: File, userId: number) {
	const text = await file.text();
	const parser = new DOMParser();
	const doc = parser.parseFromString(text, 'text/xml');

	if (doc.querySelector('parseerror')) {
		throw new Error('Invalid OPML file — could not parse XML.');
	}

	let imported = 0;
	let skipped = 0;

	// Recursively process <outline> elements.
	// Outlines with xmlUrl are feeds; those without (but with children) are folders.
	async function processOutline(outline: Element, parentFolderId: number | undefined) {
		const xmlUrl = outline.getAttribute('xmlUrl');
		const title = (outline.getAttribute('title') || outline.getAttribute('text') || '').trim();

		if (xmlUrl) {
			// Feed outline
			const existing = await db.feeds.where('url').equals(xmlUrl).first();
			if (!existing) {
				await db.feeds.add({ userId, url: xmlUrl, title: title || xmlUrl, folderId: parentFolderId });
				imported++;
			} else {
				skipped++;
			}
		} else {
			// Folder outline — recurse into children
			const children = Array.from(outline.children).filter(c => c.tagName === 'outline');
			if (children.length === 0) return;

			const folderName = title || 'Imported Folder';
			let folderId: number | undefined = parentFolderId;

			const existing = await db.folders
				.where('userId').equals(userId)
				.and(f => f.name === folderName && f.parentId === parentFolderId)
				.first();

			if (existing?.id !== undefined) {
				folderId = existing.id;
			} else {
				folderId = (await db.folders.add({ userId, name: folderName, parentId: parentFolderId })) as number;
			}

			for (const child of children) {
				await processOutline(child, folderId);
			}
		}
	}

	const rootOutlines = Array.from(doc.querySelectorAll('body > outline'));
	for (const outline of rootOutlines) {
		await processOutline(outline, undefined);
	}

	alert(`Import complete: ${imported} feed${imported !== 1 ? 's' : ''} imported, ${skipped} already existed.`);
	await loadData();
}
</script>

<div class="p-8 bg-gray-100 dark:bg-gray-900 min-h-screen text-gray-900 dark:text-gray-100">
	<div class="max-w-2xl mx-auto bg-white dark:bg-gray-800 p-6 rounded shadow">
		<div class="flex items-center mb-4 border-b border-gray-200 dark:border-gray-700 pb-2">
			<a href="{resolve('/reader', {})}" class="mr-4 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200" title="Back to Reader">
				<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
			</a>
			<h1 class="text-2xl font-bold">Settings</h1>
		</div>

		<div class="mb-6">
			<h2 class="font-semibold mb-2">Users</h2>
			<p class="text-sm text-gray-600 dark:text-gray-400 mb-3">
				Manage multiple users. Each user has their own feeds, folders, views, and articles.
			</p>
			<div class="space-y-2">
				{#each users as user}
					<div class="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded">
						<div class="flex items-center gap-2">
							<span class="font-medium">{user.name}</span>
							{#if user.id === currentUserId}
								<span class="text-xs bg-blue-600 text-white px-2 py-0.5 rounded">Current</span>
							{/if}
						</div>
						<div class="flex gap-2">
							{#if user.id !== currentUserId}
								<button onclick={() => handleSwitchUser(user.id!)} class="text-sm text-blue-600 hover:underline">Switch</button>
							{/if}
							<button onclick={() => handleRenameUser(user.id!)} class="text-sm text-gray-600 hover:underline">Rename</button>
							<button onclick={() => handleDeleteUser(user.id!)} class="text-sm text-red-600 hover:underline">Delete</button>
						</div>
					</div>
				{/each}
			</div>
			<button onclick={openAddUserModal} class="mt-3 bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded">+ Add User</button>
		</div>

		<div class="mb-6">
			<h2 class="font-semibold mb-2">Feed Refresh</h2>
			<div class="flex items-center space-x-2">
				<label for="refresh-interval" class="text-sm text-gray-600 dark:text-gray-400">
					Refresh feeds every
				</label>
				<select
					id="refresh-interval"
					value={refreshInterval}
					onchange={updateRefreshInterval}
					class="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
				>
					{#each Array(60) as _, i}
						<option value={i + 1}>{i + 1} minute{i === 0 ? '' : 's'}</option>
					{/each}
				</select>
			</div>
			<p class="text-xs text-gray-500 dark:text-gray-400 mt-1">
				Current interval: {refreshInterval} minute{refreshInterval === 1 ? '' : 's'}
			</p>
		</div>

		<div class="mb-4">
			<h2 class="font-semibold mb-2">Data Management</h2>
			<div class="flex gap-2 flex-wrap">
				<button
					onclick={triggerImportPicker}
					class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
				>Import OPML</button>
				<button
					onclick={handleExportOPML}
					class="bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-100 font-bold py-2 px-4 rounded"
					disabled={feeds.length === 0}
				>Export OPML</button>
			</div>
			{#if opmlImportError}
				<p class="text-red-500 text-sm mt-2">{opmlImportError}</p>
			{/if}
			<p class="text-xs text-gray-500 dark:text-gray-400 mt-1">
				{feeds.length} feed{feeds.length !== 1 ? 's' : ''} in current profile
			</p>
			<!-- Hidden file input for OPML import -->
			<input
				bind:this={fileInput}
				type="file"
				accept=".opml,.xml"
				class="hidden"
				onchange={handleImportFileSelected}
			/>
		</div>

		<div class="mb-4">
			<h2 class="font-semibold mb-2">Storage</h2>
			<p class="text-sm text-gray-600 dark:text-gray-400">IndexedDB Usage: <span>{dbUsage}</span></p>
		</div>

		<div class="mb-4">
			<h2 class="font-semibold mb-2">Preferences</h2>
			<label class="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300" for="dark-mode-select">Dark Mode</label>
			<select
				id="dark-mode-select"
				class="border border-gray-300 dark:border-gray-600 rounded px-3 py-2 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
				value={$darkMode}
				onchange={(e) => currentUserId !== null && setDarkMode(currentUserId, (e.target as HTMLSelectElement).value as DarkModeOption)}
			>
				<option value="system">System</option>
				<option value="dark">Dark</option>
				<option value="light">Light</option>
			</select>
		</div>
	</div>
</div>

<Modal title="Add User" open={showUserModal} onclose={() => showUserModal = false}>
	<form onsubmit={(e) => { e.preventDefault(); handleCreateUser(); }} class="space-y-4">
		<div>
			<label for="new-user-name" class="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">User Name</label>
			<input
				id="new-user-name"
				type="text"
				bind:value={newUserName}
				placeholder="Enter user name"
				class="w-full px-3 py-2 border rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
			/>
		</div>
		<button class="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-2 rounded" type="submit">Create User</button>
	</form>
</Modal>
