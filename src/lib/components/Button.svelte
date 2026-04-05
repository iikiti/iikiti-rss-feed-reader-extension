<script lang="ts">
import type { Snippet } from 'svelte';

let {
	variant = 'default',
	size = 'md',
	onclick,
	disabled = false,
	ariaLabel,
	class: extraClass = '',
	children
}: {
	variant?: 'default' | 'ghost' | 'danger' | 'primary';
	size?: 'sm' | 'md' | 'lg';
	onclick?: (e: MouseEvent) => void;
	disabled?: boolean;
	ariaLabel?: string;
	class?: string;
	children?: Snippet;
} = $props();

const baseClasses = 'inline-flex items-center justify-center rounded cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors';

const variantClasses: Record<string, string> = {
	default: 'bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200',
	ghost: 'hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-400',
	danger: 'hover:bg-red-100 dark:hover:bg-red-900 text-red-500',
	primary: 'hover:bg-blue-100 dark:hover:bg-blue-900 text-blue-500'
};

const sizeClasses: Record<string, string> = {
	sm: 'p-0.5 text-sm',
	md: 'p-1 text-base',
	lg: 'px-3 py-2 text-base'
};
</script>

<button
	class="{baseClasses} {variantClasses[variant]} {sizeClasses[size]} {extraClass}"
	{onclick}
	{disabled}
	aria-label={ariaLabel}
>
	{#if children}
		{@render children()}
	{/if}
</button>
