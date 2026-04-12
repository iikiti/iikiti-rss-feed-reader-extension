<script lang="ts">
import type { ArticleCounts } from '$lib/db';
import type { SvelteSet } from 'svelte/reactivity';
import type { Feed as FeedModel, Folder as FolderModel } from '$lib/models';
import FeedItem from './FeedItem.svelte';
import FolderItem from './FolderItem.svelte';

type DragOverItem = { type: 'folder' | 'feed'; id: number; position: 'above' | 'below' | 'on' } | null;

let {
	folder,
	folders = [],
	feeds = [],
	feedCounts = {},
	folderCounts = {},
	expandedFolders,
	selectedFeedId,
	selectedFolderId,
	dragOverItem,
	depth = 0,
	onSelectFolder,
	onSelectFeed,
	onEditFolder,
	onDeleteFolder,
	onEditFeed,
	onDeleteFeed,
	toggleFolderExpand,
	handleDragStart,
	handleDragOver,
	handleDragLeave,
	handleDrop,
	handleDragEnd
}: {
	folder: FolderModel;
	folders?: FolderModel[];
	feeds?: FeedModel[];
	feedCounts?: Record<number, ArticleCounts>;
	folderCounts?: Record<number, ArticleCounts>;
	expandedFolders: SvelteSet<number>;
	selectedFeedId: number | null;
	selectedFolderId: number | null;
	dragOverItem: DragOverItem;
	depth?: number;
	onSelectFolder?: (id: number) => void;
	onSelectFeed?: (id: number) => void;
	onEditFolder?: (f: FolderModel) => void;
	onDeleteFolder?: (id: number) => void;
	onEditFeed?: (f: FeedModel) => void;
	onDeleteFeed?: (id: number) => void;
	toggleFolderExpand?: (id: number) => void;
	handleDragStart?: (e: DragEvent, type: 'folder' | 'feed', id: number) => void;
	handleDragOver?: (e: DragEvent, type: 'folder' | 'feed', id: number) => void;
	handleDragLeave?: (e: DragEvent) => void;
	handleDrop?: (e: DragEvent, targetType: 'folder' | 'feed', targetId: number) => void;
	handleDragEnd?: () => void;
} = $props();

const count = $derived(folderCounts[folder.id!] || { total: 0, unread: 0 });
const isExpanded = $derived(expandedFolders.has(folder.id!));
const isSelected = $derived(selectedFolderId === folder.id);
const childFolders = $derived(folders.filter(f => f.parentId === folder.id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)));
const folderFeeds = $derived(feeds.filter(f => f.folderId === folder.id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)));

function isDragOver(): boolean {
	if (!dragOverItem) return false;
	return dragOverItem.type === 'folder' && dragOverItem.id === folder.id;
}

function getDragOverClass(): string {
	if (!isDragOver()) return '';
	const pos = dragOverItem!.position;
	if (pos === 'above') return 'border-t-2 border-blue-500';
	if (pos === 'below') return 'border-b-2 border-blue-500';
	return 'ring-2 ring-blue-500';
}
</script>

<li>
	<div
		class="flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 {isSelected ? 'bg-blue-100 dark:bg-blue-900' : ''} {getDragOverClass()}"
		draggable="true"
		ondragstart={(e) => handleDragStart?.(e, 'folder', folder.id!)}
		ondragover={(e) => handleDragOver?.(e, 'folder', folder.id!)}
		ondragleave={handleDragLeave}
		ondrop={(e) => handleDrop?.(e, 'folder', folder.id!)}
		ondragend={handleDragEnd}
		role="button"
		tabindex="0"
		onclick={() => onSelectFolder?.(folder.id!)}
		onkeypress={(e) => e.key === 'Enter' && onSelectFolder?.(folder.id!)}
	>
		<button onclick={(e) => { e.stopPropagation(); toggleFolderExpand?.(folder.id!); }} class="text-gray-500 hover:text-gray-700 w-4 text-center">
			{isExpanded ? '▼' : '▶'}
		</button>
		<span class="text-gray-400">📁</span>
		<span class="flex-1 truncate">{folder.name}</span>
		<span class="text-xs text-gray-500">({count.unread}/{count.total})</span>
		<button onclick={(e) => { e.stopPropagation(); onEditFolder?.(folder); }} class="text-gray-400 hover:text-gray-600 p-1" title="Edit">✎</button>
		<button onclick={(e) => { e.stopPropagation(); onDeleteFolder?.(folder.id!); }} class="text-gray-400 hover:text-red-600 p-1" title="Delete">✕</button>
	</div>
	
	{#if isExpanded}
		<ul class="ml-4">
			{#each childFolders as childFolder (childFolder.id)}
				<FolderItem
					folder={childFolder}
					{folders}
					{feeds}
					{feedCounts}
					{folderCounts}
					{expandedFolders}
					{selectedFeedId}
					{selectedFolderId}
					{dragOverItem}
					depth={depth + 1}
					{onSelectFolder}
					{onSelectFeed}
					{onEditFolder}
					{onDeleteFolder}
					{onEditFeed}
					{onDeleteFeed}
					{toggleFolderExpand}
					{handleDragStart}
					{handleDragOver}
					{handleDragLeave}
					{handleDrop}
					{handleDragEnd}
				/>
			{/each}
			{#each folderFeeds as feed (feed.id)}
				<FeedItem
					{feed}
					{feedCounts}
					selected={selectedFeedId === feed.id}
					depth={depth + 1}
					{dragOverItem}
					onSelect={() => onSelectFeed?.(feed.id!)}
					onEdit={() => onEditFeed?.(feed)}
					onDelete={() => onDeleteFeed?.(feed.id!)}
					{handleDragStart}
					{handleDragOver}
					{handleDragLeave}
					{handleDrop}
					{handleDragEnd}
				/>
			{/each}
		</ul>
	{/if}
</li>