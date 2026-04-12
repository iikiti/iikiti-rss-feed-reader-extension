<script lang="ts">
import type { ArticleCounts } from '$lib/db';
import type { Feed as FeedModel } from '$lib/models';

let {
	feed,
	feedCounts = {},
	selected = false,
	depth = 0,
	dragOverItem,
	onSelect,
	onEdit,
	onDelete,
	handleDragStart,
	handleDragOver,
	handleDragLeave,
	handleDrop,
	handleDragEnd
}: {
	feed: FeedModel;
	feedCounts?: Record<number, ArticleCounts>;
	selected?: boolean;
	depth?: number;
	dragOverItem: { type: 'folder' | 'feed'; id: number; position: 'above' | 'below' | 'on' } | null;
	onSelect?: () => void;
	onEdit?: () => void;
	onDelete?: () => void;
	handleDragStart?: (e: DragEvent, type: 'folder' | 'feed', id: number) => void;
	handleDragOver?: (e: DragEvent, type: 'folder' | 'feed', id: number) => void;
	handleDragLeave?: (e: DragEvent) => void;
	handleDrop?: (e: DragEvent, targetType: 'folder' | 'feed', targetId: number) => void;
	handleDragEnd?: () => void;
} = $props();

const count = $derived(feedCounts[feed.id!] || { total: 0, unread: 0 });

function isDragOver(): boolean {
	if (!dragOverItem) return false;
	return dragOverItem.type === 'feed' && dragOverItem.id === feed.id;
}

function getDragOverClass(): string {
	if (!isDragOver()) return '';
	const pos = dragOverItem!.position;
	if (pos === 'above') return 'border-t-2 border-blue-500';
	if (pos === 'below') return 'border-b-2 border-blue-500';
	return 'ring-2 ring-blue-500';
}
</script>

<div 
	class="flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 {selected ? 'bg-blue-100 dark:bg-blue-900' : ''} {getDragOverClass()}"
	draggable="true"
	ondragstart={(e) => handleDragStart?.(e, 'feed', feed.id!)}
	ondragover={(e) => handleDragOver?.(e, 'feed', feed.id!)}
	ondragleave={handleDragLeave}
	ondrop={(e) => handleDrop?.(e, 'feed', feed.id!)}
	ondragend={handleDragEnd}
	role="button"
	tabindex="0"
	onclick={onSelect}
	onkeypress={(e) => e.key === 'Enter' && onSelect?.()}
>
	<span class="text-gray-400 mr-1">📄</span>
	<span class="flex-1 truncate">{feed.title}</span>
	<span class="text-xs text-gray-500">({count.unread}/{count.total})</span>
	<button onclick={(e) => { e.stopPropagation(); onEdit?.(); }} class="text-gray-400 hover:text-gray-600 p-1" title="Edit">✎</button>
	<button onclick={(e) => { e.stopPropagation(); onDelete?.(); }} class="text-gray-400 hover:text-red-600 p-1" title="Delete">✕</button>
</div>