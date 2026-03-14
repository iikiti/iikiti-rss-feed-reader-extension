import { db } from '../lib/db';
import { fetchAndParseFeed } from '../lib/feed';

// Default refresh interval in minutes
const DEFAULT_REFRESH_INTERVAL = 15;

// Create the refresh alarm - fires immediately then periodically
async function createRefreshAlarm() {
  // Get refresh interval from storage, default to 15 minutes
  const result = await chrome.storage.local.get('refreshInterval') as { refreshInterval?: number };
  const interval: number = result.refreshInterval || DEFAULT_REFRESH_INTERVAL;
  
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

  const feeds = await db.feeds.toArray();
  for (const feed of feeds) {
    try {
      const response = await fetch(feed.url);
      const text = await response.text();
      const parsedFeed = parseFeed(text);
      
      const existingArticles = await db.articles.where('feedId').equals(feed.id!).toArray();
      const existingGuids = new Set(existingArticles.map(a => a.guid));
      const newArticles = parsedFeed.items.filter(item => !existingGuids.has(item.guid)).map(item => ({
        feedId: feed.id!,
        guid: item.guid,
        title: item.title,
        link: item.link,
        content: item.content,
        snippet: item.snippet,
        pubDate: item.pubDate,
        read: false,
        starred: false,
        author: item.author,
        image: item.image
      }));
      
      console.log(`Refreshing feed: ${feed.title} (${feed.url}). New articles: ${newArticles.length}`);
      if (newArticles.length > 0) await db.articles.bulkAdd(newArticles);
      await db.feeds.update(feed.id!, { lastFetched: Date.now(), error: undefined });
    } catch (err) {
      console.error(`Failed to fetch ${feed.url}`, err);
      await db.feeds.update(feed.id!, { error: String(err) });
    }
  }

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
  // Parse the feed
  const parsedFeed = await fetchAndParseFeed(feedUrl);
  
  // Add the feed to the database
  const feedId = await db.feeds.add({ 
    url: feedUrl, 
    title: feedTitle, 
    folderId: feedFolderId || undefined 
  });
  
  // Add the articles from the feed
  const articles = parsedFeed.items.slice(0, 10).map(item => ({
    feedId: feedId as number,
    guid: item.guid,
    title: item.title,
    link: item.link,
    content: item.content,
    snippet: item.snippet,
    pubDate: item.pubDate,
    read: false,
    starred: false,
    author: item.author,
    image: item.image
  }));
  
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

interface ParsedItem {
  title: string;
  link: string;
  content: string;
  snippet: string;
  guid: string;
  pubDate: number;
  author?: string;
  image?: string;
}

interface ParsedFeed {
  title: string;
  items: ParsedItem[];
}

// Simple regex-based XML parser for RSS and Atom feeds
function parseFeed(xmlText: string): ParsedFeed {
  const isAtom = xmlText.includes('<feed') || xmlText.includes('xmlns="http://www.w3.org/2005/Atom"');
  
  if (isAtom) {
    return parseAtomFeed(xmlText);
  } else {
    return parseRssFeed(xmlText);
  }
}

function parseRssFeed(xmlText: string): ParsedFeed {
  const titleMatch = xmlText.match(/<channel>[\s\S]*?<title>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : 'Untitled Feed';
  
  const items: ParsedItem[] = [];
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let match;
  
  while ((match = itemRegex.exec(xmlText)) !== null) {
    const itemXml = match[1];
    
    const itemTitle = extractTag(itemXml, 'title') || 'No Title';
    const itemLink = extractTag(itemXml, 'link') || '';
    const description = extractTag(itemXml, 'description') || '';
    const contentEncoded = extractTag(itemXml, 'content:encoded') || '';
    const content = contentEncoded || description;
    const snippet = (description || content).substring(0, 200).replace(/<[^>]+>/g, '') + '...';
    const guid = extractTag(itemXml, 'guid') || itemLink;
    const pubDateStr = extractTag(itemXml, 'pubDate') || '';
    const pubDate = pubDateStr ? new Date(pubDateStr).getTime() : Date.now();
    const author = extractTag(itemXml, 'author') || extractTag(itemXml, 'dc:creator');
    
    // Try to get image from various RSS elements
    let image: string | undefined;
    const mediaContent = extractAttribute(itemXml, 'media:content', 'url') || 
                          extractAttribute(itemXml, 'media:thumbnail', 'url');
    const enclosureMatch = itemXml.match(/<enclosure[^>]*>/i);
    if (enclosureMatch) {
      const enclosureStr = enclosureMatch[0];
      const typeMatch = enclosureStr.match(/type=["'](image\/[^"']+)["']/);
      const urlMatch = enclosureStr.match(/url=["']([^"']+)["']/);
      if (typeMatch && urlMatch && typeMatch[1].startsWith('image/')) {
        image = urlMatch[1];
      }
    }
    if (mediaContent) {
      image = mediaContent;
    }
    
    items.push({
      title: itemTitle,
      link: itemLink,
      content,
      snippet,
      guid,
      pubDate,
      author,
      image
    });
  }
  
  return { title, items };
}

function parseAtomFeed(xmlText: string): ParsedFeed {
  const titleMatch = xmlText.match(/<feed[^>]*>[\s\S]*?<title>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : 'Untitled Feed';
  
  const items: ParsedItem[] = [];
  const entryRegex = /<entry[^>]*>([\s\S]*?)<\/entry>/gi;
  let match;
  
  while ((match = entryRegex.exec(xmlText)) !== null) {
    const entryXml = match[1];
    
    const itemTitle = extractTag(entryXml, 'title') || 'No Title';
    const linkMatch = entryXml.match(/<link[^>]*href=["']([^"']+)["'][^>]*>/i);
    const itemLink = linkMatch ? linkMatch[1] : '';
    const content = extractTag(entryXml, 'content') || extractTag(entryXml, 'summary') || '';
    const snippet = content.substring(0, 200).replace(/<[^>]+>/g, '') + '...';
    const guid = extractTag(entryXml, 'id') || itemLink;
    const pubDateStr = extractTag(entryXml, 'published') || extractTag(entryXml, 'updated') || '';
    const pubDate = pubDateStr ? new Date(pubDateStr).getTime() : Date.now();
    const author = extractTag(entryXml, 'author > name');
    
    // Try to get image from Atom link elements
    let image: string | undefined;
    const linkElements = entryXml.match(/<link[^>]*>/gi) || [];
    for (const linkEl of linkElements) {
      const rel = linkEl.match(/rel=["']([^"']+)["']/)?.[1];
      const type = linkEl.match(/type=["']([^"']+)["']/)?.[1];
      const href = linkEl.match(/href=["']([^"']+)["']/)?.[1];
      
      if ((rel === 'enclosure' || rel === 'preview') && type?.startsWith('image/') && href) {
        image = href;
        break;
      }
    }
    
    items.push({
      title: itemTitle,
      link: itemLink,
      content,
      snippet,
      guid,
      pubDate,
      author,
      image
    });
  }
  
  return { title, items };
}

function extractTag(xml: string, tag: string): string | undefined {
  // Handle namespaced tags like dc:creator
  const namespacedTag = tag.replace(':', ':');
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const match = xml.match(regex);
  if (match) return match[1].trim();
  
  // Try with alternate namespace prefix
  const parts = tag.split(':');
  if (parts.length === 2) {
    const alternateTag = parts[0] + ':' + parts[1];
    const alternateRegex = new RegExp(`<${alternateTag}[^>]*>([\\s\\S]*?)</${alternateTag}>`, 'i');
    const alternateMatch = xml.match(alternateRegex);
    if (alternateMatch) return alternateMatch[1].trim();
  }
  
  return undefined;
}

function extractAttribute(xml: string, tag: string, attr: string): string | undefined {
  const regex = new RegExp(`<${tag}[^>]*${attr}=["']([^"']+)["']`, 'i');
  const match = xml.match(regex);
  return match ? match[1] : undefined;
}
