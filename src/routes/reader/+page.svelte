<script lang="ts">
import { onMount } from 'svelte';
import { browser } from '$app/environment';
import { db, type Feed, type Folder, type View, type Article } from '$lib/db';
import { fetchAndParseFeed } from '$lib/feed';
import { Temporal, Intl, toTemporalInstant } from '@js-temporal/polyfill';

// Add Temporal polyfill to Date prototype
Date.prototype.toTemporalInstant = toTemporalInstant;

let feeds: Feed[] = [];
let folders: Folder[] = [];
let views: View[] = [];
let articles: Article[] = [];
let showAddModal = false;
let addMode: 'feed' | 'folder' | 'view' = 'feed';
let editingId: number | null = null;

// Selection state
let selectedViewId: number | null = null;
let selectedFolderId: number | null = null;
let selectedFeedId: number | null = null;
let searchQuery = '';
let refreshInterval = 15;
let refreshTimer: ReturnType<typeof setInterval> | null = null;
let lastRefresh: Date = ((): Date => {
	const storedValue = localStorage.getItem('feeds_last_refresh');

	// If null, undefined, or empty string, return new Date()
	if (!storedValue) {
		return new Date();
	}

	const parsedDate = new Date(storedValue);

	// Check if the string was actually a valid date format
	// (new Date('invalid') returns 'Invalid Date', which is a Date object where getTime() is NaN)
	if(isNaN(parsedDate.getTime())) {
		return new Date();
	}

	return parsedDate;
})();
  
// Feed form
let feedUrl = '';
let feedTitle = '';
let feedFolderId: number | null = null;
let feedError = '';
let feedLoading = false;

// Folder form
let folderName = '';
let folderParentId: number | null = null;
let folderError = '';

// View form
let viewName = '';
let viewFilterRead: 'all' | 'unread' | 'read' = 'all';
let viewFilterStarred: 'all' | 'starred' = 'all';
let viewError = '';

