<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';

  let refreshInterval = 15;

  onMount(() => {
    if (browser) {
      chrome.storage.local.get('refreshInterval').then((result: { refreshInterval?: number }) => {
        if (result.refreshInterval) {
          refreshInterval = result.refreshInterval;
        }
      });
    }
  });

  function updateRefreshInterval(event: Event) {
    const target = event.target as HTMLSelectElement;
    refreshInterval = parseInt(target.value, 10);
    if (browser) {
      chrome.storage.local.set({ refreshInterval });
    }
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
