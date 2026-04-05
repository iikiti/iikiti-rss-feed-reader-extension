<script lang="ts">
import type { Feed, Folder, View } from '$lib/db';
import type { SvelteSet } from 'svelte/reactivity';
import SidebarItem from './SidebarItem.svelte';
import Button from '$lib/components/Button.svelte';

type DragOverItem = { type: 'folder' | 'feed'; id: number; position: 'above' | 'below' | 'on' } | null;

let {
	// Type discriminator
	type,

// View-specific
view,
viewCount,

// Feed-specific
feed,
feedCount,

	// Folder-specific
	folder,
	folderCount,
	allFolders,
	allFeeds,
	feedCounts,
	folderCounts,
	expandedFolders,
	selectedFeedId,
	selectedFolderId,

	// Shared
	selected = false,
	depth = 0,
	dragOverItem = null,

	// View/feed/folder simple callbacks
	onselect,
	onedit,
	ondelete,

	// Folder-specific callbacks
	onSelectFolder,
	onSelectFeed,
	onEditFolder,
	onDeleteFolder,
	onEditFeed,
	onDeleteFeed,
	toggleFolderExpand,

	// Drag handlers (feed & folder)
	handleDragStart,
	handleDragOver,
	handleDragLeave,
	handleDrop,
	handleDragEnd
}: {
type: 'view' | 'feed' | 'folder';

view?: View;
viewCount?: { total: number; unread: number };

	feed?: Feed;
	feedCount?: { total: number; unread: number };

	folder?: Folder;
	folderCount?: { total: number; unread: number };
	allFolders?: Folder[];
	allFeeds?: Feed[];
	feedCounts?: Record<number, { total: number; unread: number }>;
	folderCounts?: Record<number, { total: number; unread: number }>;
	expandedFolders?: SvelteSet<number>;
	selectedFeedId?: number | null;
	selectedFolderId?: number | null;

	selected?: boolean;
	depth?: number;
	dragOverItem?: DragOverItem;

	onselect?: () => void;
	onedit?: () => void;
	ondelete?: () => void;

	onSelectFolder?: (id: number) => void;
	onSelectFeed?: (id: number) => void;
	onEditFolder?: (folder: Folder) => void;
	onDeleteFolder?: (id: number) => void;
	onEditFeed?: (feed: Feed) => void;
	onDeleteFeed?: (id: number) => void;
	toggleFolderExpand?: (id: number) => void;

	handleDragStart?: (e: DragEvent, type: 'folder' | 'feed', id: number) => void;
	handleDragOver?: (e: DragEvent, type: 'folder' | 'feed', id: number) => void;
	handleDragLeave?: (e: DragEvent) => void;
	handleDrop?: (e: DragEvent, targetType: 'folder' | 'feed', targetId: number) => void;
	handleDragEnd?: () => void;
} = $props();

// Hover state for showing edit/delete buttons on this specific item only
let isHovered = $state(false);

// Derived state shared across snippets
const paddingRem = $derived(0.5 + depth * 1);
const isExpanded = $derived(type === 'folder' && !!expandedFolders?.has(folder!.id!));

const isOverFeed = $derived(
	type === 'feed' && dragOverItem?.type === 'feed' && dragOverItem?.id === feed!.id
);
const isOverFolder = $derived(
	type === 'folder' && dragOverItem?.type === 'folder' && dragOverItem?.id === folder!.id
);

const childFolders = $derived(
	type === 'folder'
		? [...(allFolders ?? []).filter(f => f.parentId === folder!.id)].sort(
				(a, b) => (a.order ?? 0) - (b.order ?? 0)
			)
		: []
);
const folderFeeds = $derived(
	type === 'folder'
		? [...(allFeeds ?? []).filter(f => f.folderId === folder!.id)].sort(
				(a, b) => (a.order ?? 0) - (b.order ?? 0)
			)
		: []
);
</script>

<!-- ─── Snippets ──────────────────────────────────────────────────────────── -->