// Folder search
let folderSearchQuery = '';


  $: filteredFolders = folders.filter(f => 
    f.name.toLowerCase().includes(folderSearchQuery.toLowerCase()) && f.id !== editingId
  );

  $: availableParentFolders = folders.filter(f => {
    if (f.id === editingId) return false;
    if (f.parentId === editingId) return false;
    return true;
  });

  function getFeedIdsInFolder(folderId: number): number[] {
    const folderFeedIds = feeds.filter(f => f.folderId === folderId).map(f => f.id!);
    const childFolders = folders.filter(f => f.parentId === folderId);
    let allFeedIds = [...folderFeedIds];
    for (const child of childFolders) {
      allFeedIds = allFeedIds.concat(getFeedIdsInFolder(child.id!));
    }
    return allFeedIds;
  }
  
  $: filteredArticles = articles.filter(article => {
    if (selectedFeedId !== null && article.feedId !== selectedFeedId) return false;
    if (selectedFolderId !== null) {
      const feedIds = getFeedIdsInFolder(selectedFolderId);
      if (!feedIds.includes(article.feedId)) return false;
    }
    if (selectedViewId !== null) {
      const view = views.find(v => v.id === selectedViewId);
      if (view) {
        const filter = JSON.parse(view.filterJson);
        if (filter.read === 'unread' && article.read) return false;
        if (filter.read === 'read' && !article.read) return false;
        if (filter.starred === 'starred' && !article.starred) return false;
      }
    }
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return article.title.toLowerCase().includes(query) || article.snippet.toLowerCase().includes(query);
    }
    return true;
  });
  
  $: currentTitle = selectedViewId 
    ? views.find(v => v.id === selectedViewId)?.name || 'View'
    : selectedFolderId 
      ? folders.find(f => f.id === selectedFolderId)?.name || 'Folder'
      : selectedFeedId 
        ? feeds.find(f => f.id === selectedFeedId)?.title || 'Feed'
        : 'All Articles';

  onMount(async () => {
    await loadData();
    if (browser) {
      const stored = localStorage.getItem('refreshInterval');
      if (stored) refreshInterval = parseInt(stored, 10);
      startRefreshTimer();
    }
  });

  function startRefreshTimer() {
    if (refreshTimer) clearInterval(refreshTimer);
	console.info(`Feed refresh interval: ${refreshInterval} minutes.`);
    refreshTimer = setInterval(async () => { await refreshAllFeeds(); }, refreshInterval * 60 * 1000);
  }

  async function refreshAllFeeds() {
    for (const feed of feeds) {
      try {
        const parsedFeed = await fetchAndParseFeed(feed.url);
        const existingArticles = await db.articles.where('feedId').equals(feed.id!).toArray();
        const existingGuids = new Set(existingArticles.map(a => a.guid));
        const newArticles = parsedFeed.items.filter(item => !existingGuids.has(item.guid)).map(item => ({
          feedId: feed.id!,
          guid: item.guid,
          title: item.title,
          link: item.link,
          content: item.content,
          snippet: item.snippet,
          pubDate: item.pubDate,
          read: false,
          starred: false,
          author: item.author
        }));
		console.info(`Refreshing feed: ${feed.title} (${feed.url}).`);
        if (newArticles.length > 0) await db.articles.bulkAdd(newArticles);
        await db.feeds.update(feed.id!, { lastFetched: Date.now(), error: undefined });
      } catch (err) {
        await db.feeds.update(feed.id!, { error: String(err) });
      }
    }
    await loadData();
  }
  
  function updateRefreshInterval(minutes: number) {
    refreshInterval = minutes;
    if (browser) localStorage.setItem('refreshInterval', String(minutes));
    startRefreshTimer();
  }

  async function loadData() {
    feeds = await db.feeds.toArray();
    folders = await db.folders.toArray();
    views = await db.views.toArray();
    articles = await db.articles.orderBy('pubDate').reverse().toArray();
  }

  function selectAllArticles() { selectedViewId = null; selectedFolderId = null; selectedFeedId = null; }
  function selectView(id: number) { selectedViewId = id; selectedFolderId = null; selectedFeedId = null; }
  function selectFolder(id: number) { selectedViewId = null; selectedFolderId = id; selectedFeedId = null; }
  function selectFeed(id: number) { selectedViewId = null; selectedFolderId = null; selectedFeedId = id; }

  function openAddModal(mode: 'feed' | 'folder' | 'view', item?: Feed | Folder | View) {
    addMode = mode;
    if (item) {
      editingId = item.id!;
      if (mode === 'feed') {
		feedTitle = (item as Feed).title;
		feedUrl = (item as Feed).url;
		feedFolderId = (item as Feed).folderId || null;
	  }
      else if (mode === 'folder') { folderName = (item as Folder).name; folderParentId = (item as Folder).parentId || null; }
      else if (mode === 'view') { 
        viewName = (item as View).name; 
        const filter = JSON.parse((item as View).filterJson);
        viewFilterRead = filter.read || 'all';
        viewFilterStarred = filter.starred || 'all';
      }
    } else {
      editingId = null;
	  feedTitle = '';
	  feedUrl = '';
	  feedFolderId = null;
	  folderName = '';
	  folderParentId = null;
	  viewName = '';
	  viewFilterRead = 'all';
	  viewFilterStarred = 'all';
    }
    folderSearchQuery = ''; feedError = ''; folderError = ''; viewError = ''; showAddModal = true;
  }

  function closeModal() { showAddModal = false; }

  async function addFeed() {
    if (!feedUrl.trim()) { feedError = 'Please enter a feed URL'; return; }
    feedLoading = true; feedError = '';
    try {
      new URL(feedUrl);
      if (editingId) {
        await db.feeds.update(editingId, { title: feedTitle, url: feedUrl, folderId: feedFolderId || undefined });
      } else {
        const existing = await db.feeds.where('url').equals(feedUrl).first();
        if (existing) { feedError = 'This feed already exists'; feedLoading = false; return; }
        const parsed = await fetchAndParseFeed(feedUrl);
		// parsed.title is title of feed from url
        const feedId = await db.feeds.add({ url: feedUrl, title: feedTitle, folderId: feedFolderId || undefined });
        const articles = parsed.items.slice(0, 10).map(item => ({ feedId: feedId as number, guid: item.guid, title: item.title, link: item.link, content: item.content, snippet: item.snippet, pubDate: item.pubDate, read: false, starred: false, author: item.author }));
        await db.articles.bulkAdd(articles);
      }
      closeModal(); await loadData();
    } catch (err) { feedError = 'Failed to add feed. Check URL.'; console.error(err); }
    finally { feedLoading = false; }
  }

  async function addFolder() {
    if (!folderName.trim()) { folderError = 'Please enter a folder name'; return; }
    const existing = await db.folders.where('name').equals(folderName.trim()).first();
    if (existing && existing.id !== editingId) { folderError = 'Folder already exists'; return; }
    if (editingId) await db.folders.update(editingId, { name: folderName.trim(), parentId: folderParentId || undefined });
    else await db.folders.add({ name: folderName.trim(), parentId: folderParentId || undefined });
    closeModal(); await loadData();
  }

  async function addView() {
    if (!viewName.trim()) { viewError = 'Please enter a view name'; return; }
    const filterJson = JSON.stringify({ read: viewFilterRead, starred: viewFilterStarred });
    if (editingId) await db.views.update(editingId, { name: viewName.trim(), filterJson });
    else await db.views.add({ name: viewName.trim(), filterJson });
    closeModal(); await loadData();
  }

  async function deleteFeed(id: number) {
    if (confirm('Delete this feed?')) { await db.feeds.delete(id); await db.articles.where('feedId').equals(id).delete(); await loadData(); }
  }

  async function deleteFolder(id: number) {
    if (confirm('Delete this folder? Feeds will be moved to ungrouped.')) {
      const getSubfolders = async (pid: number): Promise<number[]> => {
        const children = await db.folders.where('parentId').equals(pid).toArray();
        let ids: number[] = [];
        for (const c of children) { ids.push(c.id!); ids = ids.concat(await getSubfolders(c.id!)); }
        return ids;
      };
      const allIds = [id, ...await getSubfolders(id)];
      for (const fid of allIds) {
        const fds = await db.feeds.where('folderId').equals(fid).toArray();
        for (const f of fds) await db.feeds.update(f.id!, { folderId: undefined });
      }
      await db.folders.bulkDelete(allIds); await loadData();
    }
  }

  async function deleteView(id: number) {
    if (confirm('Delete this view?')) { await db.views.delete(id); await loadData(); }
  }

  async function markAsRead(id: number) { await db.articles.update(id, { read: true }); await loadData(); }
  async function toggleStarred(id: number, current: boolean) { await db.articles.update(id, { starred: !current }); await loadData(); }
