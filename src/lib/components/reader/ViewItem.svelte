<script lang="ts">
import type { ArticleCounts } from '$lib/db';
import type { View as ViewModel } from '$lib/models';

let {
	view,
	viewCount = { total: 0, unread: 0 },
	selected = false,
	onSelect,
	onEdit,
	onDelete
}: {
	view: ViewModel;
	viewCount?: ArticleCounts;
	selected?: boolean;
	onSelect?: () => void;
	onEdit?: () => void;
	onDelete?: () => void;
} = $props();
</script>

<div
	class="flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 {selected ? 'bg-green-100 dark:bg-green-900' : ''}"
	role="button"
	tabindex="0"
	onclick={onSelect}
	onkeypress={(e) => e.key === 'Enter' && onSelect?.()}
>
	<span class="text-gray-400">🔍</span>
	<span class="flex-1 truncate">{view.name}</span>
	<span class="text-xs text-gray-500">({viewCount.unread}/{viewCount.total})</span>
	<button onclick={(e) => { e.stopPropagation(); onEdit?.(); }} class="text-gray-400 hover:text-gray-600 p-1" title="Edit">✎</button>
	<button onclick={(e) => { e.stopPropagation(); onDelete?.(); }} class="text-gray-400 hover:text-red-600 p-1" title="Delete">✕</button>
</div>