{#snippet viewContent()}
	<div
		class="w-full text-left px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700
		       {selected ? 'bg-blue-100 dark:bg-blue-900' : ''}"
		onclick={onselect}
		role="button"
		tabindex="0"
		onkeypress={(e) => e.key === 'Enter' && onselect?.()}
		onmouseenter={() => isHovered = true}
		onmouseleave={() => isHovered = false}
	>
		<span class="flex justify-between items-center">
			<span>👁️ {view!.name}</span>
			<span class="flex items-center gap-2">
				<span class="{isHovered ? 'visible' : 'invisible'} inline-flex gap-1">
					<Button variant="primary" size="sm" onclick={onedit} ariaLabel="Edit view">✏️</Button>
					<Button variant="danger" size="sm" onclick={ondelete} ariaLabel="Delete view">🗑️</Button>
				</span>
				{#if viewCount}
					<span class="text-xs text-gray-500">{viewCount.unread}/{viewCount.total}</span>
				{/if}
			</span>
		</span>
	</div>
{/snippet}

{#snippet feedContent()}
	<div
		class="w-full text-left py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-sm
		       {selected ? 'bg-blue-100 dark:bg-blue-900' : ''}"
		style="padding-left: {paddingRem}rem; padding-right: 0.5rem;"
		onclick={onselect}
		role="button"
		tabindex="0"
		onkeypress={(e) => e.key === 'Enter' && onselect?.()}
		onmouseenter={() => isHovered = true}
		onmouseleave={() => isHovered = false}
	>
		<span class="flex justify-between items-center">
			<span>📰 {feed!.title}</span>
			<span class="flex items-center gap-2">
				<span class="{isHovered ? 'visible' : 'invisible'} inline-flex gap-1">
				<Button
					variant="primary" size="sm"
					onclick={(e) => { e.stopPropagation(); onedit?.(); }}
					ariaLabel="Edit feed"
				>✏️</Button>
				<Button
					variant="danger" size="sm"
					onclick={(e) => { e.stopPropagation(); ondelete?.(); }}
					ariaLabel="Delete feed"
				>🗑️</Button>
			</span>
				<span class="text-xs text-gray-500">
					{feedCount!.unread}/{feedCount!.total}
				</span>
			</span>
		</span>
	</div>
{/snippet}

{#snippet folderContent()}
	<div
		class="w-full text-left py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 font-medium
		       {selectedFolderId === folder!.id ? 'bg-blue-100 dark:bg-blue-900' : ''}"
		style="padding-left: {paddingRem}rem; padding-right: 0.5rem;"
		onclick={() => onSelectFolder?.(folder!.id!)}
		role="button"
		tabindex="0"
		onkeypress={(e) => e.key === 'Enter' && onSelectFolder?.(folder!.id!)}
		onmouseenter={() => isHovered = true}
		onmouseleave={() => isHovered = false}
	>
		<span class="flex justify-between items-center">
			<span class="flex items-center gap-1">
				<button
					onclick={(e) => { e.stopPropagation(); toggleFolderExpand?.(folder!.id!); }}
					class="p-0.5 hover:bg-gray-200 dark:hover:bg-gray-600 rounded"
					aria-label={isExpanded ? 'Collapse folder' : 'Expand folder'}
				>
					{isExpanded ? '▼' : '▶'}
				</button>
				<span>📁 {folder!.name}</span>
			</span>
			<span class="flex items-center gap-2">
				<span class="{isHovered ? 'visible' : 'invisible'} inline-flex gap-1">
				<Button
					variant="primary" size="sm"
					onclick={(e) => { e.stopPropagation(); onEditFolder?.(folder!); }}
					ariaLabel="Edit folder"
				>✏️</Button>
				<Button
					variant="danger" size="sm"
					onclick={(e) => { e.stopPropagation(); onDeleteFolder?.(folder!.id!); }}
					ariaLabel="Delete folder"
				>🗑️</Button>
			</span>
				<span class="text-xs text-gray-500">
					{folderCount!.unread}/{folderCount!.total}
				</span>
			</span>
		</span>
	</div>

	{#if isExpanded}
		<ul>
			{#each childFolders as child}
				<SidebarItem
					type="folder"
					folder={child}
					folderCount={folderCounts?.[child.id!] ?? { total: 0, unread: 0 }}
					{allFolders}
					{allFeeds}
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
			{#each folderFeeds as f}
				<SidebarItem
					type="feed"
					feed={f}
					feedCount={feedCounts?.[f.id!] ?? { total: 0, unread: 0 }}
					selected={selectedFeedId === f.id}
					depth={depth + 1}
					{dragOverItem}
					onselect={() => onSelectFeed?.(f.id!)}
					onedit={() => onEditFeed?.(f)}
					ondelete={() => onDeleteFeed?.(f.id!)}
					{handleDragStart}
					{handleDragOver}
					{handleDragLeave}
					{handleDrop}
					{handleDragEnd}
				/>
			{/each}
		</ul>
	{/if}
{/snippet}

<!-- ─── Render ────────────────────────────────────────────────────────────── -->

{#if type === 'view'}
	<li>
		{@render viewContent()}
	</li>

{:else if type === 'feed'}
	<li
		class:rounded-t={isOverFeed && dragOverItem?.position === 'above'}
		class:rounded-b={isOverFeed && dragOverItem?.position === 'below'}
		class:border-t-2={isOverFeed && dragOverItem?.position === 'above'}
		class:border-b-2={isOverFeed && dragOverItem?.position === 'below'}
		class:border-blue-500={isOverFeed && dragOverItem?.position !== 'on'}
		class:bg-blue-50={isOverFeed && dragOverItem?.position === 'on'}
		draggable="true"
		ondragstart={(e) => handleDragStart?.(e, 'feed', feed!.id!)}
		ondragover={(e) => handleDragOver?.(e, 'feed', feed!.id!)}
		ondragleave={handleDragLeave}
		ondrop={(e) => handleDrop?.(e, 'feed', feed!.id!)}
		ondragend={handleDragEnd}
	>
		{@render feedContent()}
	</li>

{:else if type === 'folder'}
	<li
		class:rounded-t={isOverFolder && dragOverItem?.position === 'above'}
		class:rounded-b={isOverFolder && dragOverItem?.position === 'below'}
		class:border-t-2={isOverFolder && dragOverItem?.position === 'above'}
		class:border-b-2={isOverFolder && dragOverItem?.position === 'below'}
		class:border-blue-500={isOverFolder && dragOverItem?.position !== 'on'}
		class:bg-blue-50={isOverFolder && dragOverItem?.position === 'on'}
		draggable="true"
		ondragstart={(e) => handleDragStart?.(e, 'folder', folder!.id!)}
		ondragover={(e) => handleDragOver?.(e, 'folder', folder!.id!)}
		ondragleave={handleDragLeave}
		ondrop={(e) => handleDrop?.(e, 'folder', folder!.id!)}
		ondragend={handleDragEnd}
	>
		{@render folderContent()}
	</li>
{/if}
