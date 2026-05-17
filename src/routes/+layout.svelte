<script lang="ts">
import '../app.css';
import { onMount } from 'svelte';
import { initDarkMode } from '$lib/stores/darkMode';
import { getCurrentUserId } from '$lib/db';
import type { Snippet } from 'svelte';
import favicon from '$lib/static/img/iikiti.webp'; 

let { children }: { children: Snippet } = $props();

onMount(async () => {
	const userId = await getCurrentUserId();
	await initDarkMode(userId);
});
</script>

<svelte:head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<link rel="icon" type="image/webp" href="{favicon}" />
	<title>iikiti RSS Feed Reader</title>
	<style>
	body {
		min-width: 400px;
		min-height: 400px;
		margin: 0;
	}
	html, body {
		min-height: 100%;
	}
	</style>
</svelte:head>

{@render children()}
