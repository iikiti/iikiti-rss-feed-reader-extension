<script>
	import "../app.css";
	import { onMount } from 'svelte';
	import { initDarkMode } from '$lib/stores/darkMode';
	import { getCurrentUserId } from '$lib/db';

	onMount(async () => {
		const userId = await getCurrentUserId();
		await initDarkMode(userId);
	});
</script>

<slot />
