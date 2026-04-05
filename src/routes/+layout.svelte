<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { initDarkMode } from '$lib/stores/darkMode';
	import { getCurrentUserId } from '$lib/db';
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();

	onMount(async () => {
		const userId = await getCurrentUserId();
		await initDarkMode(userId);
	});
</script>

{@render children()}
