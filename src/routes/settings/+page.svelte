<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { db, getAllUsers, getCurrentUserId, setCurrentUserId, createUser, deleteUser, renameUser, type User } from '$lib/db';
	import Modal from '$lib/components/Modal.svelte';

	let refreshInterval = 15;
	let users: User[] = [];
	let currentUserId: number | null = null;
	let showUserModal = false;
	let newUserName = '';
	let editingUserId: number | null = null;
	let editUserName = '';

	onMount(async () => {
		if (browser) {
		  const result = await chrome.storage.local.get('refreshInterval') as { refreshInterval?: number };
		  if (result.refreshInterval) {
		    refreshInterval = result.refreshInterval;
		  }
		  await loadUsers();
		}
	});

	async function loadUsers() {
		users = await getAllUsers();
		currentUserId = await getCurrentUserId();
	}

	function updateRefreshInterval(event: Event) {
		const target = event.target as HTMLSelectElement;
		refreshInterval = parseInt(target.value, 10);
		if (browser) {
		  chrome.storage.local.set({ refreshInterval });
		}
	}

	async function handleCreateUser() {
		if (!newUserName.trim()) return;
		await createUser(newUserName.trim());
		newUserName = '';
		showUserModal = false;
		await loadUsers();
	}

	async function handleDeleteUser(userId: number) {
		if (users.length <= 1) {
		  alert('Cannot delete the last user. At least one user is required.');
		  return;
		}
		if (confirm('Are you sure you want to delete this user? All their feeds, articles, and settings will be permanently deleted.')) {
		  await deleteUser(userId);
		  await loadUsers();
		}
	}

	async function handleRenameUser(userId: number) {
		const user = users.find(u => u.id === userId);
		if (!user) return;
		
		const newName = prompt('Enter new name:', user.name);
		if (newName && newName.trim() && newName.trim() !== user.name) {
		  await renameUser(userId, newName.trim());
		  await loadUsers();
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
		editingUserId = null;
		newUserName = '';
		showUserModal = true;
	}
</script>

<div class="p-8 bg-gray-100 dark:bg-gray-900 min-h-screen text-gray-900 dark:text-gray-100">
	<div class="max-w-2xl mx-auto bg-white dark:bg-gray-800 p-6 rounded shadow">
		<div class="flex items-center mb-4 border-b border-gray-200 dark:border-gray-700 pb-2">
		  <a href="/reader" class="mr-4 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200" title="Back to Reader">
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
		            <button on:click={() => handleSwitchUser(user.id!)} class="text-sm text-blue-600 hover:underline">Switch</button>
		          {/if}
		          <button on:click={() => handleRenameUser(user.id!)} class="text-sm text-gray-600 hover:underline">Rename</button>
		          <button on:click={() => handleDeleteUser(user.id!)} class="text-sm text-red-600 hover:underline">Delete</button>
		        </div>
		      </div>
		    {/each}
		  </div>
		  <button on:click={openAddUserModal} class="mt-3 bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded">+ Add User</button>
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
		      on:change={updateRefreshInterval}
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
		  <button class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded mr-2">Import OPML</button>
		  <button class="bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-100 font-bold py-2 px-4 rounded">Export OPML</button>
		</div>
		<div class="mb-4">
		  <h2 class="font-semibold mb-2">Storage</h2>
		  <p class="text-sm text-gray-600 dark:text-gray-400">IndexedDB Usage: <span id="db-usage">Calculating...</span></p>
		</div>
		<div class="mb-4">
		  <h2 class="font-semibold mb-2">Preferences</h2>
		  <label class="flex items-center space-x-2">
		    <input type="checkbox" class="form-checkbox text-blue-600">
		    <span>Dark Mode (System Default)</span>
		  </label>
		</div>
	</div>
</div>

<Modal title="Add User" open={showUserModal} on:close={() => showUserModal = false}>
	<form on:submit|preventDefault={handleCreateUser} class="space-y-4">
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
