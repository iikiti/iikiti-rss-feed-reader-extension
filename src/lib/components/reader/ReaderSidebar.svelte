<script lang="ts">
	import type { Feed, Folder, View, SortOption } from '$lib/db';
	import type { SvelteSet } from 'svelte/reactivity';
	import SidebarItem from '$lib/components/sidebar/SidebarItem.svelte';

	type DragOverItem = { type: 'folder' | 'feed'; id: number; position: 'above' | 'below' | 'on' } | null;

	let {
		currentUserId,
		users,
		feeds,
		folders,
		views,
		feedCounts,
		folderCounts,
		viewCounts,
		expandedFolders,
		selectedFeedId,
		selectedFolderId,
		selectedViewId,
		unreadCount,
		totalCount,
		dragOverItem,
		sortedRootFolders,
		sortedUnfolderedFeeds,
		onSwitchUser,
		onOpenAddModal,
		onSelectAllArticles,
		onSelectView,
		onSelectFolder,
		onSelectFeed,
		onDeleteView,
		onDeleteFolder,
		onDeleteFeed,
		onEditFolder,
		onEditFeed,
		toggleFolderExpand,
		handleDragStart,
		handleDragOver,
		handleDragLeave,
		handleDrop,
		handleDragEnd
	}: {
		currentUserId: number | null;
		users: { id?: number; name: string; createdAt: number }[];
		feeds: Feed[];
		folders: Folder[];
		views: View[];
	feedCounts: Record<number, { total: number; unread: number }>;
	folderCounts: Record<number, { total: number; unread: number }>;
	viewCounts: Record<number, { total: number; unread: number }>;
		expandedFolders: SvelteSet<number>;
		selectedFeedId: number | null;
		selectedFolderId: number | null;
		selectedViewId: number | null;
		unreadCount: number;
		totalCount: number;
		dragOverItem: DragOverItem;
		sortedRootFolders: Folder[];
		sortedUnfolderedFeeds: Feed[];
		onSwitchUser: (id: number) => void;
		onOpenAddModal: (mode: 'feed' | 'folder' | 'view', item?: Feed | Folder | View) => void;
		onSelectAllArticles: () => void;
		onSelectView: (id: number) => void;
		onSelectFolder: (id: number) => void;
		onSelectFeed: (id: number) => void;
		onDeleteView: (id: number) => void;
		onDeleteFolder: (id: number) => void;
		onDeleteFeed: (id: number) => void;
		onEditFolder: (f: Folder) => void;
		onEditFeed: (f: Feed) => void;
		toggleFolderExpand: (id: number) => void;
		handleDragStart: (e: DragEvent, type: 'folder' | 'feed', id: number) => void;
		handleDragOver: (e: DragEvent, type: 'folder' | 'feed', id: number) => void;
		handleDragLeave: (e: DragEvent) => void;
		handleDrop: (e: DragEvent, targetType: 'folder' | 'feed', targetId: number) => void;
		handleDragEnd: () => void;
	} = $props();
</script>

<aside class="w-64 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col">
	<!-- Header -->
	<div class="p-4 border-b border-gray-200 dark:border-gray-700">
		<div class="flex justify-between items-center mb-2">
			<h1 class="text-xl font-bold">iikiti</h1>
			<div class="flex items-center space-x-1">
				<button onclick={() => onOpenAddModal('feed')} class="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 p-1" title="Add">+</button>
				<a href="/settings" class="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">⚙️</a>
			</div>
		</div>
		<!-- User Switcher -->
		<div class="text-sm">
			<label for="user-select" class="text-xs text-gray-500">User:</label>
			<select
				id="user-select"
				value={currentUserId}
				onchange={(e) => onSwitchUser(parseInt(e.currentTarget.value))}
				class="w-full mt-1 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-sm"
			>
				{#each users as user}
					<option value={user.id}>{user.name}</option>
				{/each}
			</select>
		</div>
	</div>

	<!-- Nav -->
	<div class="p-2 overflow-y-auto flex-1">
		<div class="mb-2 flex gap-1">
			<button onclick={() => onOpenAddModal('feed')} class="flex-1 text-xs bg-blue-600 text-white py-1 rounded">+ Feed</button>
			<button onclick={() => onOpenAddModal('folder')} class="flex-1 text-xs bg-gray-600 text-white py-1 rounded">+ Folder</button>
			<button onclick={() => onOpenAddModal('view')} class="flex-1 text-xs bg-green-600 text-white py-1 rounded">+ View</button>
		</div>

		<div class="text-xs font-bold uppercase text-gray-500 mb-1 px-2">Views</div>
		<ul class="mb-3">
			{#each views as view}
				<SidebarItem
					type="view"
					{view}
					viewCount={viewCounts[view.id!] || { total: 0, unread: 0 }}
					selected={selectedViewId === view.id}
					onselect={() => onSelectView(view.id!)}
					onedit={() => onOpenAddModal('view', view)}
					ondelete={() => onDeleteView(view.id!)}
				/>
			{/each}
		</ul>

		<div class="text-xs font-bold uppercase text-gray-500 mb-1 px-2">Feeds</div>
		<ul>
		<li>
			<div
				class="w-full text-left px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 {selectedFeedId === null && selectedFolderId === null ? 'bg-blue-100 dark:bg-blue-900' : ''}"
					onclick={onSelectAllArticles}
					role="button"
					tabindex="0"
					onkeypress={(e) => e.key === 'Enter' && onSelectAllArticles()}
				>
					All Articles <span class="text-xs text-gray-500">({unreadCount}/{totalCount})</span>
				</div>
			</li>
			{#each sortedRootFolders as folder}
				<SidebarItem
					type="folder"
					{folder}
					folderCount={folderCounts[folder.id!] || { total: 0, unread: 0 }}
					allFolders={folders}
					allFeeds={feeds}
					{feedCounts}
					{folderCounts}
					{expandedFolders}
					{selectedFeedId}
					{selectedFolderId}
					{dragOverItem}
					depth={0}
					onSelectFolder={onSelectFolder}
					onSelectFeed={onSelectFeed}
					onEditFolder={onEditFolder}
					onDeleteFolder={onDeleteFolder}
					onEditFeed={onEditFeed}
					onDeleteFeed={onDeleteFeed}
					{toggleFolderExpand}
					{handleDragStart}
					{handleDragOver}
					{handleDragLeave}
					{handleDrop}
					{handleDragEnd}
				/>
			{/each}
			{#each sortedUnfolderedFeeds as feed}
				<SidebarItem
					type="feed"
					{feed}
					feedCount={feedCounts[feed.id!] || { total: 0, unread: 0 }}
					selected={selectedFeedId === feed.id}
					depth={0}
					{dragOverItem}
					onselect={() => onSelectFeed(feed.id!)}
					onedit={() => onOpenAddModal('feed', feed)}
					ondelete={() => onDeleteFeed(feed.id!)}
					{handleDragStart}
					{handleDragOver}
					{handleDragLeave}
					{handleDrop}
					{handleDragEnd}
				/>
			{/each}
		</ul>
	</div>
</aside>
