<script lang="ts">
import type { Article } from '$lib/db';
import type { Feed as FeedModel } from '$lib/models';
import type { SvelteSet } from 'svelte/reactivity';

let {
	articles,
	feeds,
	isLoadingMore,
	hasMoreArticles,
	expandedIndices,
	loadTrigger = $bindable(),
	onToggleArticle,
	onToggleStarred,
	onMarkAsRead,
	getDisplayContent
}: {
	articles: Article[];
	feeds: FeedModel[];
	isLoadingMore: boolean;
	hasMoreArticles: boolean;
	expandedIndices: SvelteSet<number>;
	loadTrigger: HTMLDivElement | null;
	onToggleArticle: (index: number) => void;
	onToggleStarred: (id: number, current: boolean) => void;
	onMarkAsRead: (id: number) => void;
	getDisplayContent: (article: Article, index: number) => string;
} = $props();

function isExpanded(index: number): boolean {
	return expandedIndices.has(index);
}

function getFeedTitle(feedId: number): string {
	const feed = feeds.find(f => f.id === feedId);
	return feed?.title || 'Unknown Feed';
}

function formatDate(timestamp: number): string {
	return new Date(timestamp).toLocaleDateString();
}

const filteredArticles = $derived(articles);
</script>

<div class="flex-1 overflow-y-auto p-4">
	{#each filteredArticles as article, index (article.id)}
		<div 
			class="mb-4 p-4 bg-white dark:bg-gray-800 rounded shadow {isExpanded(index) ? 'ring-2 ring-blue-500' : ''}"
			onclick={() => onToggleArticle(index)}
			role="button"
			tabindex="0"
			onkeypress={(e) => e.key === 'Enter' && onToggleArticle(index)}
		>
			<div class="flex items-start gap-2">
				<button 
					onclick={(e) => { e.stopPropagation(); onToggleStarred(article.id!, article.starred); }}
					class="mt-1 text-gray-400 hover:text-yellow-500"
					title={article.starred ? 'Unstar' : 'Star'}
				>
					{article.starred ? '★' : '☆'}
				</button>
				<div class="flex-1 min-w-0">
					<div class="flex items-center gap-2 mb-1">
						<span class="text-sm font-medium text-blue-600 dark:text-blue-400 truncate">[{getFeedTitle(article.feedId)}]</span>
						<span class="text-xs text-gray-500">{formatDate(article.pubDate)}</span>
						{#if article.read}
							<span class="text-xs bg-gray-200 dark:bg-gray-700 px-1 rounded">Read</span>
						{/if}
					</div>
					<h3 class="text-lg font-medium mb-2">{article.title}</h3>
					<p class="text-gray-600 dark:text-gray-400 text-sm">{@html getDisplayContent(article, index)}</p>
				</div>
				<button 
					onclick={(e) => { e.stopPropagation(); onMarkAsRead(article.id!); }}
					class="text-gray-400 hover:text-green-600"
					title="Mark as read"
				>
					✓
				</button>
			</div>
			{#if isExpanded(index)}
				<div class="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
					<a href={article.link} target="_blank" rel="noopener noreferrer" class="text-blue-600 hover:underline">
						Open original article
					</a>
					{#if article.author}
						<p class="text-sm text-gray-500 mt-2">By {article.author}</p>
					{/if}
					{#if article.image}
						<img src={article.image} alt="" class="mt-2 max-w-full h-auto" />
					{/if}
				</div>
			{/if}
		</div>
	{/each}
	
	{#if isLoadingMore}
		<div class="text-center py-4 text-gray-500">Loading...</div>
	{/if}
	
	{#if hasMoreArticles}
		<div bind:this={loadTrigger} class="h-4"></div>
	{:else}
		<div class="text-center py-4 text-gray-500">No more articles</div>
	{/if}
</div>