<script lang="ts">
	import type { Article, Feed } from '$lib/db';
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
		feeds: Feed[];
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
</script>

<div class="flex-1 overflow-y-auto p-4">
	{#if articles.length === 0}
		<div class="bg-white dark:bg-gray-800 p-4 rounded shadow">
			<h3 class="font-bold text-lg mb-1">No articles</h3>
			<p class="text-gray-600 dark:text-gray-400 text-sm">Add some feeds to see articles.</p>
		</div>
	{:else}
		{#each articles as article, index}
			<div
				class="bg-white dark:bg-gray-800 p-4 rounded shadow mb-4 hover:shadow-md transition-all duration-300 overflow-hidden cursor-pointer"
				class:expanded={isExpanded(index)}
				onclick={() => onToggleArticle(index)}
				role="button"
				tabindex="0"
				onkeypress={(e) => e.key === 'Enter' && onToggleArticle(index)}
			>
				<div class="flex items-start gap-4">
					{#if article.image}
						<img src={article.image} alt="" class="w-32 h-32 object-cover rounded flex-shrink-0" />
					{/if}
					<div class="flex-1">
						<h3 class="font-bold text-lg mb-1">
							<a
								href={article.link}
								target="_blank"
								rel="noopener noreferrer"
								class="hover:underline text-blue-600 dark:text-blue-400"
								onclick={(e) => e.stopPropagation()}
							>{article.title}</a>
						</h3>
						<p class="text-gray-600 dark:text-gray-400 text-sm mb-2">
							{feeds.find(f => f.id === article.feedId)?.title || 'Unknown'} - {new Date(article.pubDate).toLocaleDateString()}
						</p>
						<div
							class="overflow-hidden transition-all duration-300 article-content"
							style="max-height: {isExpanded(index) ? '2000px' : '4.5em'};"
						>
							<div class="text-gray-700 dark:text-gray-300">{@html getDisplayContent(article, index)}</div>
						</div>
					</div>
					<div class="flex items-center gap-2 ml-4" role="presentation">
						<button
							onclick={(e) => { e.stopPropagation(); onToggleStarred(article.id!, article.starred); }}
							class="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
						>{article.starred ? '⭐' : '☆'}</button>
						{#if !article.read}
							<button
								onclick={(e) => { e.stopPropagation(); onMarkAsRead(article.id!); }}
								class="px-2 py-1 text-xs bg-blue-600 text-white rounded"
							>Mark read</button>
						{/if}
					</div>
				</div>
				<div class="text-center mt-2">
					<span class="text-xs text-gray-400">{isExpanded(index) ? '▲ Click to collapse' : '▼ Click to read more'}</span>
				</div>
			</div>
		{/each}
		<!-- Load more trigger for infinite scroll -->
		<div bind:this={loadTrigger} class="h-4">
			{#if isLoadingMore}
				<p class="text-center text-gray-500 py-2">Loading more...</p>
			{:else if !hasMoreArticles && articles.length > 0}
				<p class="text-center text-gray-400 py-2">No more articles</p>
			{/if}
		</div>
	{/if}
</div>
