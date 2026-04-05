import { writable } from 'svelte/store';
import { browser } from '$app/environment';

export type DarkModeOption = 'system' | 'dark' | 'light';

export const darkMode = writable<DarkModeOption>('system');

let mediaQuery: MediaQueryList | null = null;
let mediaListener: ((e: MediaQueryListEvent) => void) | null = null;

function applyDarkClass(isDark: boolean) {
	if (browser) {
		document.documentElement.classList.toggle('dark', isDark);
	}
}

function applyMode(mode: DarkModeOption) {
	if (!browser) return;

	// Remove existing media listener
	if (mediaQuery && mediaListener) {
		mediaQuery.removeEventListener('change', mediaListener);
		mediaQuery = null;
		mediaListener = null;
	}

	if (mode === 'dark') {
		applyDarkClass(true);
	} else if (mode === 'light') {
		applyDarkClass(false);
	} else {
		// system
		mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
		applyDarkClass(mediaQuery.matches);
		mediaListener = (e: MediaQueryListEvent) => applyDarkClass(e.matches);
		mediaQuery.addEventListener('change', mediaListener);
	}
}

export async function initDarkMode() {
	if (!browser) return;
	const result = await chrome.storage.local.get('darkMode') as { darkMode?: DarkModeOption };
	const mode: DarkModeOption = result.darkMode ?? 'system';
	darkMode.set(mode);
	applyMode(mode);
}

export async function setDarkMode(mode: DarkModeOption) {
	darkMode.set(mode);
	applyMode(mode);
	if (browser) {
		await chrome.storage.local.set({ darkMode: mode });
	}
}
