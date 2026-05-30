<script lang="ts">
	import type { SortOption } from '$lib/db';
	import languagesData from '../../../../.resources/cldr/languages.json';
	import { getSearchSuggestions, readSearchHistory, saveSearchQuery } from '$lib/db';

	let {
		currentTitle,
		sortBy,
		searchQuery = $bindable(),
		useNgrams = $bindable(true),
		searchLanguage = $bindable(''),
		userId,
		onRefresh,
		onSortChange
	}: {
		currentTitle: string;
		sortBy: SortOption;
		searchQuery?: string;
		useNgrams?: boolean;
		searchLanguage?: string;
		userId?: number;
		onRefresh: () => void;
		onSortChange: (e: Event) => void;
	} = $props();

	const languages = [
		{ code: '', label: 'Auto (All)' },
		...Object.entries(languagesData).map(([code, label]) => ({ code, label: label as string }))
	];

	let inputQuery = $state(searchQuery ?? '');
	let activeSuggest = $state(-1);
	let suggestions: string[] = $state([]);
	let searchHistory: string[] = $state([]);

	// Reload history whenever the user identity changes.
	$effect(() => {
		void userId;
		if (userId) {
			readSearchHistory(userId).then(h => { searchHistory = h.map(e => e.query); });
		}
	});

	// Propagate query to parent's $bindable and persist to history store.
	function handleSearchQueryChange(query: string) {
		searchQuery = query;
		if (userId && query.trim()) saveSearchQuery(userId, query);
	}

	// Fetch suggestions: history matches first, then frequent words/phrases.
	async function loadSuggestions(query: string) {
		if (!userId || query.trim().length < 1) {
			suggestions = [];
			return;
		}
		const results = await getSearchSuggestions(userId, query, {
			limit: 200,
			searchHistory,
		});
		suggestions = results;
	}

	// Reads searchQuery to establish the reactive dependency: whenever
	// the parent's bindable store changes, we re-seed suggestions here too.
	$effect(() => {
		void searchQuery;
		if (searchQuery) loadSuggestions(searchQuery);
	});

	function handleInput(event: Event) {
		const value = (event.target as HTMLInputElement).value;
		inputQuery = value;
		activeSuggest = -1;
		handleSearchQueryChange(value);
	}

	function acceptSuggestion(word: string) {
		inputQuery = word;
		activeSuggest = -1;
		suggestions = [];
		handleSearchQueryChange(word);
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'ArrowDown' && suggestions.length > 0) {
			event.preventDefault();
			activeSuggest = Math.min(activeSuggest + 1, suggestions.length - 1);
		} else if (event.key === 'ArrowUp' && suggestions.length > 0) {
			event.preventDefault();
			activeSuggest = Math.max(activeSuggest - 1, -1);
		} else if (event.key === 'Enter') {
			if (activeSuggest >= 0 && suggestions.length > 0) {
				event.preventDefault();
				acceptSuggestion(suggestions[activeSuggest]);
			} else {
				suggestions = [];
				activeSuggest = -1;
			}
		} else if (event.key === 'Escape') {
			activeSuggest = -1;
		}
	}
</script>

<header class="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 p-4 flex items-center justify-between relative">
	<h2 class="font-semibold text-lg">
		{currentTitle}
		<button onclick={onRefresh} class="ml-2 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">Refresh</button>
	</h2>
	<div class="flex items-center gap-2">
		<div class="relative">
			<input
				type="search"
				placeholder="Search..."
				value={inputQuery}
				oninput={handleInput}
				onkeydown={handleKeydown}
				onblur={() => {
					suggestions = [];
					activeSuggest = -1;
				}}
				class="border rounded px-3 py-1 bg-gray-50 dark:bg-gray-700"
			/>
			{#if suggestions.length > 0}
				<ul
					class="absolute z-50 top-full left-0 mt-1 w-full max-w-md bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded shadow-lg max-h-60 overflow-y-auto"
					role="listbox"
				>
					{#each suggestions as suggestion, i}
						<li
							role="option"
							aria-selected={i === activeSuggest}
							class="px-3 py-2 cursor-pointer text-sm text-gray-900 dark:text-gray-100 {i === activeSuggest ? 'bg-blue-100 dark:bg-blue-900' : 'hover:bg-gray-100 dark:hover:bg-gray-600'}"
							onmousedown={(e) => {
								e.preventDefault();
								acceptSuggestion(suggestion);
							}}
							onmouseenter={() => (activeSuggest = i)}
						>
							{suggestion}
						</li>
					{/each}
				</ul>
			{/if}
		</div>
		<select
			value={sortBy}
			onchange={onSortChange}
			class="border rounded px-3 py-1 bg-gray-50 dark:bg-gray-700"
		>
			<option value="relevance">Relevance</option>
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
