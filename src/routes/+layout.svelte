<script>
	import "../app.css";
	import { onMount } from 'svelte';
	import { initDarkMode } from '$lib/stores/darkMode';

	onMount(() => {
		initDarkMode();
	});
</script>

<slot />
