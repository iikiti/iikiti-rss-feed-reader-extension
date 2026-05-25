<script lang="ts">
import { onMount } from 'svelte';
import { browser } from '$app/environment';
import { db, type Article, getCurrentUserId, getAllUsers, setCurrentUserId, searchArticles, getPaginatedArticles, getAllArticleCounts, type ArticleCounts, updateFeedOrder, updateFolderOrder, type SortOption, type SearchOptions } from '$lib/db';
import { fetchAndParseFeed } from '$lib/feed';
import { segmentWords, generateAllNgrams, getSegmenter, normalizeLanguage } from '$lib/text-segmenter';
import { SvelteSet } from 'svelte/reactivity';
import {
	Feed, Folder, View,
	feedsFromData, foldersFromData, viewsFromData,
	createFeedFormState, createFolderFormState, createViewFormState,
	type FeedFormState, type FolderFormState, type ViewFormState
} from '$lib/models';
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
let editingItem: Feed | Folder | View | null = $state(null);

let selectedViewId: number | null = $state(null);
let selectedFolderId: number | null = $state(null);
let selectedFeedId: number | null = $state(null);
let searchQuery = $state('');
let useNgrams = $state(true);
let searchLanguage = $state('');

let feedForm: FeedFormState = $state(createFeedFormState());
let folderForm: FolderFormState = $state(createFolderFormState());
let viewForm: ViewFormState = $state(createViewFormState());

let sortBy: SortOption = $state('pubDateDesc');

let articleOffset = $state(0);
let hasMoreArticles = $state(true);
let isLoadingMore = $state(false);
let loadTrigger: HTMLDivElement | null = $state(null);

let folderSearchQuery = $state('');

let totalArticleCounts = $state({ total: 0, unread: 0 });

let expandedFolders = new SvelteSet<number>([]);

let feedCounts = $state<Record<number, ArticleCounts>>({});
let folderCounts = $state<Record<number, ArticleCounts>>({});
let viewCounts = $state<Record<number, ArticleCounts>>({});

let draggedItem: { type: 'folder' | 'feed'; id: number } | null = $state(null);
let dragOverItem: { type: 'folder' | 'feed'; id: number; position: 'above' | 'below' | 'on' } | null = $state(null);

const filteredFolders = $derived(
	folders.filter(f => f.name.toLowerCase().includes(folderSearchQuery.toLowerCase()) && f.id !== editingItem?.id)
);

