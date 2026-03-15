<script lang="ts">
import { onMount } from 'svelte';
import { browser } from '$app/environment';
import { db, type Feed, type Folder, type View, type Article, getCurrentUserId, getAllUsers, setCurrentUserId, getUserArticlesSorted, searchArticles, getPaginatedArticles, getUserArticleCounts, type SortOption } from '$lib/db';
import { fetchAndParseFeed } from '$lib/feed';
import { SvelteSet } from 'svelte/reactivity';

let currentUserId: number | null = $state(null);
let users: { id?: number; name: string; createdAt: number }[] = $state([]);
let feeds: Feed[] = $state([]);
let folders: Folder[] = $state([]);
let views: View[] = $state([]);
let articles: Article[] = $state([]);
let showAddModal = $state(false);
let addMode: 'feed' | 'folder' | 'view' = $state('feed');
let editingId: number | null = $state(null);

// Selection state
let selectedViewId: number | null = $state(null);
let selectedFolderId: number | null = $state(null);
let selectedFeedId: number | null = $state(null);
let searchQuery = $state('');
  
// Feed form
let feedUrl = $state('');
let feedTitle = $state('');
let feedFolderId: number | null = $state(null);
let feedError = $state('');
let feedLoading = $state(false);

// Folder form
let folderName = $state('');
let folderParentId: number | null = $state(null);
let folderError = $state('');

// View form
let viewName = $state('');
let viewFilterRead: 'all' | 'unread' | 'read' = $state('all');
let viewFilterStarred: 'all' | 'starred' = $state('all');
let viewError = $state('');

// Sort option
let sortBy: SortOption = $state('pubDateDesc');

// Pagination state
let articleOffset = $state(0);
let hasMoreArticles = $state(true);
let isLoadingMore = $state(false);
let loadTrigger: HTMLDivElement | null = $state(null);

// Folder search
let folderSearchQuery = $state('');

// Total article counts (unpaginated)
let totalArticleCounts = $state({ total: 0, unread: 0 });


const filteredFolders = $derived(
	folders.filter(f => 
		f.name.toLowerCase().includes(folderSearchQuery.toLowerCase()) && f.id !== editingId
	)
);

const availableParentFolders = $derived(
	folders.filter(f => {
		if (f.id === editingId) return false;
		if (f.parentId === editingId) return false;
		return true;
	})
);

  function getFeedIdsInFolder(folderId: number): number[] {
    const folderFeedIds = feeds.filter(f => f.folderId === folderId).map(f => f.id!);
    const childFolders = folders.filter(f => f.parentId === folderId);
    let allFeedIds = [...folderFeedIds];
    for (const child of childFolders) {
      allFeedIds = allFeedIds.concat(getFeedIdsInFolder(child.id!));
    }
    return allFeedIds;
  }
  
const filteredArticles = $derived(
  articles.filter(article => {
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
      // Use full-text search index fields for matching
      // Check if any indexed field contains any word from the query
      const searchWords = query.split(/\s+/).filter(w => w.length >= 2);
      return searchWords.length > 0 && (
        article.titleWords?.some(w => searchWords.some(sw => w.includes(sw))) ||
        article.snippetWords?.some(w => searchWords.some(sw => w.includes(sw))) ||
        article.siteContentWords?.some(w => searchWords.some(sw => w.includes(sw))) ||
        article.titleNgrams?.some(n => searchWords.some(sw => n.includes(sw))) ||
        article.snippetNgrams?.some(n => searchWords.some(sw => n.includes(sw))) ||
        article.siteContentNgrams?.some(n => searchWords.some(sw => n.includes(sw)))
      );
    }
    return true;
  })
);

const currentTitle = $derived(
  selectedViewId 
    ? views.find(v => v.id === selectedViewId)?.name || 'View'
    : selectedFolderId 
      ? folders.find(f => f.id === selectedFolderId)?.name || 'Folder'
      : selectedFeedId 
        ? feeds.find(f => f.id === selectedFeedId)?.title || 'Feed'
        : 'All Articles'
);

