import { db, getCurrentUserId, type Feed, type Article } from '../lib/db';
import { fetchAndParseFeed, parseFeed, type ParsedFeed, type ParsedItem } from '../lib/feed';
import { generateSearchIndex } from '../lib/text-segmenter';

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
	const nextInterval:Date = (() => {
		const now1 = new Date(now);
		now1.setMinutes(now1.getMinutes() + interval);
		return now1;
	})();
	const feeds = (await db.feeds.where('userId').equals(userId));
	const nextToUpdateFeeds:Feed[] = [];
	const nonFetchedDate = new Date(1970, 1, 1);
	const nextUpdate = (feed:Feed, wasFetched = feed.lastFetched !== undefined):Date => {
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

async function refreshFeed(feed: Feed) {
	console.log(`Refreshing feed: ${feed.title}`);
	broadcastToTabs({ type: 'refresh-started' });

	const interval = await getRefreshInterval();
	const userId = await getCurrentUserId();

	try {
		const response = await fetch(feed.url);
		const text = await response.text();
		const parsedFeed = parseFeed(text);

		const articleLanguage = parsedFeed.items[0]?.language || feed.language || 'en-US';
		const existingArticles = await db.articles.where('feedId').equals(feed.id!).toArray();
		const existingGuids = new Set(existingArticles.map(a => a.guid));
		const newArticles = parsedFeed.items
			.filter(item => !existingGuids.has(item.guid))
			.map(item => {
				const itemLanguage = item.language || articleLanguage;
				const searchIndex = generateSearchIndex(item.title, item.snippet, item.siteContent, itemLanguage);
				return {
					userId,
					feedId: feed.id!,
					guid: item.guid,
					title: item.title,
					link: item.link,
					content: item.content,
					siteContent: item.siteContent,
					snippet: item.snippet,
					pubDate: item.pubDate,
					read: false,
					starred: false,
					author: item.author,
					image: item.image,
					...searchIndex
				};
			});

		console.log(`Refreshed feed: ${feed.title} (${feed.url}). New articles: ${newArticles.length}`);
		if (newArticles.length > 0) await db.articles.bulkAdd(newArticles);

		const now = Date.now();
		await db.feeds.update(feed.id!, {
			lastFetched: now,
			error: undefined
		});
	} catch (err) {
		console.error(`Failed to fetch ${feed.url}`, err);
		await db.feeds.update(feed.id!, { error: String(err) });
	}

	broadcastToTabs({ type: 'refresh-complete' });
}

async function refreshAllFeeds() {
	broadcastToTabs({ type: 'refresh-started' });
	console.info('Refreshing all feeds.');

	const interval = await getRefreshInterval();
	const userId = await getCurrentUserId();

	const feeds = await db.feeds.where('userId').equals(userId).toArray();
	for (const feed of feeds) {
		try {
			const response = await fetch(feed.url);
			const text = await response.text();
			const parsedFeed = parseFeed(text);

			const articleLanguage = parsedFeed.items[0]?.language || feed.language || 'en-US';
			const existingArticles = await db.articles.where('feedId').equals(feed.id!).toArray();
			const existingGuids = new Set(existingArticles.map(a => a.guid));
			const newArticles = parsedFeed.items
				.filter(item => !existingGuids.has(item.guid))
				.map(item => {
					const itemLanguage = item.language || articleLanguage;
					const searchIndex = generateSearchIndex(item.title, item.snippet, item.siteContent, itemLanguage);
					return {
						userId,
						feedId: feed.id!,
						guid: item.guid,
						title: item.title,
						link: item.link,
						content: item.content,
						siteContent: item.siteContent,
						snippet: item.snippet,
						pubDate: item.pubDate,
						read: false,
						starred: false,
						author: item.author,
						image: item.image,
						...searchIndex
					};
				});

			console.log(`Refreshing feed: ${feed.title} (${feed.url}). New articles: ${newArticles.length}`);
			if (newArticles.length > 0) await db.articles.bulkAdd(newArticles);

			const now = Date.now();
			await db.feeds.update(feed.id!, {
				lastFetched: now,
				error: undefined
			});
		} catch (err) {
			console.error(`Failed to fetch ${feed.url}`, err);
			await db.feeds.update(feed.id!, { error: String(err) });
		}
	}

	console.info('Feed refresh complete.');
	broadcastToTabs({ type: 'refresh-complete' });
	scheduleNextRefresh();
}

async function handleAddFeed(feedUrl: string, feedTitle: string, feedFolderId: number | null | undefined) {
	console.info(`Adding new feed: ${feedTitle} (${feedUrl})`);
	const userId = await getCurrentUserId();
	const interval = await getRefreshInterval();

	const parsedFeed = await fetchAndParseFeed(feedUrl);

	const articleLanguage = parsedFeed.items[0]?.language || 'en-US';
	const now = new Date();
	const feedId = await db.feeds.add({
		userId,
		url: feedUrl,
		title: feedTitle,
		folderId: feedFolderId || undefined,
		lastFetched: now,
		language: articleLanguage,
	});

	const articles = parsedFeed.items.slice(0, 10).map(item => {
		const itemLanguage = item.language || articleLanguage;
		const searchIndex = generateSearchIndex(item.title, item.snippet, item.siteContent, itemLanguage);
		return {
			userId,
			feedId: feedId as number,
			guid: item.guid,
			title: item.title,
			link: item.link,
			content: item.content,
			siteContent: item.siteContent,
			snippet: item.snippet,
			pubDate: item.pubDate,
			read: false,
			starred: false,
			author: item.author,
			image: item.image,
			...searchIndex
		};
	});

	await db.articles.bulkAdd(articles);
	broadcastToTabs({ type: 'refresh-complete' });
	scheduleNextRefresh();
}

// Listen for messages from the page to trigger refresh or add feed
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
	if (message.type === 'refresh-feeds') {
		refreshAllFeeds();
		sendResponse({ success: true });
	} else if (message.type === 'add-feed') {
		handleAddFeed(message.feedUrl, message.feedTitle, message.feedFolderId)
			.then(() => sendResponse({ success: true }))
			.catch(err => sendResponse({ success: false, error: String(err) }));
		return true;
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