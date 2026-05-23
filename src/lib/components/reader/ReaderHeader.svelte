<script lang="ts">
	import type { SortOption } from '$lib/db';
	import languagesData from '../../../../.resources/cldr/languages.json';

	let {
		currentTitle,
		sortBy,
		searchQuery = $bindable(),
		useNgrams = $bindable(true),
		searchLanguage = $bindable(''),
		onRefresh,
		onSortChange
	}: {
		currentTitle: string;
		sortBy: SortOption;
		searchQuery?: string;
		useNgrams?: boolean;
		searchLanguage?: string;
		onRefresh: () => void;
		onSortChange: (e: Event) => void;
	} = $props();

	const languages = [
		{ code: '', label: 'Auto (All)' },
		...Object.entries(languagesData).map(([code, label]) => ({ code, label: label as string }))
	];
</script>

<header class="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 p-4 flex items-center justify-between">
	<h2 class="font-semibold text-lg">
		{currentTitle}
		<button onclick={onRefresh} class="ml-2 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">Refresh</button>
	</h2>
	<div class="flex items-center gap-2">
		<input
			type="search"
			placeholder="Search..."
			bind:value={searchQuery}
			class="border rounded px-3 py-1 bg-gray-50 dark:bg-gray-700"
		/>
		<select
			value={sortBy}
			onchange={onSortChange}
			class="border rounded px-3 py-1 bg-gray-50 dark:bg-gray-700"
		>
			<option value="pubDateDesc">Newest First</option>
			<option value="pubDateAsc">Oldest First</option>
			<option value="titleAsc">Title A-Z</option>
			<option value="titleDesc">Title Z-A</option>
		</select>
		<select
			bind:value={searchLanguage}
			class="border rounded px-3 py-1 bg-gray-50 dark:bg-gray-700"
			title="Search language"
		>
			{#each languages as lang}
				<option value={lang.code}>{lang.label}</option>
			{/each}
		</select>
		<label class="flex items-center gap-1 text-sm text-gray-600 dark:text-gray-400">
			<input type="checkbox" bind:checked={useNgrams} class="accent-blue-600" />
			<span>N-grams</span>
		</label>
	</div>
</header>
