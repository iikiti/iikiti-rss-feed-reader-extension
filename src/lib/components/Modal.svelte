<script lang="ts">
import type { Snippet } from 'svelte';

let {
	title = '',
	open = false,
	onclose,
	children
}: {
	title?: string;
	open?: boolean;
	onclose: () => void;
	children: Snippet;
} = $props();

function handleKeydown(e: KeyboardEvent) {
	if (e.key === 'Escape') onclose();
}
</script>

{#if open}
	<div
		class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
		onclick={(e) => e.target === e.currentTarget && onclose()}
		onkeydown={handleKeydown}
		role="dialog"
		aria-modal="true"
		aria-labelledby="modal-title"
		tabindex="-1"
	>
		<div class="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md p-6">
			<div class="flex items-center justify-between mb-4">
				{#if title}
					<h2 id="modal-title" class="text-xl font-bold text-gray-900 dark:text-gray-100">{title}</h2>
				{/if}
				<button onclick={onclose} class="ml-auto text-gray-500 hover:text-gray-700 dark:hover:text-gray-300" aria-label="Close">✕</button>
			</div>
			{@render children()}
		</div>
	</div>
{/if}
