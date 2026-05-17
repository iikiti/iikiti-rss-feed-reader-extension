<script lang="ts">
import { resolve } from '$app/paths';
</script>

<h1 class="text-3xl font-bold underline">iikiti</h1>
<ul>
	<li><a href="{resolve('/popup', {})}">Popup</a></li>
	<li><a href="{resolve('/reader', {})}">Reader</a></li>
	<li><a href="{resolve('/settings', {})}">Settings</a></li>
</ul>
