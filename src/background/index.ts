import { db, getCurrentUserId, type Feed, type Article } from '../lib/db';
import { fetchAndParseFeed, parseFeed, type ParsedFeed, type ParsedItem } from '../lib/feed';
import { generateSearchIndex } from '../lib/text-segmenter';

// Default refresh interval in minutes
const DEFAULT_REFRESH_INTERVAL = 15;

// Create the refresh alarm - fires immediately then periodically
async function createRefreshAlarm() {
	// Get refresh interval from storage, default to 15 minutes
	const result = await chrome.storage.local.get('refreshInterval') as { refreshInterval?: number };
	const interval: number = result.refreshInterval || DEFAULT_REFRESH_INTERVAL;

	console.info(`Feed refresh interval is ${interval} minutes.`);
	chrome.alarms.create("refresh" as string, { periodInMinutes: interval } as chrome.alarms.AlarmCreateInfo);
}

// Create the alarm and refresh on load
createRefreshAlarm();

// Listen for storage changes to update the alarm
chrome.storage.onChanged.addListener((changes, areaName) => {
	if (areaName === 'local' && changes.refreshInterval) {
		// Recreate the alarm with the new interval
		chrome.alarms.clear("refresh").then(() => {
		  createRefreshAlarm();
		});
	}
});

// Refresh feeds when the extension loads
refreshAllFeeds();

// Listen for messages from the page to trigger refresh or add feed
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
	if (message.type === 'refresh-feeds') {
		refreshAllFeeds();
		sendResponse({ success: true });
	} else if (message.type === 'add-feed') {
		// Add a new feed and refresh it
		handleAddFeed(message.feedUrl, message.feedTitle, message.feedFolderId)
		  .then(() => sendResponse({ success: true }))
		  .catch(err => sendResponse({ success: false, error: String(err) }));
		return true; // async response
	} else if (message.type === 'get-current-user') {
		// Return current user ID
		getCurrentUserId().then(userId => sendResponse({ userId }));
		return true;
	}
	return true;
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
	if (alarm.name === "refresh") {
		console.log("Refreshing feeds...");
		await refreshAllFeeds();
	}
});

async function refreshAllFeeds() {
	// Send "refresh-started" message to all tabs
	chrome.tabs.query({}).then(tabs => {
		for (const tab of tabs) {
		  if (tab.id) {
		    chrome.tabs.sendMessage(tab.id, { type: 'refresh-started' }).catch(() => {
		      // Tab may not have a listener, ignore error
		    });
		  }
		}
	});

	console.info('Refreshing all feeds.');

	// Get current user ID
	const userId = await getCurrentUserId();
	
	// Only refresh feeds for the current user
	const feeds = await db.feeds.where('userId').equals(userId).toArray();
	for (const feed of feeds) {
		try {
		  const response = await fetch(feed.url);
		  const text = await response.text();
		  const parsedFeed = parseFeed(text);
		  
		  const existingArticles = await db.articles.where('feedId').equals(feed.id!).toArray();
		  const existingGuids = new Set(existingArticles.map(a => a.guid));
		  const newArticles = parsedFeed.items.filter(item => !existingGuids.has(item.guid)).map(item => {
		    const searchIndex = generateSearchIndex(item.title, item.snippet, item.siteContent);
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
		  await db.feeds.update(feed.id!, { lastFetched: Date.now(), error: undefined });
		} catch (err) {
		  console.error(`Failed to fetch ${feed.url}`, err);
		  await db.feeds.update(feed.id!, { error: String(err) });
		}
	}

	console.info('Feed refresh complete.');
	// Send "refresh-complete" message to all tabs
	chrome.tabs.query({}).then(tabs => {
		for (const tab of tabs) {
		  if (tab.id) {
		    chrome.tabs.sendMessage(tab.id, { type: 'refresh-complete' }).catch(() => {
		      // Tab may not have a listener, ignore error
		    });
		  }
		}
	});
}

async function handleAddFeed(feedUrl: string, feedTitle: string, feedFolderId: number | null | undefined) {
	console.info(`Adding new feed: ${feedTitle} (${feedUrl})`);
	// Get current user ID
	const userId = await getCurrentUserId();
	
	// Parse the feed
	const parsedFeed = await fetchAndParseFeed(feedUrl);
	
	// Add the feed to the database
	const feedId = await db.feeds.add({ 
		userId,
		url: feedUrl, 
		title: feedTitle, 
		folderId: feedFolderId || undefined 
	});
	
	// Add the articles from the feed
	const articles = parsedFeed.items.slice(0, 10).map(item => {
		const searchIndex = generateSearchIndex(item.title, item.snippet, item.siteContent);
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
	
	// Notify tabs to refresh
	chrome.tabs.query({}).then(tabs => {
		for (const tab of tabs) {
		  if (tab.id) {
		    chrome.tabs.sendMessage(tab.id, { type: 'refresh-complete' }).catch(() => {
		      // Tab may not have a listener, ignore error
		    });
		  }
		}
	});
}
