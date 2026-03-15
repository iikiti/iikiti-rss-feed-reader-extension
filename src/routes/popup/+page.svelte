<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { getCurrentUserId, db, getAllUsers } from '$lib/db';

	let unreadCount = 0;
	let currentUserName = 'Loading...';
	let users: { id?: number; name: string }[] = [];

	onMount(async () => {
		if (browser) {
		  await loadData();
		}
	});

	async function loadData() {
		const userId = await getCurrentUserId();
		users = await getAllUsers();
		const user = users.find(u => u.id === userId);
		currentUserName = user?.name || 'Unknown User';
		
		// Get unread count for current user
		const articles = await db.articles.where('userId').equals(userId).and(a => !a.read).toArray();
		unreadCount = articles.length;
	}
</script>

<div class="p-4 w-full min-h-full h-full bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100">
	<div class="flex justify-between items-center mb-4">
		<h1 class="text-lg font-bold">iikiti</h1>
		<span class="text-xs text-gray-500">{currentUserName}</span>
	</div>
	<button class="w-full bg-blue-600 text-white p-2 rounded mb-2 hover:bg-blue-700">Quick Add Tab</button>
	<div class="text-sm mb-4">Unread: <span class="font-bold">{unreadCount}</span></div>
	<a href="/reader/index.html" target="_blank" rel="external" class="block text-center text-blue-500 hover:underline">Open Reader</a>
	<a href="/settings/index.html" target="_blank" rel="external" class="block text-center text-blue-500 hover:underline mt-2">Settings</a>
</div>
