<script lang="ts">
import { onMount } from 'svelte';
import { browser } from '$app/environment';
import { db, type Feed, type Folder, type View, type Article, getCurrentUserId, getAllUsers, setCurrentUserId, getUserArticlesSorted, type SortOption } from '$lib/db';
import { fetchAndParseFeed } from '$lib/feed';

let currentUserId: number | null = null;
let users: { id?: number; name: string; createdAt: number }[] = [];
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
let expandedArticleId: number | null = null;
  
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

// Sort option
let sortBy: SortOption = 'pubDateDesc';

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

  $: currentUserName = users.find(u => u.id === currentUserId)?.name || 'Loading...';

  $: unreadCount = articles.filter(a => !a.read).length;

  onMount(async () => {
    await loadUsers();
    await loadData();
    
    // Listen for refresh complete messages from background script
    if (browser) {
      chrome.runtime.onMessage.addListener((message) => {
        if (message.type === 'refresh-complete') {
          loadData();
        }
      });
    }
  });

  async function loadUsers() {
    users = await getAllUsers();
    currentUserId = await getCurrentUserId();
  }

  async function switchUser(userId: number) {
    await setCurrentUserId(userId);
    currentUserId = userId;
    // Reset selection state when switching users
    selectedViewId = null;
    selectedFolderId = null;
    selectedFeedId = null;
    await loadData();
  }

  function refreshFeeds() {
    // Send message to background to refresh feeds
    if (browser) {
      chrome.runtime.sendMessage({ type: 'refresh-feeds' });
    }
  }

  async function loadData() {
    if (!currentUserId) {
      currentUserId = await getCurrentUserId();
    }
    feeds = await db.feeds.where('userId').equals(currentUserId).toArray();
    folders = await db.folders.where('userId').equals(currentUserId).toArray();
    views = await db.views.where('userId').equals(currentUserId).toArray();
    articles = await getUserArticlesSorted(currentUserId, sortBy);
  }

  function selectAllArticles() { selectedViewId = null; selectedFolderId = null; selectedFeedId = null; }
  function selectView(id: number) { selectedViewId = id; selectedFolderId = null; selectedFeedId = null; }
  function selectFolder(id: number) { selectedViewId = null; selectedFolderId = id; selectedFeedId = null; }
  function selectFeed(id: number) { selectedViewId = null; selectedFolderId = null; selectedFeedId = id; }

  function handleSortChange(event: Event) {
    const target = event.target as HTMLSelectElement;
    sortBy = target.value as SortOption;
    loadData();
  }

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
        closeModal(); await loadData();
      } else {
        const existing = await db.feeds.where('url').equals(feedUrl).first();
        if (existing) { feedError = 'This feed already exists'; feedLoading = false; return; }
        
        // Send message to background to add the feed and fetch articles
        if (browser) {
          const response = await chrome.runtime.sendMessage({ 
            type: 'add-feed', 
            feedUrl, 
            feedTitle, 
            feedFolderId 
          });
          if (!response.success) {
            throw new Error(response.error || 'Failed to add feed');
          }
        } else {
          // Fallback for non-browser environment
          const userId = await getCurrentUserId();
          const parsed = await fetchAndParseFeed(feedUrl);
          const feedId = await db.feeds.add({ userId, url: feedUrl, title: feedTitle, folderId: feedFolderId || undefined });
          const articles = parsed.items.slice(0, 10).map(item => ({ userId, feedId: feedId as number, guid: item.guid, title: item.title, link: item.link, content: item.content, snippet: item.snippet, pubDate: item.pubDate, read: false, starred: false, author: item.author, image: item.image }));
          await db.articles.bulkAdd(articles);
        }
        closeModal(); await loadData();
      }
    } catch (err: any) { feedError = err.message || 'Failed to add feed. Check URL.'; console.error(err); }
    finally { feedLoading = false; }
  }

  async function addFolder() {
    if (!folderName.trim()) { folderError = 'Please enter a folder name'; return; }
    const userId = await getCurrentUserId();
    const existing = await db.folders.where('userId').equals(userId).and(f => f.name === folderName.trim()).first();
    if (existing && existing.id !== editingId) { folderError = 'Folder already exists'; return; }
    if (editingId) await db.folders.update(editingId, { name: folderName.trim(), parentId: folderParentId || undefined });
    else await db.folders.add({ userId, name: folderName.trim(), parentId: folderParentId || undefined });
    closeModal(); await loadData();
  }

  async function addView() {
    if (!viewName.trim()) { viewError = 'Please enter a view name'; return; }
    const userId = await getCurrentUserId();
    const filterJson = JSON.stringify({ read: viewFilterRead, starred: viewFilterStarred });
    if (editingId) await db.views.update(editingId, { name: viewName.trim(), filterJson });
    else await db.views.add({ userId, name: viewName.trim(), filterJson });
    closeModal(); await loadData();
  }

  async function deleteFeed(id: number) {
    if (confirm('Delete this feed?')) { 
      await db.feeds.delete(id); 
      await db.articles.where('feedId').equals(id).delete(); 
      await loadData(); 
    }
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
  
  function toggleArticle(id: number) {
    expandedArticleId = expandedArticleId === id ? null : id;
  }
  
  /**
   * Returns the content to display for an article.
   * - For collapsed view: returns content (strip HTML for snippet) or snippet
   * - For expanded view: returns the longer of content or siteContent
   */
  function getDisplayContent(article: Article): string {
    const isExpanded = expandedArticleId === article.id;
    
    if (isExpanded) {
      // When expanded, use whichever is longer (content or siteContent)
      const contentLen = (article.content || '').length;
      const siteContentLen = (article.siteContent || '').length;
      
      if (siteContentLen > contentLen) {
        return article.siteContent || article.content || article.snippet;
      } else {
        return article.content || article.snippet;
      }
    } else {
      // When collapsed, use content for snippet (stripped of HTML)
      const content = article.content || article.snippet || '';
      // Strip HTML tags and create a simple text snippet
      const textOnly = content.replace(/<[^>]*>/g, '').substring(0, 200);
      return textOnly + (textOnly.length >= 200 ? '...' : '');
    }
  }
</script>

<div class="flex h-screen bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-gray-100 font-sans">
  <aside class="w-64 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col">
    <div class="p-4 border-b border-gray-200 dark:border-gray-700">
      <div class="flex justify-between items-center mb-2">
        <h1 class="text-xl font-bold">iikiti</h1>
        <div class="flex items-center space-x-1">
          <button on:click={() => openAddModal('feed')} class="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 p-1" title="Add">+</button>
          <a href="/settings" class="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">⚙️</a>
        </div>
      </div>
      <!-- User Switcher -->
      <div class="text-sm">
        <label for="user-select" class="text-xs text-gray-500">User:</label>
        <select 
          id="user-select"
          value={currentUserId} 
          on:change={(e) => switchUser(parseInt(e.currentTarget.value))}
          class="w-full mt-1 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-sm"
        >
          {#each users as user}
            <option value={user.id}>{user.name}</option>
          {/each}
        </select>
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
          <div class="w-full text-left px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 {selectedFeedId === null && selectedFolderId === null ? 'bg-blue-100 dark:bg-blue-900' : ''}" on:click={selectAllArticles} role="button" tabindex="0" on:keypress={(e) => e.key === 'Enter' && selectAllArticles()}>All Articles <span class="text-xs text-gray-500">({unreadCount})</span></div>
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
      <h2 class="font-semibold text-lg">{currentTitle} <button on:click={() => refreshFeeds()}>Refresh</button></h2>
      <div class="flex items-center gap-2">
        <input type="search" placeholder="Search..." bind:value={searchQuery} class="border rounded px-3 py-1 bg-gray-50 dark:bg-gray-700" />
        <select 
          value={sortBy} 
          on:change={handleSortChange}
          class="border rounded px-3 py-1 bg-gray-50 dark:bg-gray-700"
        >
          <option value="pubDateDesc">Newest First</option>
          <option value="pubDateAsc">Oldest First</option>
          <option value="titleAsc">Title A-Z</option>
          <option value="titleDesc">Title Z-A</option>
        </select>
      </div>
    </header>
    <div class="flex-1 overflow-y-auto p-4">
      {#if filteredArticles.length === 0}
        <div class="bg-white dark:bg-gray-800 p-4 rounded shadow"><h3 class="font-bold text-lg mb-1">No articles</h3><p class="text-gray-600 dark:text-gray-400 text-sm">Add some feeds to see articles.</p></div>
      {:else}
        {#each filteredArticles as article}
          <div class="bg-white dark:bg-gray-800 p-4 rounded shadow mb-4 hover:shadow-md transition-all duration-300 overflow-hidden" class:expanded={expandedArticleId === article.id}>
            <div class="flex items-start gap-4" on:click={() => toggleArticle(article.id!)} role="button" tabindex="0" on:keypress={(e) => e.key === 'Enter' && toggleArticle(article.id!)}>
              {#if article.image}
                <img src={article.image} alt="" class="w-32 h-32 object-cover rounded flex-shrink-0" />
              {/if}
              <div class="flex-1">
                <h3 class="font-bold text-lg mb-1">
                  <a href={article.link} target="_blank" rel="noopener noreferrer" class="hover:underline text-blue-600 dark:text-blue-400" on:click|stopPropagation>{article.title}</a>
                </h3>
                <p class="text-gray-600 dark:text-gray-400 text-sm mb-2">{feeds.find(f => f.id === article.feedId)?.title || 'Unknown'} - {new Date(article.pubDate).toLocaleDateString()}</p>
                <div class="overflow-hidden transition-all duration-300" style="max-height: {expandedArticleId === article.id ? '2000px' : '4.5em'};">
                  <p class="text-gray-700 dark:text-gray-300">{@html getDisplayContent(article)}</p>
                </div>
              </div>
              <div class="flex items-center gap-2 ml-4" on:click|stopPropagation role="presentation">
                <button on:click={() => toggleStarred(article.id!, article.starred)} class="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">{article.starred ? '⭐' : '☆'}</button>
                {#if !article.read}<button on:click={() => markAsRead(article.id!)} class="px-2 py-1 text-xs bg-blue-600 text-white rounded">Mark read</button>{/if}
              </div>
            </div>
            <div class="text-center mt-2">
              <span class="text-xs text-gray-400">{expandedArticleId === article.id ? '▲ Click to collapse' : '▼ Click to read more'}</span>
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
