import { Feed } from '$lib/models';
import type { BulkError } from 'dexie';
import { db, getCurrentUserId, type Feed as FeedInterface } from '../lib/db';
import { parseFeed } from '../lib/feed';

// Default refresh interval in minutes
const DEFAULT_REFRESH_INTERVAL = 15;

let refreshTimeout: ReturnType<typeof setTimeout> | null = null;

function broadcastToTabs(message: { type: string }) {
	chrome.tabs.query({}).then(tabs => {
		for (const tab of tabs) {
			if (tab.id) {
				chrome.tabs.sendMessage(tab.id, message).catch(() => {
				});
			}
		}
	});
}

async function getRefreshInterval(): Promise<number> {
	const userId = await getCurrentUserId();
	const result = await chrome.storage.local.get('userSettings') as {
		userSettings?: Record<string, { refreshInterval?: number }>;
	};
	return result.userSettings?.[String(userId)]?.refreshInterval ?? DEFAULT_REFRESH_INTERVAL;
}

async function scheduleNextRefresh() {
	if (refreshTimeout) {
		clearTimeout(refreshTimeout);
		refreshTimeout = null;
	}

	const userId = await getCurrentUserId();
	const interval = await getRefreshInterval();
	const now = new Date();
	const nextInterval: Date = (() => {
		const now1 = new Date(now);
		now1.setMinutes(now1.getMinutes() + interval);
		return now1;
	})();
	const feeds = (await db.feeds.where('userId').equals(userId));
	const nextToUpdateFeeds: FeedInterface[] = [];
	const nonFetchedDate = new Date(1970, 1, 1);
	const nextUpdate = (feed: FeedInterface, wasFetched = feed.lastFetched !== undefined): Date => {
		const nextFeedUpdate = wasFetched ? new Date(feed.lastFetched ?? new Date()) : new Date(nonFetchedDate);
		nextFeedUpdate.setMinutes(nextFeedUpdate.getMinutes() + interval);
		return nextFeedUpdate;
	};
	await feeds.each((feed) => {
		const wasFetched = feed.lastFetched !== undefined;
		const nextUpdateDate = nextUpdate(feed);
		if (!wasFetched || nextUpdateDate < now) {
			setTimeout(() => {
				refreshFeed(feed);
			}, 30);
		} else {
			nextToUpdateFeeds.push(feed);
		}
	});

	nextToUpdateFeeds.sort((feedA, feedB) =>
		+(feedA.lastFetched ?? new Date(nonFetchedDate)) - +(feedB.lastFetched ?? new Date(nonFetchedDate))
	).reverse();


	const next = nextToUpdateFeeds.pop();
	if (next) {
		let nextUpdateDate = nextUpdate(next);
		let nextUpdateDiff = +(nextUpdateDate) - +now;
		console.info(`Next feed refresh in ${Math.round(nextUpdateDiff / 1000)}s: ${next.title}`);
		refreshTimeout = setTimeout(() => {
			refreshFeed(next);
			scheduleNextRefresh();
		}, nextUpdateDiff);
	}
}

async function refreshFeed(feed: FeedInterface) {
	console.log(`Refreshing feed: ${feed.title}`);
	broadcastToTabs({ type: 'refresh-started' });

	const interval = await getRefreshInterval();
	const userId = await getCurrentUserId();

	const response = await fetch(feed.url);
	const text = await response.text();
	const parsedFeed = parseFeed(text);

	const articleLanguage = parsedFeed.items[0]?.language || feed.language || 'en-US';
	const existingArticles = await db.articles.where('feedId').equals(feed.id!).toArray();
	const existingGuids = new Set(existingArticles.map(a => a.guid));
	const newArticles = parsedFeed.items
		.filter(item => !existingGuids.has(item.guid))
		.map(item => {
			return {
				userId,
				feedId: feed.id!,
				guid: item.guid,
				title: item.title || "[MISSING TITLE]",
				link: item.link,
				content: item.content || "",
				siteContent: item.siteContent || "",
				snippet: item.snippet || "",
				pubDate: item.pubDate,
				read: false,
				starred: false,
				author: item.author,
				image: item.image,
				language: item.language || articleLanguage
			};
		});

	console.log(`Refreshed feed: ${feed.title} (${feed.url}). New articles: ${newArticles.length}`, newArticles);
	if (newArticles.length > 0) {
		try {
			await db.articles.bulkAdd(newArticles);
		} catch (errs: any) {
			if (errs.name !== "BulkError") {
				throw errs;
			}
			errs.failures.forEach((e: Error) => {
				if (e.name !== "ConstraintError") {
					throw e;
				} else {
					console.warn('Skipped ConstraintError (usually a duplicate).');
				}
			});
		}
	}

	const now = Date.now();
	await db.feeds.update(feed.id!, {
		lastFetched: now,
		error: undefined
	});

	broadcastToTabs({ type: 'refresh-complete' });
}

async function refreshAllFeeds() {
	broadcastToTabs({ type: 'refresh-started' });
	console.info('Refreshing all feeds.');

	const interval = await getRefreshInterval();
	const userId = await getCurrentUserId();

	const feeds = await db.feeds.where('userId').equals(userId).toArray();
	for (const feed of feeds) {
		refreshFeed(feed);
	}

	console.info('Feed refresh complete.');
	broadcastToTabs({ type: 'refresh-complete' });
	scheduleNextRefresh();
}

console.log('Extension worker: Adding message listener.');
// Listen for messages from the page to trigger refresh or add feed
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
	if (message.type === 'refresh-feeds') {
		refreshAllFeeds();
		sendResponse({ success: true });
	} else if (message.type === 'refresh-feed') {
		if ("feed" in message || false === (message.feed instanceof Feed)) {
			throw new Error('Feed refresh: Missing feed id.');
		}
		refreshFeed(message.feed);
	} else if (message.type === 'get-current-user') {
		getCurrentUserId().then(userId => sendResponse({ userId }));
		return true;
	}
	return true;
});

// Initialize - refresh all feeds and schedule next refresh
scheduleNextRefresh();

// Listen for storage changes to reschedule when user settings change
chrome.storage.onChanged.addListener((changes, areaName) => {
	if (areaName === 'local' && changes.userSettings) {
		scheduleNextRefresh();
	}
});