const currentUserName = $derived(
  users.find(u => u.id === currentUserId)?.name || 'Loading...'
);

const unreadCount = $derived(
  totalArticleCounts.unread
);

const totalCount = $derived(
  totalArticleCounts.total
);

  let observer: IntersectionObserver | null = null;
  
  onMount(() => {
    // Initialize async operations
    (async () => {
      await loadUsers();
      await loadData();
    })();
    
    // Set up Intersection Observer for infinite scroll
    if (browser) {
      // Wait for the DOM to be ready, then observe
      setTimeout(() => {
        if (loadTrigger) {
          observer = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting && hasMoreArticles && !isLoadingMore) {
              loadMore();
            }
          }, { rootMargin: '100px' });
          observer.observe(loadTrigger);
        }
      }, 100);
      
      // Listen for refresh complete messages from background script
      chrome.runtime.onMessage.addListener((message) => {
        if (message.type === 'refresh-complete') {
          loadData();
        }
      });
    }
    
    return () => {
      if (observer) observer.disconnect();
    };
  });
  
  // React to search query changes
  $effect(() => {
    // Track searchQuery dependency
    const _ = searchQuery;
    // Reload data when search changes
    loadData();
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
    
    // Load total article counts (unpaginated)
    totalArticleCounts = await getUserArticleCounts(currentUserId);
    
    // Reset pagination and load first 25 articles
    articleOffset = 0;
    
    if (searchQuery) {
      // Use search with pagination
      const searchResults = await searchArticles(currentUserId, searchQuery, { limit: 25, offset: 0 });
      articles = searchResults;
      hasMoreArticles = searchResults.length >= 25;
    } else {
      // Use paginated articles
      const result = await getPaginatedArticles(currentUserId, { 
        feedId: selectedFeedId ?? undefined,
        folderId: selectedFolderId ?? undefined,
        sortBy,
        limit: 25,
        offset: 0
      });
      articles = result.articles;
      hasMoreArticles = result.hasMore;
    }
  }
  
  async function loadMore() {
    if (isLoadingMore || !hasMoreArticles || !currentUserId) return;
    
    isLoadingMore = true;
    const nextOffset = articleOffset + 25;
    
    if (searchQuery) {
      const moreResults = await searchArticles(currentUserId, searchQuery, { limit: 25, offset: nextOffset });
      articles = [...articles, ...moreResults];
      hasMoreArticles = moreResults.length >= 25;
    } else {
      const result = await getPaginatedArticles(currentUserId, {
        feedId: selectedFeedId ?? undefined,
        folderId: selectedFolderId ?? undefined,
        sortBy,
        limit: 25,
        offset: nextOffset
      });
      articles = [...articles, ...result.articles];
      hasMoreArticles = result.hasMore;
    }
    
    articleOffset = nextOffset;
    isLoadingMore = false;
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
  
  // Use article index in filtered list for expansion state (more reliable than database ID)
  let expandedIndices = new SvelteSet<number>([]);

  function toggleArticle(index: number) {
    if (expandedIndices.has(index)) {
    	expandedIndices.delete(index);
    } else {
		expandedIndices.forEach((idx) => {
			expandedIndices.delete(idx);
		});
    	expandedIndices.add(index);
    }
  }

  function isArticleExpanded(index: number): boolean {
    return expandedIndices.has(index);
  }
  
  /**
   * Returns the content to display for an article.
   * - For collapsed view: returns content (strip HTML for snippet) or snippet
   * - For expanded view: returns the longer of content or siteContent
   */
  function getDisplayContent(article: Article, index: number): string {
    const isExpanded = isArticleExpanded(index);
    
    if (isExpanded) {
      // When expanded, use whichever is longer (content or siteContent)
      const content = article.content || '';
      const siteContent = article.siteContent || '';
      const contentLen = content.length;
      const siteContentLen = siteContent.length;
      
      // Use the longer content
      if (siteContentLen > contentLen) {
        return siteContent;
      } else if (contentLen > 0) {
        return content;
      } else {
        return article.snippet;
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
          <button onclick={() => openAddModal('feed')} class="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 p-1" title="Add">+</button>
          <a href="/settings" class="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">⚙️</a>
        </div>
      </div>
      <!-- User Switcher -->
      <div class="text-sm">
        <label for="user-select" class="text-xs text-gray-500">User:</label>
        <select 
          id="user-select"
          value={currentUserId} 
          onchange={(e) => switchUser(parseInt(e.currentTarget.value))}
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
        <button onclick={() => openAddModal('feed')} class="flex-1 text-xs bg-blue-600 text-white py-1 rounded">+ Feed</button>
        <button onclick={() => openAddModal('folder')} class="flex-1 text-xs bg-gray-600 text-white py-1 rounded">+ Folder</button>
        <button onclick={() => openAddModal('view')} class="flex-1 text-xs bg-green-600 text-white py-1 rounded">+ View</button>
      </div>
      
      <div class="text-xs font-bold uppercase text-gray-500 mb-1 px-2">Views</div>
      <ul class="mb-3">
        {#each views as view}
          <li class="group">
            <div class="w-full text-left px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 {selectedViewId === view.id ? 'bg-blue-100 dark:bg-blue-900' : ''}" onclick={() => selectView(view.id!)} role="button" tabindex="0" onkeypress={(e) => e.key === 'Enter' && selectView(view.id!)}>
              <span class="flex justify-between items-center">
                <span>👁️ {view.name}</span>
                <span class="hidden group-hover:inline-flex gap-1">
                  <button onclick={() => openAddModal('view', view)} class="text-blue-500 p-1" aria-label="Edit view">✏️</button>
                  <button onclick={() => deleteView(view.id!)} class="text-red-500 p-1" aria-label="Delete view">🗑️</button>
                </span>
              </span>
            </div>
          </li>
        {/each}
      </ul>
      
      <div class="text-xs font-bold uppercase text-gray-500 mb-1 px-2">Feeds</div>
      <ul>
        <li class="group">
          <div class="w-full text-left px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 {selectedFeedId === null && selectedFolderId === null ? 'bg-blue-100 dark:bg-blue-900' : ''}" onclick={selectAllArticles} role="button" tabindex="0" onkeypress={(e) => e.key === 'Enter' && selectAllArticles()}>All Articles <span class="text-xs text-gray-500">({unreadCount}/{totalCount})</span></div>
        </li>
        {#each folders.filter(f => !f.parentId) as folder}
          {@const childFolders = folders.filter(f => f.parentId === folder.id)}
          {@const folderFeeds = feeds.filter(f => f.folderId === folder.id)}
          <li class="group">
            <div class="w-full text-left px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 font-medium {selectedFolderId === folder.id ? 'bg-blue-100 dark:bg-blue-900' : ''}" onclick={() => selectFolder(folder.id!)} role="button" tabindex="0" onkeypress={(e) => e.key === 'Enter' && selectFolder(folder.id!)}>
              <span class="flex justify-between items-center">
                <span>📁 {folder.name}</span>
                <span class="hidden group-hover:inline-flex gap-1">
                  <button onclick={() => openAddModal('folder', folder)} class="text-blue-500 p-1" aria-label="Edit folder">✏️</button>
                  <button onclick={() => deleteFolder(folder.id!)} class="text-red-500 p-1" aria-label="Delete folder">🗑️</button>
                </span>
              </span>
            </div>
          </li>
          {#each childFolders as child}
            {@const childFeeds = feeds.filter(f => f.folderId === child.id)}
            <li class="group">
            <div class="w-full text-left px-6 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 font-medium {selectedFolderId === child.id ? 'bg-blue-100 dark:bg-blue-900' : ''}" onclick={() => selectFolder(child.id!)} role="button" tabindex="0" onkeypress={(e) => e.key === 'Enter' && selectFolder(child.id!)}>
              <span class="flex justify-between items-center">
                <span>📁 {child.name}</span>
                <span class="hidden group-hover:inline-flex gap-1">
                  <button onclick={() => openAddModal('folder', child)} class="text-blue-500 p-1" aria-label="Edit child folder">✏️</button>
                  <button onclick={() => deleteFolder(child.id!)} class="text-red-500 p-1" aria-label="Delete child folder">🗑️</button>
                </span>
              </span>
            </div>
          </li>
            {#each childFeeds as feed}
            <li class="group">
              <div class="w-full text-left px-10 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-sm {selectedFeedId === feed.id ? 'bg-blue-100 dark:bg-blue-900' : ''}" onclick={() => selectFeed(feed.id!)} role="button" tabindex="0" onkeypress={(e) => e.key === 'Enter' && selectFeed(feed.id!)}>
                <span class="flex justify-between items-center">
                  <span>{feed.title}</span>
                  <span class="hidden group-hover:inline-flex gap-1">
                    <button onclick={() => openAddModal('feed', feed)} class="text-blue-500 p-1" aria-label="Edit feed">✏️</button>
                    <button onclick={() => deleteFeed(feed.id!)} class="text-red-500 p-1" aria-label="Delete feed">🗑️</button>
                  </span>
                </span>
              </div>
            </li>
            {/each}
          {/each}
          {#each folderFeeds as feed}
            <li class="group">
              <div class="w-full text-left px-6 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-sm {selectedFeedId === feed.id ? 'bg-blue-100 dark:bg-blue-900' : ''}" onclick={() => selectFeed(feed.id!)} role="button" tabindex="0" onkeypress={(e) => e.key === 'Enter' && selectFeed(feed.id!)}>
                <span class="flex justify-between items-center">
                  <span>{feed.title}</span>
                  <span class="hidden group-hover:inline-flex gap-1">
                    <button onclick={() => openAddModal('feed', feed)} class="text-blue-500 p-1" aria-label="Edit feed">✏️</button>
                    <button onclick={() => deleteFeed(feed.id!)} class="text-red-500 p-1" aria-label="Delete feed">🗑️</button>
                  </span>
                </span>
              </div>
            </li>
          {/each}
        {/each}
        {#each feeds.filter(f => !f.folderId) as feed}
          <li class="group">
            <div class="w-full text-left px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-sm {selectedFeedId === feed.id ? 'bg-blue-100 dark:bg-blue-900' : ''}" onclick={() => selectFeed(feed.id!)} role="button" tabindex="0" onkeypress={(e) => e.key === 'Enter' && selectFeed(feed.id!)}>
              <span class="flex justify-between items-center">
                <span>{feed.title}</span>
                <span class="hidden group-hover:inline-flex gap-1">
                  <button onclick={() => openAddModal('feed', feed)} class="text-blue-500 p-1" aria-label="Edit feed">✏️</button>
                  <button onclick={() => deleteFeed(feed.id!)} class="text-red-500 p-1" aria-label="Delete feed">🗑️</button>
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
      <h2 class="font-semibold text-lg">{currentTitle} <button onclick={() => refreshFeeds()}>Refresh</button></h2>
      <div class="flex items-center gap-2">
        <input type="search" placeholder="Search..." bind:value={searchQuery} class="border rounded px-3 py-1 bg-gray-50 dark:bg-gray-700" />
        <select 
          value={sortBy} 
          onchange={handleSortChange}
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
        {#each filteredArticles as article, index}
          <div class="bg-white dark:bg-gray-800 p-4 rounded shadow mb-4 hover:shadow-md transition-all duration-300 overflow-hidden" class:expanded={isArticleExpanded(index)}>
            <div class="flex items-start gap-4" onclick={() => toggleArticle(index)} role="button" tabindex="0" onkeypress={(e) => e.key === 'Enter' && toggleArticle(index)}>
              {#if article.image}
                <img src={article.image} alt="" class="w-32 h-32 object-cover rounded flex-shrink-0" />
              {/if}
              <div class="flex-1">
                <h3 class="font-bold text-lg mb-1">
                  <a href={article.link} target="_blank" rel="noopener noreferrer" class="hover:underline text-blue-600 dark:text-blue-400">{article.title}</a>
                </h3>
                <p class="text-gray-600 dark:text-gray-400 text-sm mb-2">{feeds.find(f => f.id === article.feedId)?.title || 'Unknown'} - {new Date(article.pubDate).toLocaleDateString()}</p>
                <div class="overflow-hidden transition-all duration-300 article-content" style="max-height: {isArticleExpanded(index) ? '2000px' : '4.5em'};">
                  <div class="text-gray-700 dark:text-gray-300">{@html getDisplayContent(article, index)}</div>
                </div>
              </div>
              <div class="flex items-center gap-2 ml-4" role="presentation">
                <button onclick={() => toggleStarred(article.id!, article.starred)} class="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">{article.starred ? '⭐' : '☆'}</button>
                {#if !article.read}<button onclick={() => markAsRead(article.id!)} class="px-2 py-1 text-xs bg-blue-600 text-white rounded">Mark read</button>{/if}
              </div>
            </div>
            <div class="text-center mt-2">
              <span class="text-xs text-gray-400">{isArticleExpanded(index) ? '▲ Click to collapse' : '▼ Click to read more'}</span>
            </div>
          </div>
        {/each}
        <!-- Load more trigger for infinite scroll -->
        <div bind:this={loadTrigger} class="h-4">
          {#if isLoadingMore}
            <p class="text-center text-gray-500 py-2">Loading more...</p>
          {:else if !hasMoreArticles && filteredArticles.length > 0}
            <p class="text-center text-gray-400 py-2">No more articles</p>
          {/if}
        </div>
      {/if}
    </div>
  </main>
</div>

{#if showAddModal}
  <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onclick={(e) => e.target === e.currentTarget && closeModal()} onkeydown={(e) => e.key === 'Escape' && closeModal()} role="dialog" aria-modal="true" tabindex="-1">
    <form class="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold text-gray-900 dark:text-gray-100">
          {editingId ? (addMode === 'feed' ? 'Edit Feed' : addMode === 'folder' ? 'Edit Folder' : 'Edit View') : (addMode === 'feed' ? 'Add Feed' : addMode === 'folder' ? 'Add Folder' : 'Add View')}
        </h2>
        <button onclick={closeModal} class="text-gray-500 hover:text-gray-700" aria-label="Close">✕</button>
      </div>
      <div class="flex mb-4 border-b border-gray-200 dark:border-gray-700">
        <button class="flex-1 py-2 text-center {addMode === 'feed' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500'}" onclick={() => addMode = 'feed'}>Feed</button>
        <button class="flex-1 py-2 text-center {addMode === 'folder' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500'}" onclick={() => addMode = 'folder'}>Folder</button>
        <button class="flex-1 py-2 text-center {addMode === 'view' ? 'border-b-2 border-green-600 text-green-600' : 'text-gray-500'}" onclick={() => addMode = 'view'}>View</button>
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
			<button class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 rounded disabled:opacity-50" onclick={addFeed} disabled={feedLoading}>{feedLoading ? 'Saving...' : (editingId ? 'Update Feed' : 'Add Feed')}</button>
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
          <button class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 rounded" onclick={addFolder}>{editingId ? 'Update Folder' : 'Add Folder'}</button>
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
          <button class="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-2 rounded" onclick={addView}>{editingId ? 'Update View' : 'Add View'}</button>
        </div>
      {/if}
    </form>
  </div>
{/if}
