<script lang="ts">
import { onMount } from 'svelte';
import { browser } from '$app/environment';
import { db, type Feed, type Folder, type View, type Article, getCurrentUserId, getAllUsers, setCurrentUserId, getUserArticlesSorted, searchArticles, getPaginatedArticles, getUserArticleCounts, getFeedArticleCounts, getFolderArticleCounts, updateFeedOrder, updateFolderOrder, type SortOption } from '$lib/db';
import { fetchAndParseFeed } from '$lib/feed';
import { SvelteSet } from 'svelte/reactivity';
import ReaderHeader from '$lib/components/reader/ReaderHeader.svelte';
import ReaderSidebar from '$lib/components/reader/ReaderSidebar.svelte';
import ArticleList from '$lib/components/reader/ArticleList.svelte';
import Modal from '$lib/components/Modal.svelte';

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

// Folder expand/collapse state
let expandedFolders = new SvelteSet<number>([]);

// Feed and folder counts cache
let feedCounts = $state<Record<number, { total: number; unread: number }>>({});
let folderCounts = $state<Record<number, { total: number; unread: number }>>({});

// Drag and drop state
let draggedItem: { type: 'folder' | 'feed'; id: number } | null = $state(null);
let dragOverItem: { type: 'folder' | 'feed'; id: number; position: 'above' | 'below' | 'on' } | null = $state(null);


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

	function toggleFolderExpand(folderId: number) {
		if (expandedFolders.has(folderId)) {
		  expandedFolders.delete(folderId);
		} else {
		  expandedFolders.add(folderId);
		}
	}

	function isFolderExpanded(folderId: number): boolean {
		return expandedFolders.has(folderId);
	}

	async function loadFeedAndFolderCounts() {
		if (!currentUserId) return;
		
		// Load feed counts
		const newFeedCounts: Record<number, { total: number; unread: number }> = {};
		for (const feed of feeds) {
		  if (feed.id) {
		    newFeedCounts[feed.id] = await getFeedArticleCounts(currentUserId, feed.id);
		  }
		}
		feedCounts = newFeedCounts;
		
		// Load folder counts
		const newFolderCounts: Record<number, { total: number; unread: number }> = {};
		for (const folder of folders) {
		  if (folder.id) {
		    newFolderCounts[folder.id] = await getFolderArticleCounts(currentUserId, folder.id);
		  }
		}
		folderCounts = newFolderCounts;
	}

	// Sorted folders and feeds by order
	const sortedRootFolders = $derived(
		[...folders.filter(f => !f.parentId)].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
	);

	const sortedUnfolderedFeeds = $derived(
		[...feeds.filter(f => !f.folderId)].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
	);

	function getSortedChildFolders(parentId: number) {
		return [...folders.filter(f => f.parentId === parentId)].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
	}

	function getSortedFeedsInFolder(folderId: number) {
		return [...feeds.filter(f => f.folderId === folderId)].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
	}

	// Drag and drop handlers
	function handleDragStart(event: DragEvent, type: 'folder' | 'feed', id: number) {
		draggedItem = { type, id };
		if (event.dataTransfer) {
		  event.dataTransfer.effectAllowed = 'move';
		}
	}

	function handleDragOver(event: DragEvent, type: 'folder' | 'feed', id: number) {
		event.preventDefault();
		if (event.dataTransfer) {
		  event.dataTransfer.dropEffect = 'move';
		}
		
		// Calculate position relative to the target element
		const target = event.currentTarget as HTMLElement;
		const rect = target.getBoundingClientRect();
		const relativeY = event.clientY - rect.top;
		const height = rect.height;
		
		// Determine if drag is above, below, or on the item
		// Use more generous zones (30% from top/bottom)
		let position: 'above' | 'below' | 'on' = 'on';
		if (relativeY < height * 0.3) {
		  position = 'above';
		} else if (relativeY > height * 0.7) {
		  position = 'below';
		} else {
		  position = 'on';
		}
		
		dragOverItem = { type, id, position };
	}

	function handleDragLeave(event: DragEvent) {
		// Only clear if we're leaving the container, not moving to a child element
		const relatedTarget = event.relatedTarget as Node | null;
		const currentTarget = event.currentTarget as Node;
		if (!relatedTarget || !currentTarget.contains(relatedTarget)) {
		  dragOverItem = null;
		}
	}

	async function handleDrop(event: DragEvent, targetType: 'folder' | 'feed', targetId: number) {
		event.preventDefault();
		
		const position = dragOverItem?.position ?? 'on';
		dragOverItem = null;
		
		if (!draggedItem || draggedItem.id === targetId) {
		  draggedItem = null;
		  return;
		}

		// Can't drag feed onto itself
		if (draggedItem.type === targetType && draggedItem.id === targetId) {
		  draggedItem = null;
		  return;
		}

		// Get the items being reordered
		let items: (Folder | Feed)[] = [];
		let parentId: number | undefined = undefined;

		if (targetType === 'folder') {
		  // Get folders at the same level
		  const targetFolder = folders.find(f => f.id === targetId);
		  parentId = targetFolder?.parentId;
		  items = folders.filter(f => f.parentId === parentId) as (Folder | Feed)[];
		} else {
		  // Target is a feed
		  const targetFeed = feeds.find(f => f.id === targetId);
		  parentId = targetFeed?.folderId;
		  if (parentId === undefined) {
		    items = feeds.filter(f => !f.folderId);
		  } else {
		    items = feeds.filter(f => f.folderId === parentId) as (Folder | Feed)[];
		  }
		}

		// Find current index and target index
		const draggedIndex = items.findIndex(item => item.id === draggedItem!.id);
		const targetIndex = items.findIndex(item => item.id === targetId);

		if (draggedIndex === -1 || targetIndex === -1) {
		  draggedItem = null;
		  return;
		}

		// Calculate the new index based on position
		// When dropping 'above' target, insert at targetIndex
		// When dropping 'below' target, insert at targetIndex + 1
		// When dropping 'on' target, swap positions
		let newIndex: number;
		if (position === 'above') {
		  newIndex = targetIndex;
		} else if (position === 'below') {
		  newIndex = targetIndex + 1;
		} else {
		  // 'on' - swap with target
		  newIndex = targetIndex;
		}
		
		// If dragging from a lower index to a higher index (except 'above'), need to adjust
		// because removing the item shifts all indices
		if (draggedIndex < targetIndex && position !== 'above') {
		  newIndex -= 1;
		}

		// Reorder items
		const [removed] = items.splice(draggedIndex, 1);
		items.splice(newIndex, 0, removed);

		// Update order in database
		for (let i = 0; i < items.length; i++) {
		  const itemId = items[i].id;
		  if (itemId !== undefined) {
		    if ('url' in items[i]) {
		      await updateFeedOrder(itemId, i);
		    } else {
		      await updateFolderOrder(itemId, i);
		    }
		  }
		}

		// Reload data
		await loadData();
		await loadFeedAndFolderCounts();
		draggedItem = null;
	}

	function handleDragEnd() {
		draggedItem = null;
		dragOverItem = null;
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
		
		// Load feed and folder counts
		await loadFeedAndFolderCounts();
		
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

	function selectAllArticles() { selectedViewId = null; selectedFolderId = null; selectedFeedId = null; loadData(); }
	function selectView(id: number) { selectedViewId = id; selectedFolderId = null; selectedFeedId = null; loadData(); }
	function selectFolder(id: number) { selectedViewId = null; selectedFolderId = id; selectedFeedId = null; loadData(); }
	function selectFeed(id: number) { selectedViewId = null; selectedFolderId = null; selectedFeedId = id; loadData(); }

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
	<ReaderSidebar
		{currentUserId}
		{users}
		{feeds}
		{folders}
		{views}
		{feedCounts}
		{folderCounts}
		{expandedFolders}
		{selectedFeedId}
		{selectedFolderId}
		{selectedViewId}
		{unreadCount}
		{totalCount}
		{dragOverItem}
		{sortedRootFolders}
		{sortedUnfolderedFeeds}
		onSwitchUser={switchUser}
		onOpenAddModal={openAddModal}
		onSelectAllArticles={selectAllArticles}
		onSelectView={selectView}
		onSelectFolder={selectFolder}
		onSelectFeed={selectFeed}
		onDeleteView={deleteView}
		onDeleteFolder={deleteFolder}
		onDeleteFeed={deleteFeed}
		onEditFolder={(f) => openAddModal('folder', f)}
		onEditFeed={(f) => openAddModal('feed', f)}
		{toggleFolderExpand}
		{handleDragStart}
		{handleDragOver}
		{handleDragLeave}
		{handleDrop}
		{handleDragEnd}
	/>

	<main class="flex-1 flex flex-col overflow-hidden">
		<ReaderHeader
			{currentTitle}
			{sortBy}
			bind:searchQuery
			onRefresh={refreshFeeds}
			onSortChange={handleSortChange}
		/>
		<ArticleList
			articles={filteredArticles}
			{feeds}
			{isLoadingMore}
			{hasMoreArticles}
			{expandedIndices}
			bind:loadTrigger
			onToggleArticle={toggleArticle}
			onToggleStarred={toggleStarred}
			onMarkAsRead={markAsRead}
			{getDisplayContent}
		/>
	</main>
</div>

<Modal
	title={editingId ? (addMode === 'feed' ? 'Edit Feed' : addMode === 'folder' ? 'Edit Folder' : 'Edit View') : (addMode === 'feed' ? 'Add Feed' : addMode === 'folder' ? 'Add Folder' : 'Add View')}
	open={showAddModal}
	on:close={closeModal}
>
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
				<input id="feed-title" type="text" bind:value={feedTitle} placeholder="Feed title" class="w-full px-3 py-2 border rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100" />
			</div>
			<div>
				<label for="folder-select" class="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Folder (optional)</label>
				<input id="folder-search" type="text" bind:value={folderSearchQuery} placeholder="Search..." class="w-full px-3 py-2 mb-2 border rounded bg-white dark:bg-gray-700" />
				<div class="max-h-40 overflow-y-auto border rounded bg-white dark:bg-gray-700 p-2">
					<label class="flex items-center gap-2 p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-600">
						<input type="radio" name="folder" value={null} bind:group={feedFolderId} />
						<span class="text-gray-700 dark:text-gray-300">No folder</span>
					</label>
					{#each filteredFolders as folder}
						<label class="flex items-center gap-2 p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-600">
							<input type="radio" name="folder" value={folder.id} bind:group={feedFolderId} />
							<span class="text-gray-700 dark:text-gray-300">{folder.name}</span>
						</label>
					{/each}
				</div>
			</div>
			{#if feedError}<p class="text-red-500 text-sm">{feedError}</p>{/if}
			<button class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 rounded disabled:opacity-50" onclick={addFeed} disabled={feedLoading}>{feedLoading ? 'Saving...' : (editingId ? 'Update Feed' : 'Add Feed')}</button>
		</div>
	{:else if addMode === 'folder'}
		<div class="space-y-4">
			<div>
				<label for="folder-name" class="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Folder Name</label>
				<input id="folder-name" type="text" bind:value={folderName} placeholder="Enter folder name" class="w-full px-3 py-2 border rounded bg-white dark:bg-gray-700" />
			</div>
			<div>
				<label for="parent-folder" class="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Parent Folder (optional)</label>
				<select id="parent-folder" bind:value={folderParentId} class="w-full px-3 py-2 border rounded bg-white dark:bg-gray-700">
					<option value={null}>No parent (root)</option>
					{#each availableParentFolders as f}<option value={f.id}>{f.name}</option>{/each}
				</select>
			</div>
			{#if folderError}<p class="text-red-500 text-sm">{folderError}</p>{/if}
			<button class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 rounded" onclick={addFolder}>{editingId ? 'Update Folder' : 'Add Folder'}</button>
		</div>
	{:else}
		<div class="space-y-4">
			<div>
				<label for="view-name" class="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">View Name</label>
				<input id="view-name" type="text" bind:value={viewName} placeholder="e.g., Unread" class="w-full px-3 py-2 border rounded bg-white dark:bg-gray-700" />
			</div>
			<div>
				<label for="view-read" class="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Filter: Read Status</label>
				<select id="view-read" bind:value={viewFilterRead} class="w-full px-3 py-2 border rounded bg-white dark:bg-gray-700">
					<option value="all">All</option>
					<option value="unread">Unread only</option>
					<option value="read">Read only</option>
				</select>
			</div>
			<div>
				<label for="view-starred" class="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Filter: Starred</label>
				<select id="view-starred" bind:value={viewFilterStarred} class="w-full px-3 py-2 border rounded bg-white dark:bg-gray-700">
					<option value="all">All</option>
					<option value="starred">Starred only</option>
				</select>
			</div>
			{#if viewError}<p class="text-red-500 text-sm">{viewError}</p>{/if}
			<button class="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-2 rounded" onclick={addView}>{editingId ? 'Update View' : 'Add View'}</button>
		</div>
	{/if}
</Modal>
