import { writable } from 'svelte/store';
import { browser } from '$app/environment';
import type { DarkModeOption } from './darkMode';

export interface UserSettings {
	darkMode: DarkModeOption;
	refreshInterval: number;
}

const DEFAULT_SETTINGS: UserSettings = {
	darkMode: 'system',
	refreshInterval: 15,
};

/**
 * Global settings object keyed by userId (as string).
 * This is the in-memory representation of all user settings,
 * persisted to chrome.storage.local under the 'userSettings' key.
 * Designed for future per-user sync.
 */
export const allUserSettings = writable<Record<string, UserSettings>>({});

/**
 * Load all user settings from storage into the global store.
 * Also migrates legacy flat keys (darkMode, refreshInterval) for the given user
 * if no per-user settings exist yet.
 */
export async function initSettings(userId: number): Promise<UserSettings> {
	if (!browser) return { ...DEFAULT_SETTINGS };

	const result = await chrome.storage.local.get([
		'userSettings',
		'darkMode',
		'refreshInterval',
	]) as {
		userSettings?: Record<string, UserSettings>;
		darkMode?: DarkModeOption;
		refreshInterval?: number;
	};

	const all: Record<string, UserSettings> = result.userSettings ?? {};

	// Migrate legacy flat keys to per-user settings (one-time migration)
	if (!all[String(userId)]) {
		all[String(userId)] = {
			darkMode: result.darkMode ?? DEFAULT_SETTINGS.darkMode,
			refreshInterval: result.refreshInterval ?? DEFAULT_SETTINGS.refreshInterval,
		};
		await chrome.storage.local.set({ userSettings: all });
		// Remove legacy keys after migrating
		await chrome.storage.local.remove(['darkMode', 'refreshInterval']);
	}

	allUserSettings.set(all);
	return all[String(userId)];
}

/**
 * Get the settings for a specific user from the store snapshot.
 * Falls back to defaults if no settings exist for that user.
 */
export function getUserSettingsSnapshot(
	all: Record<string, UserSettings>,
	userId: number,
): UserSettings {
	return all[String(userId)] ?? { ...DEFAULT_SETTINGS };
}

/**
 * Update a single setting for a user, persisting to chrome.storage.local.
 */
export async function setUserSetting<K extends keyof UserSettings>(
	userId: number,
	key: K,
	value: UserSettings[K],
): Promise<void> {
	if (!browser) return;

	const result = await chrome.storage.local.get('userSettings') as {
		userSettings?: Record<string, UserSettings>;
	};
	const all: Record<string, UserSettings> = result.userSettings ?? {};

	all[String(userId)] = {
		...(all[String(userId)] ?? { ...DEFAULT_SETTINGS }),
		[key]: value,
	};

	allUserSettings.set(all);
	await chrome.storage.local.set({ userSettings: all });
}
