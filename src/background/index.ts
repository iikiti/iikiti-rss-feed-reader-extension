import { db } from '../lib/db';
import { fetchAndParseFeed } from '../lib/feed'; // Note: DOMParser not available in SW

chrome.alarms.create("refresh", { periodInMinutes: 15 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "refresh") {
    console.log("Refreshing feeds...");
    await refreshAllFeeds();
  }
});

async function refreshAllFeeds() {
    const feeds = await db.feeds.toArray();
    for (const feed of feeds) {
        try {
            // In SW, fetchAndParseFeed uses DOMParser which fails.
            // We need a custom parser or Offscreen API.
            // For now, let's just fetch text and log length.
            const response = await fetch(feed.url);
            const text = await response.text();
            console.log(`Fetched ${feed.url}: ${text.length} chars`);
            // TODO: Parse with Offscreen or regex
        } catch (err) {
            console.error(`Failed to fetch ${feed.url}`, err);
        }
    }
}