const availableParentFolders = $derived(
	folders.filter(f => {
		if (f.id === editingItem?.id) return false;
		if (f.parentId === editingItem?.id) return false;
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

async function loadAllCounts() {
	if (!currentUserId) return;
	const feedData = feeds.map(f => ({ id: f.id, url: f.url, folderId: f.folderId, userId: currentUserId, title: f.title, order: f.order }));
	const folderData = folders.map(f => ({ id: f.id, name: f.name, parentId: f.parentId, userId: currentUserId, order: f.order }));
	const viewData = views.map(v => ({ id: v.id, name: v.name, filterJson: v.filterJson, userId: currentUserId }));
	const { feedCounts: fc, folderCounts: flc, viewCounts: vc, totalCounts } =
		await getAllArticleCounts(currentUserId, feedData as any, folderData as any, viewData as any);
	
	for (const feed of feeds) {
		feed.setCounts(fc[feed.id!] || { total: 0, unread: 0 });
	}
	for (const folder of folders) {
		folder.setCounts(flc[folder.id!] || { total: 0, unread: 0 });
	}
	for (const view of views) {
		view.setCounts(vc[view.id!] || { total: 0, unread: 0 });
	}
	feedCounts = fc;
	folderCounts = flc;
	viewCounts = vc;
	totalArticleCounts = totalCounts;
}

const sortedRootFolders = $derived(
	[...folders.filter(f => !f.parentId)].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
);

const sortedUnfolderedFeeds = $derived(
	[...feeds.filter(f => !f.folderId)].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
);

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
	const target = event.currentTarget as HTMLElement;
	const rect = target.getBoundingClientRect();
	const relativeY = event.clientY - rect.top;
	const height = rect.height;
	let position: 'above' | 'below' | 'on' = 'on';
	if (relativeY < height * 0.3) {
		position = 'above';
	} else if (relativeY > height * 0.7) {
		position = 'below';
	}
	dragOverItem = { type, id, position };
}

function handleDragLeave(event: DragEvent) {
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
	if (draggedItem.type === targetType && draggedItem.id === targetId) {
		draggedItem = null;
		return;
	}

	let items: (Folder | Feed)[] = [];
	let parentId: number | undefined = undefined;

	if (targetType === 'folder') {
		const targetFolder = folders.find(f => f.id === targetId);
		parentId = targetFolder?.parentId;
		items = folders.filter(f => f.parentId === parentId);
	} else {
		const targetFeed = feeds.find(f => f.id === targetId);
		parentId = targetFeed?.folderId;
		if (parentId === undefined) {
			items = feeds.filter(f => !f.folderId);
		} else {
			items = feeds.filter(f => f.folderId === parentId);
		}
	}

	const draggedIndex = items.findIndex(item => item.id === draggedItem!.id);
	const targetIndex = items.findIndex(item => item.id === targetId);

	if (draggedIndex === -1 || targetIndex === -1) {
		draggedItem = null;
		return;
	}

	let newIndex: number;
	if (position === 'above') {
		newIndex = targetIndex;
	} else if (position === 'below') {
		newIndex = targetIndex + 1;
	} else {
		newIndex = targetIndex;
	}
	
	if (draggedIndex < targetIndex && position !== 'above') {
		newIndex -= 1;
	}

	const [removed] = items.splice(draggedIndex, 1);
	items.splice(newIndex, 0, removed);

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

	await loadData();
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
				const filter = view.filter;
				if (filter.read === 'unread' && article.read) return false;
				if (filter.read === 'read' && !article.read) return false;
				if (filter.starred === 'starred' && !article.starred) return false;
			}
		}
		if (searchQuery) {
			const locale = searchLanguage ? normalizeLanguage(searchLanguage) : (article.language ? normalizeLanguage(article.language) : undefined);
			const queryWords = segmentWords(searchQuery, locale);
			const searchTerms = useNgrams
				? [...new Set([...queryWords, ...generateAllNgrams(queryWords, 3)])]
				: queryWords;
			return searchTerms.length > 0 && (
				article.titleWords?.some(w => searchTerms.some(sw => w.includes(sw))) ||
				article.snippetWords?.some(w => searchTerms.some(sw => w.includes(sw))) ||
				article.siteContentWords?.some(w => searchTerms.some(sw => w.includes(sw))) ||
				(useNgrams && (article.titleNgrams?.some(n => searchTerms.some(sw => n.includes(sw))) ||
				article.snippetNgrams?.some(n => searchTerms.some(sw => n.includes(sw))) ||
				article.siteContentNgrams?.some(n => searchTerms.some(sw => n.includes(sw)))))
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

const unreadCount = $derived(totalArticleCounts.unread);
const totalCount = $derived(totalArticleCounts.total);

let observer: IntersectionObserver | null = null;

onMount(() => {
	(async () => {
		await loadUsers();
		await loadData();
	})();
	
	if (browser) {
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

$effect(() => {
	void searchQuery;
	loadData();
});

async function loadUsers() {
	users = await getAllUsers();
	currentUserId = await getCurrentUserId();
}

async function switchUser(userId: number) {
	await setCurrentUserId(userId);
	currentUserId = userId;
	selectedViewId = null;
	selectedFolderId = null;
	selectedFeedId = null;
	await loadData();
}

function refreshFeeds() {
	if (browser) {
		chrome.runtime.sendMessage({ type: 'refresh-feeds' });
	}
}

async function loadData() {
	if (!currentUserId) {
		currentUserId = await getCurrentUserId();
	}
	const feedData = await db.feeds.where('userId').equals(currentUserId).toArray();
	const folderData = await db.folders.where('userId').equals(currentUserId).toArray();
	const viewData = await db.views.where('userId').equals(currentUserId).toArray();
	
	feeds = feedsFromData(feedData);
	folders = foldersFromData(folderData);
	views = viewsFromData(viewData);
	
	await loadAllCounts();
	
	articleOffset = 0;

	if (searchQuery) {
		const searchOptions: SearchOptions = {
			limit: 25,
			offset: 0,
			useNgrams,
			language: searchLanguage || undefined
		};
		const searchResults = await searchArticles(currentUserId, searchQuery, searchOptions);
		articles = searchResults;
		hasMoreArticles = searchResults.length >= 25;
	} else {
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
		const searchOptions: SearchOptions = {
			limit: 25,
			offset: nextOffset,
			useNgrams,
			language: searchLanguage || undefined
		};
		const moreResults = await searchArticles(currentUserId, searchQuery, searchOptions);
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
	editingItem = item ?? null;
	
	if (item) {
		if ('url' in item && 'title' in item) {
			feedForm = {
				url: item.url,
				title: item.title,
				folderId: item.folderId || null,
				error: '',
				loading: false
			};
		} else if ('parentId' in item) {
			folderForm = createFolderFormState();
			folderForm.name = item.name;
			folderForm.parentId = item.parentId || null;
		} else if ('filterJson' in item) {
			viewForm = createViewFormState();
			viewForm.name = item.name;
			viewForm.filter = item.filter;
		}
	} else {
		feedForm = createFeedFormState();
		folderForm = createFolderFormState();
		viewForm = createViewFormState();
	}
	folderSearchQuery = '';
	showAddModal = true;
}

function closeModal() { showAddModal = false; }

async function saveFeed() {
	const userId = currentUserId!;
	if (editingItem instanceof Feed) {
		const success = await editingItem.save(userId, feedForm, true);
		if (success) closeModalAndReload();
	} else {
		const newFeed = new Feed({ userId, url: feedForm.url, title: feedForm.title });
		const success = await newFeed.save(userId, feedForm, false);
		if (success) closeModalAndReload();
	}
}

async function saveFolder() {
	const userId = currentUserId!;
	if (editingItem instanceof Folder) {
		const success = await editingItem.save(userId, folderForm, true);
		if (success) closeModalAndReload();
	} else {
		const newFolder = new Folder({ userId, name: folderForm.name });
		const success = await newFolder.save(userId, folderForm, false);
		if (success) closeModalAndReload();
	}
}

async function saveView() {
	const userId = currentUserId!;
	if (editingItem instanceof View) {
		const success = await editingItem.save(userId, viewForm, true);
		if (success) closeModalAndReload();
	} else {
		const newView = new View({ userId, name: viewForm.name, filterJson: '{}' });
		const success = await newView.save(userId, viewForm, false);
		if (success) closeModalAndReload();
	}
}

function closeModalAndReload() {
	closeModal();
	loadData();
}

async function deleteFeed(id: number) {
	if (confirm('Delete this feed?')) {
		const feed = feeds.find(f => f.id === id);
		if (feed) {
			await feed.delete();
			await loadData();
		}
	}
}

async function deleteFolder(id: number) {
	if (confirm('Delete this folder? Feeds will be moved to ungrouped.')) {
		const folder = folders.find(f => f.id === id);
		if (folder) {
			const feedData = await db.feeds.where('userId').equals(currentUserId!).toArray();
			await folder.delete(feedData);
			await loadData();
		}
	}
}

async function deleteView(id: number) {
	if (confirm('Delete this view?')) {
		const view = views.find(v => v.id === id);
		if (view) {
			await view.delete();
			await loadData();
		}
	}
}

async function markAsRead(id: number) { await db.articles.update(id, { read: true }); await loadData(); }
async function toggleStarred(id: number, current: boolean) { await db.articles.update(id, { starred: !current }); await loadData(); }

let expandedIndices = new SvelteSet<number>([]);

function toggleArticle(index: number) {
	if (expandedIndices.has(index)) {
		expandedIndices.delete(index);
	} else {
		expandedIndices.clear();
		expandedIndices.add(index);
	}
}

function isArticleExpanded(index: number): boolean {
	return expandedIndices.has(index);
}

function getDisplayContent(article: Article, index: number): string {
	const isExpanded = isArticleExpanded(index);
	
	if (isExpanded) {
		const content = article.content || '';
		const siteContent = article.siteContent || '';
		const contentLen = content.length;
		const siteContentLen = siteContent.length;
		
		if (siteContentLen > contentLen) {
			return siteContent;
		} else if (contentLen > 0) {
			return content;
		} else {
			return article.snippet;
		}
	} else {
		const content = article.content || article.snippet || '';
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
		{viewCounts}
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
		bind:useNgrams
		bind:searchLanguage
		userId={currentUserId ?? undefined}
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
	title={editingItem ? (addMode === 'feed' ? 'Edit Feed' : addMode === 'folder' ? 'Edit Folder' : 'Edit View') : (addMode === 'feed' ? 'Add Feed' : addMode === 'folder' ? 'Add Folder' : 'Add View')}
	open={showAddModal}
	onclose={closeModal}
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
				<input id="feed-url" type="url" bind:value={feedForm.url} placeholder="https://example.com/feed.xml" class="w-full px-3 py-2 border rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100" />
			</div>
			<div>
				<label for="feed-title" class="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Feed Title</label>
				<input id="feed-title" type="text" bind:value={feedForm.title} placeholder="Feed title" class="w-full px-3 py-2 border rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100" />
			</div>
			<div>
				<label for="folder-select" class="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Folder (optional)</label>
				<input id="folder-search" type="text" bind:value={folderSearchQuery} placeholder="Search..." class="w-full px-3 py-2 mb-2 border rounded bg-white dark:bg-gray-700" />
				<div class="max-h-40 overflow-y-auto border rounded bg-white dark:bg-gray-700 p-2">
					<label class="flex items-center gap-2 p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-600">
						<input type="radio" name="folder" value={null} bind:group={feedForm.folderId} />
						<span class="text-gray-700 dark:text-gray-300">No folder</span>
					</label>
					{#each filteredFolders as folder}
						<label class="flex items-center gap-2 p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-600">
							<input type="radio" name="folder" value={folder.id} bind:group={feedForm.folderId} />
							<span class="text-gray-700 dark:text-gray-300">{folder.name}</span>
						</label>
					{/each}
				</div>
			</div>
			{#if feedForm.error}<p class="text-red-500 text-sm">{feedForm.error}</p>{/if}
			<button class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 rounded disabled:opacity-50" onclick={saveFeed} disabled={feedForm.loading}>{feedForm.loading ? 'Saving...' : (editingItem ? 'Update Feed' : 'Add Feed')}</button>
		</div>
	{:else if addMode === 'folder'}
		<div class="space-y-4">
			<div>
				<label for="folder-name" class="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Folder Name</label>
				<input id="folder-name" type="text" bind:value={folderForm.name} placeholder="Enter folder name" class="w-full px-3 py-2 border rounded bg-white dark:bg-gray-700" />
			</div>
			<div>
				<label for="parent-folder" class="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Parent Folder (optional)</label>
				<select id="parent-folder" bind:value={folderForm.parentId} class="w-full px-3 py-2 border rounded bg-white dark:bg-gray-700">
					<option value={null}>No parent (root)</option>
					{#each availableParentFolders as f}<option value={f.id}>{f.name}</option>{/each}
				</select>
			</div>
			{#if folderForm.error}<p class="text-red-500 text-sm">{folderForm.error}</p>{/if}
			<button class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 rounded" onclick={saveFolder}>{editingItem ? 'Update Folder' : 'Add Folder'}</button>
		</div>
	{:else}
		<div class="space-y-4">
			<div>
				<label for="view-name" class="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">View Name</label>
				<input id="view-name" type="text" bind:value={viewForm.name} placeholder="e.g., Unread" class="w-full px-3 py-2 border rounded bg-white dark:bg-gray-700" />
			</div>
			<div>
				<label for="view-read" class="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Filter: Read Status</label>
				<select id="view-read" bind:value={viewForm.filter.read} class="w-full px-3 py-2 border rounded bg-white dark:bg-gray-700">
					<option value="all">All</option>
					<option value="unread">Unread only</option>
					<option value="read">Read only</option>
				</select>
			</div>
			<div>
				<label for="view-starred" class="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Filter: Starred</label>
				<select id="view-starred" bind:value={viewForm.filter.starred} class="w-full px-3 py-2 border rounded bg-white dark:bg-gray-700">
					<option value="all">All</option>
					<option value="starred">Starred only</option>
				</select>
			</div>
			{#if viewForm.error}<p class="text-red-500 text-sm">{viewForm.error}</p>{/if}
			<button class="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-2 rounded" onclick={saveView}>{editingItem ? 'Update View' : 'Add View'}</button>
		</div>
	{/if}
</Modal>