</script>

<div class="flex h-screen bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-gray-100 font-sans">
  <aside class="w-64 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col">
    <div class="p-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
      <h1 class="text-xl font-bold">iikiti</h1>
      <div class="flex items-center space-x-1">
        <button on:click={() => openAddModal('feed')} class="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 p-1" title="Add">+</button>
        <a href="/settings" class="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">⚙️</a>
      </div>
    </div>
    <div class="p-2 overflow-y-auto flex-1">
      <div class="mb-2 flex gap-1">
        <button on:click={() => openAddModal('feed')} class="flex-1 text-xs bg-blue-600 text-white py-1 rounded">+ Feed</button>
        <button on:click={() => openAddModal('folder')} class="flex-1 text-xs bg-gray-600 text-white py-1 rounded">+ Folder</button>
        <button on:click={() => openAddModal('view')} class="flex-1 text-xs bg-green-600 text-white py-1 rounded">+ View</button>
      </div>
      
      <div class="text-xs font-bold uppercase text-gray-500 mb-1 px-2">Views</div>
      <ul class="mb-3">
        {#each views as view}
          <li class="group">
            <div class="w-full text-left px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 {selectedViewId === view.id ? 'bg-blue-100 dark:bg-blue-900' : ''}" on:click={() => selectView(view.id!)} role="button" tabindex="0" on:keypress={(e) => e.key === 'Enter' && selectView(view.id!)}>
              <span class="flex justify-between items-center">
                <span>👁️ {view.name}</span>
                <span class="hidden group-hover:inline-flex gap-1">
                  <button on:click|stopPropagation={() => openAddModal('view', view)} class="text-blue-500 p-1" aria-label="Edit view">✏️</button>
                  <button on:click|stopPropagation={() => deleteView(view.id!)} class="text-red-500 p-1" aria-label="Delete view">🗑️</button>
                </span>
              </span>
            </div>
          </li>
        {/each}
      </ul>
      
      <div class="text-xs font-bold uppercase text-gray-500 mb-1 px-2">Feeds</div>
      <ul>
        <li class="group">
          <div class="w-full text-left px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 {selectedFeedId === null && selectedFolderId === null ? 'bg-blue-100 dark:bg-blue-900' : ''}" on:click={selectAllArticles} role="button" tabindex="0" on:keypress={(e) => e.key === 'Enter' && selectAllArticles()}>All Articles</div>
        </li>
        {#each folders.filter(f => !f.parentId) as folder}
          {@const childFolders = folders.filter(f => f.parentId === folder.id)}
          {@const folderFeeds = feeds.filter(f => f.folderId === folder.id)}
          <li class="group">
            <div class="w-full text-left px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 font-medium {selectedFolderId === folder.id ? 'bg-blue-100 dark:bg-blue-900' : ''}" on:click={() => selectFolder(folder.id!)} role="button" tabindex="0" on:keypress={(e) => e.key === 'Enter' && selectFolder(folder.id!)}>
              <span class="flex justify-between items-center">
                <span>📁 {folder.name}</span>
                <span class="hidden group-hover:inline-flex gap-1">
                  <button on:click|stopPropagation={() => openAddModal('folder', folder)} class="text-blue-500 p-1" aria-label="Edit folder">✏️</button>
                  <button on:click|stopPropagation={() => deleteFolder(folder.id!)} class="text-red-500 p-1" aria-label="Delete folder">🗑️</button>
                </span>
              </span>
            </div>
          </li>
          {#each childFolders as child}
            {@const childFeeds = feeds.filter(f => f.folderId === child.id)}
            <li class="group">
            <div class="w-full text-left px-6 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 font-medium {selectedFolderId === child.id ? 'bg-blue-100 dark:bg-blue-900' : ''}" on:click={() => selectFolder(child.id!)} role="button" tabindex="0" on:keypress={(e) => e.key === 'Enter' && selectFolder(child.id!)}>
              <span class="flex justify-between items-center">
                <span>📁 {child.name}</span>
                <span class="hidden group-hover:inline-flex gap-1">
                  <button on:click|stopPropagation={() => openAddModal('folder', child)} class="text-blue-500 p-1" aria-label="Edit child folder">✏️</button>
                  <button on:click|stopPropagation={() => deleteFolder(child.id!)} class="text-red-500 p-1" aria-label="Delete child folder">🗑️</button>
                </span>
              </span>
            </div>
          </li>
            {#each childFeeds as feed}
            <li class="group">
              <div class="w-full text-left px-10 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-sm {selectedFeedId === feed.id ? 'bg-blue-100 dark:bg-blue-900' : ''}" on:click={() => selectFeed(feed.id!)} role="button" tabindex="0" on:keypress={(e) => e.key === 'Enter' && selectFeed(feed.id!)}>
                <span class="flex justify-between items-center">
                  <span>{feed.title}</span>
                  <span class="hidden group-hover:inline-flex gap-1">
                    <button on:click|stopPropagation={() => openAddModal('feed', feed)} class="text-blue-500 p-1" aria-label="Edit feed">✏️</button>
                    <button on:click|stopPropagation={() => deleteFeed(feed.id!)} class="text-red-500 p-1" aria-label="Delete feed">🗑️</button>
                  </span>
                </span>
              </div>
            </li>
            {/each}
          {/each}
          {#each folderFeeds as feed}
            <li class="group">
              <div class="w-full text-left px-6 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-sm {selectedFeedId === feed.id ? 'bg-blue-100 dark:bg-blue-900' : ''}" on:click={() => selectFeed(feed.id!)} role="button" tabindex="0" on:keypress={(e) => e.key === 'Enter' && selectFeed(feed.id!)}>
                <span class="flex justify-between items-center">
                  <span>{feed.title}</span>
                  <span class="hidden group-hover:inline-flex gap-1">
                    <button on:click|stopPropagation={() => openAddModal('feed', feed)} class="text-blue-500 p-1" aria-label="Edit feed">✏️</button>
                    <button on:click|stopPropagation={() => deleteFeed(feed.id!)} class="text-red-500 p-1" aria-label="Delete feed">🗑️</button>
                  </span>
                </span>
              </div>
            </li>
          {/each}
        {/each}
        {#each feeds.filter(f => !f.folderId) as feed}
          <li class="group">
            <div class="w-full text-left px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-sm {selectedFeedId === feed.id ? 'bg-blue-100 dark:bg-blue-900' : ''}" on:click={() => selectFeed(feed.id!)} role="button" tabindex="0" on:keypress={(e) => e.key === 'Enter' && selectFeed(feed.id!)}>
              <span class="flex justify-between items-center">
                <span>{feed.title}</span>
                <span class="hidden group-hover:inline-flex gap-1">
                  <button on:click|stopPropagation={() => openAddModal('feed', feed)} class="text-blue-500 p-1" aria-label="Edit feed">✏️</button>
                  <button on:click|stopPropagation={() => deleteFeed(feed.id!)} class="text-red-500 p-1" aria-label="Delete feed">🗑️</button>
                </span>
              </span>
            </div>
          </li>
        {/each}
      </ul>
    </div>
  </aside>

  <main class="flex-1 flex flex-col">
    <header class="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 p-4 flex items-center justify-between">
      <h2 class="font-semibold text-lg">{currentTitle}</h2>
      <div class="flex items-center gap-2">
        <input type="search" placeholder="Search..." bind:value={searchQuery} class="border rounded px-3 py-1 bg-gray-50 dark:bg-gray-700" />
      </div>
    </header>
    <div class="flex-1 overflow-y-auto p-4">
      {#if filteredArticles.length === 0}
        <div class="bg-white dark:bg-gray-800 p-4 rounded shadow"><h3 class="font-bold text-lg mb-1">No articles</h3><p class="text-gray-600 dark:text-gray-400 text-sm">Add some feeds to see articles.</p></div>
      {:else}
        {#each filteredArticles as article}
          <div class="bg-white dark:bg-gray-800 p-4 rounded shadow mb-4 hover:shadow-md">
            <div class="flex items-start justify-between">
              <div class="flex-1">
                <h3 class="font-bold text-lg mb-1">{article.title}</h3>
                <p class="text-gray-600 dark:text-gray-400 text-sm mb-2">{feeds.find(f => f.id === article.feedId)?.title || 'Unknown'} - {new Date(article.pubDate).toLocaleDateString()}</p>
                <p class="text-gray-700 dark:text-gray-300">{article.snippet}</p>
              </div>
              <div class="flex items-center gap-2 ml-4">
                <button on:click={() => toggleStarred(article.id!, article.starred)} class="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">{article.starred ? '⭐' : '☆'}</button>
                {#if !article.read}<button on:click={() => markAsRead(article.id!)} class="px-2 py-1 text-xs bg-blue-600 text-white rounded">Mark read</button>{/if}
              </div>
            </div>
          </div>
        {/each}
      {/if}
    </div>
  </main>
</div>

{#if showAddModal}
  <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" on:click|self={closeModal} on:keydown={(e) => e.key === 'Escape' && closeModal()} role="dialog" aria-modal="true" tabindex="-1">
    <form class="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md p-6" on:submit|preventDefault>
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold text-gray-900 dark:text-gray-100">
          {editingId ? (addMode === 'feed' ? 'Edit Feed' : addMode === 'folder' ? 'Edit Folder' : 'Edit View') : (addMode === 'feed' ? 'Add Feed' : addMode === 'folder' ? 'Add Folder' : 'Add View')}
        </h2>
        <button on:click={closeModal} class="text-gray-500 hover:text-gray-700" aria-label="Close">✕</button>
      </div>
      <div class="flex mb-4 border-b border-gray-200 dark:border-gray-700">
        <button class="flex-1 py-2 text-center {addMode === 'feed' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500'}" on:click={() => addMode = 'feed'}>Feed</button>
        <button class="flex-1 py-2 text-center {addMode === 'folder' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500'}" on:click={() => addMode = 'folder'}>Folder</button>
        <button class="flex-1 py-2 text-center {addMode === 'view' ? 'border-b-2 border-green-600 text-green-600' : 'text-gray-500'}" on:click={() => addMode = 'view'}>View</button>
      </div>
      
      {#if addMode === 'feed'}
        <div class="space-y-4">
			<div>
				<label for="feed-url" class="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Feed URL</label>
				<input id="feed-url" type="url" bind:value={feedUrl} placeholder="https://example.com/feed.xml" class="w-full px-3 py-2 border rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100" />
			</div>

			<div>
				<label for="feed-title" class="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Feed Title</label>
				<input id="feed-title" type="url" bind:value={feedTitle} placeholder="Feed title" class="w-full px-3 py-2 border rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100" />
			</div>
		
			<div><label for="folder-select" class="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Folder (optional)</label>
			<input id="folder-search" type="text" bind:value={folderSearchQuery} placeholder="Search..." class="w-full px-3 py-2 mb-2 border rounded bg-white dark:bg-gray-700" />
			<div class="max-h-40 overflow-y-auto border rounded bg-white dark:bg-gray-700 p-2">
				<label class="flex items-center gap-2 p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-600"><input type="radio" name="folder" value={null} bind:group={feedFolderId} /><span class="text-gray-700 dark:text-gray-300">No folder</span></label>
				{#each filteredFolders as folder}<label class="flex items-center gap-2 p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-600"><input type="radio" name="folder" value={folder.id} bind:group={feedFolderId} /><span class="text-gray-700 dark:text-gray-300">{folder.name}</span></label>{/each}
			</div></div>
			{#if feedError}<p class="text-red-500 text-sm">{feedError}</p>{/if}
			<button class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 rounded disabled:opacity-50" on:click={addFeed} disabled={feedLoading}>{feedLoading ? 'Saving...' : (editingId ? 'Update Feed' : 'Add Feed')}</button>
        </div>
      {:else if addMode === 'folder'}
        <div class="space-y-4">
          <div><label for="folder-name" class="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Folder Name</label>
            <input id="folder-name" type="text" bind:value={folderName} placeholder="Enter folder name" class="w-full px-3 py-2 border rounded bg-white dark:bg-gray-700" /></div>
          <div><label for="parent-folder" class="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Parent Folder (optional)</label>
            <select id="parent-folder" bind:value={folderParentId} class="w-full px-3 py-2 border rounded bg-white dark:bg-gray-700">
              <option value={null}>No parent (root)</option>
              {#each availableParentFolders as f}<option value={f.id}>{f.name}</option>{/each}</select></div>
          {#if folderError}<p class="text-red-500 text-sm">{folderError}</p>{/if}
          <button class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 rounded" on:click={addFolder}>{editingId ? 'Update Folder' : 'Add Folder'}</button>
        </div>
      {:else}
        <div class="space-y-4">
          <div><label for="view-name" class="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">View Name</label>
            <input id="view-name" type="text" bind:value={viewName} placeholder="e.g., Unread" class="w-full px-3 py-2 border rounded bg-white dark:bg-gray-700" /></div>
          <div><label for="view-read" class="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Filter: Read Status</label>
            <select id="view-read" bind:value={viewFilterRead} class="w-full px-3 py-2 border rounded bg-white dark:bg-gray-700"><option value="all">All</option><option value="unread">Unread only</option><option value="read">Read only</option></select></div>
          <div><label for="view-starred" class="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Filter: Starred</label>
            <select id="view-starred" bind:value={viewFilterStarred} class="w-full px-3 py-2 border rounded bg-white dark:bg-gray-700"><option value="all">All</option><option value="starred">Starred only</option></select></div>
          {#if viewError}<p class="text-red-500 text-sm">{viewError}</p>{/if}
          <button class="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-2 rounded" on:click={addView}>{editingId ? 'Update View' : 'Add View'}</button>
        </div>
      {/if}
    </form>
  </div>
{/if}
