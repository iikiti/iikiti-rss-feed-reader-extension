<script lang="ts">
	import { createEventDispatcher } from 'svelte';

	export let title: string = '';
	export let open: boolean = false;

	const dispatch = createEventDispatcher<{ close: void }>();

	function close() {
		dispatch('close');
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') close();
	}
</script>

{#if open}
	<div
		class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
		on:click|self={close}
		on:keydown={handleKeydown}
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
				<button on:click={close} class="ml-auto text-gray-500 hover:text-gray-700 dark:hover:text-gray-300" aria-label="Close">✕</button>
			</div>
			<slot />
		</div>
	</div>
{/if}
