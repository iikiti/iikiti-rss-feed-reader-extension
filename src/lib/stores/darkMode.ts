import { writable } from 'svelte/store';
import { browser } from '$app/environment';
import { initSettings, setUserSetting } from './settings';

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

/**
 * Initialize dark mode for a specific user.
 * Loads settings via the per-user settings store.
 */
export async function initDarkMode(userId: number) {
	if (!browser) return;
	const settings = await initSettings(userId);
	darkMode.set(settings.darkMode);
	applyMode(settings.darkMode);
}

/**
 * Update dark mode for a specific user.
 * Persists to the per-user settings store.
 */
export async function setDarkMode(userId: number, mode: DarkModeOption) {
	darkMode.set(mode);
	applyMode(mode);
	await setUserSetting(userId, 'darkMode', mode);
}
