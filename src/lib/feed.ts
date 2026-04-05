export interface ParsedFeed {
	title: string;
	items: ParsedItem[];
}

/**
 * Decodes XML/HTML encoded characters in a string.
 * Handles entities like &lt;, &gt;, &amp;, &quot;, &apos;, and numeric character references.
 * Uses regex replacements instead of DOM manipulation so it works in service worker context.
 */
export function decodeHtmlEntities(text: string): string {
	if (!text) return text;
	return text
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&#(\d+);/g, (_, dec: string) => String.fromCharCode(parseInt(dec, 10)))
		.replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

/**
 * Decodes XML/HTML encoded characters in content fields of a ParsedItem.
 */
function decodeItemContent(item: ParsedItem): ParsedItem {
	return {
		...item,
		title: decodeHtmlEntities(item.title),
		content: decodeHtmlEntities(item.content),
		siteContent: item.siteContent ? decodeHtmlEntities(item.siteContent) : undefined,
		snippet: decodeHtmlEntities(item.snippet),
	};
}

/**
 * Creates a snippet from content, stripping dangerous tags while preserving basic formatting.
 */
function createSnippet(content: string): string {
	if (!content) return '';
	// Strip dangerous tags, preserve basic formatting like paragraphs, links, bold, etc.
	let cleaned = content
		.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
		.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
		.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
		.substring(0, 200);
	// Remove incomplete tags at the end
	cleaned = cleaned.replace(/<[^>]*$/, '');
	return cleaned + '...';
}

export interface ParsedItem {
	title: string;
	link: string;
	content: string;
	siteContent?: string;
	snippet: string;
	guid: string;
	pubDate: number; // timestamp
	author?: string;
	image?: string;
}

/**
 * Runs an array of async task factories with a maximum concurrency of `limit`.
 * Preserves result order matching the input array.
 */
async function withConcurrencyLimit<T>(
	tasks: Array<() => Promise<T>>,
	limit: number
): Promise<T[]> {
	const results: T[] = new Array(tasks.length);
	let next = 0;

	async function runWorker(): Promise<void> {
		while (next < tasks.length) {
			const i = next++;
			results[i] = await tasks[i]();
		}
	}

	// Spin up at most `limit` workers; each drains the shared task queue
	await Promise.all(
		Array.from({ length: Math.min(limit, tasks.length) }, runWorker)
	);
	return results;
}

/** Maximum simultaneous article-page fetches when parsing a feed. */
const ARTICLE_FETCH_CONCURRENCY = 3;

export async function fetchAndParseFeed(url: string): Promise<ParsedFeed> {
	const response = await fetch(url);
	const text = await response.text();
	const feed = parseFeed(text);

	// Fetch article pages with a concurrency limit to avoid flooding the network
	const tasks = feed.items.map((item) => async () => {
		if (item.link) {
			const extracted = await extractImageAndSiteContent(item.link);
			if (extracted.image || extracted.siteContent) {
				return { ...item, ...extracted };
			}
		}
		return item;
	});

	const itemsWithData = await withConcurrencyLimit(tasks, ARTICLE_FETCH_CONCURRENCY);
	return { ...feed, items: itemsWithData };
}

interface ExtractedData {
	image?: string;
	siteContent?: string;
}

/**
 * Extracts both image and site content from an article page in a single fetch.
 */
async function extractImageAndSiteContent(articleUrl: string): Promise<ExtractedData> {
	try {
		console.info('Fetching article for image and site content: ', articleUrl);
		const response = await fetch(articleUrl);
		const contentType = response.headers.get("content-type") || "";
		
		// Only process HTML pages
		if (!contentType.includes("text/html")) {
		  throw Error(`Extraction for ${articleUrl} failed: content-type is ${contentType}, expected text/html`);
		}
		
		const html = await response.text();
		const parser = new DOMParser();
		const doc = parser.parseFromString(html, "text/html");
		
		const result: ExtractedData = {};
		
		// Extract image - Try Open Graph image
		const ogImage = doc.querySelector('meta[property="og:image"]')?.getAttribute("content");
		if (ogImage) {
		  result.image = ogImage;
		} else {
		  // Try Twitter image
		  const twitterImage = doc.querySelector('meta[name="twitter:image"]')?.getAttribute("content");
		  if (twitterImage) {
		    result.image = twitterImage;
		  } else {
		    // Try other common meta image tags
		    const metaImage = doc.querySelector('meta[name="image"]')?.getAttribute("content");
		    if (metaImage) {
		      result.image = metaImage;
		    }
		  }
		}
		
		// Extract site content - Try to find the main article content using common selectors
		let content: Element | null = null;
		const contentSelectors = [
		  'article',
		  '[role="main"]',
		  'main',
		  '.post-content',
		  '.article-content',
		  '.entry-content',
		  '.content',
		  '.post-body',
		  '.article-body',
		  '#content',
		  '.story-body'
		];
		
		for (const selector of contentSelectors) {
		  content = doc.querySelector(selector);
		  if (content) break;
		}
		
		// If no content found, try to get the body
		if (!content) {
		  content = doc.body;
		}
		
		if (content) {
		  // Clone the content to manipulate it without affecting the original
		  const contentClone = content.cloneNode(true) as Element;
		  
		  // Remove unwanted elements
		  const removeSelectors = [
		    'script', 'style', 'iframe', 'noscript',
		    'nav', 'header', 'footer', 'aside',
		    '.ad', '.ads', '.advertisement', '.advert',
		    '.sidebar', '.side-bar', '.widget',
		    '.nav', '.navigation', '.menu', '.navbar',
		    '.header', '.head', '.footer', '.bottom',
		    '.social', '.share', '.sharing',
		    '.comments', '.comment', '#comments',
		    '.related', '.recommended',
		    '.popup', '.modal', '.overlay',
		    '.newsletter', '.subscribe', '.subscription',
		    'form', 'button', 'input', 'select', 'textarea'
		  ];
		  
		  for (const selector of removeSelectors) {
		    const elements = contentClone.querySelectorAll(selector);
		    elements.forEach(el => el.remove());
		  }
		  
		  // Get text content, preserving paragraph structure
		  let textContent = '';
		  const paragraphs = contentClone.querySelectorAll('p, h1, h2, h3, h4, h5, h6, ul, ol, li, blockquote');
		  
		  if (paragraphs.length > 0) {
		    paragraphs.forEach(elem => {
		      // For list elements (ul, ol, li), preserve inner HTML to keep list structure
		      const isListElement = elem.nodeName === 'UL' || elem.nodeName === 'OL' || elem.nodeName === 'LI';
		      let text: string;
		      if (isListElement) {
		        // Get innerHTML to preserve list item structure
		        text = elem.innerHTML;
		      } else {
		        text = elem.textContent?.trim() || '';
		      }
		      if (text && text.length > 20) {
		        textContent += `<${elem.nodeName.toLowerCase()}>` + text + `</${elem.nodeName.toLowerCase()}>`;
		      }
		    });
		  } else {
		    textContent = contentClone.textContent || '';
		  }
		  
		  // Clean up the content
		  textContent = textContent
		    .replace(/\s+/g, ' ')
		    .replace(/<p>\s*<\/p>/g, '')
		    .trim();
		  
		  if (textContent) {
		    result.siteContent = textContent;
		  }
		}
		
		return result;
	} catch (e) {
		console.warn('Failed to extract image and site content from article:', articleUrl, e);
		return {};
	}
}

export function parseFeed(xmlText: string): ParsedFeed {
	const parser = new DOMParser();
	const xml = parser.parseFromString(xmlText, "text/xml");
	
	// Check if it's an Atom feed (root element is 'feed') or RSS feed (root element is 'rss' or contains 'channel')
	const isAtom = xml.querySelector("feed") !== null;
	
	if (isAtom) {
		return parseAtomFeed(xml);
	} else {
		return parseRssFeed(xml);
	}
}

function parseRssFeed(xml: Document): ParsedFeed {
	const title = xml.querySelector("channel > title")?.textContent || "Untitled Feed";
	const items = Array.from(xml.querySelectorAll("item")).map(item => {
		const title = item.querySelector("title")?.textContent || "No Title";
		const link = item.querySelector("link")?.textContent || "";
		const description = item.querySelector("description")?.textContent || "";
		const contentEncoded = item.getElementsByTagNameNS("*", "encoded")[0]?.textContent || "";
		const content = contentEncoded || description;
		const snippet = createSnippet(description || content);
		const guid = item.querySelector("guid")?.textContent || link;
		const pubDateStr = item.querySelector("pubDate")?.textContent || "";
		const pubDate = pubDateStr ? new Date(pubDateStr).getTime() : Date.now();
		
		// Try to get image from various RSS elements
		let image: string | undefined;
		const mediaContent = item.getElementsByTagNameNS("*", "content")[0]?.getAttribute("url");
		const mediaThumbnail = item.getElementsByTagNameNS("*", "thumbnail")[0]?.getAttribute("url");
		const enclosure = item.getElementsByTagName("enclosure")[0];
		const enclosureType = enclosure?.getAttribute("type") || "";
		const enclosureUrl = enclosure?.getAttribute("url");
		
		if (mediaContent) {
		  image = mediaContent;
		} else if (mediaThumbnail) {
		  image = mediaThumbnail;
		} else if (enclosureType.startsWith("image/") && enclosureUrl) {
		  image = enclosureUrl;
		}
		
		// Decode XML/HTML entities in content
		const decodedItem = decodeItemContent({
		  title,
		  link,
		  content,
		  snippet,
		  guid,
		  pubDate,
		  image,
		});
		
		return decodedItem;
	});

	return {
		title,
		items
	};
}

function parseAtomFeed(xml: Document): ParsedFeed {
	const title = xml.querySelector("feed > title")?.textContent || "Untitled Feed";
	const items = Array.from(xml.querySelectorAll("entry")).map(entry => {
		const title = entry.querySelector("title")?.textContent || "No Title";
		const link = entry.querySelector("link")?.getAttribute("href") || "";
		const content = entry.querySelector("content")?.textContent || entry.querySelector("summary")?.textContent || "";
		const snippet = createSnippet(content);
		const guid = entry.querySelector("id")?.textContent || link;
		const pubDateStr = entry.querySelector("published")?.textContent || entry.querySelector("updated")?.textContent || "";
		const pubDate = pubDateStr ? new Date(pubDateStr).getTime() : Date.now();
		const author = entry.querySelector("author > name")?.textContent;
		
		// Try to get image from Atom link elements
		let image: string | undefined;
		const linkElements = entry.querySelectorAll("link");
		for (const linkEl of linkElements) {
		  const rel = linkEl.getAttribute("rel");
		  const type = linkEl.getAttribute("type") || "";
		  const href = linkEl.getAttribute("href");
		  
		  if ((rel === "enclosure" || rel === "preview") && type.startsWith("image/") && href) {
		    image = href;
		    break;
		  }
		  // Also check for media:content or media:thumbnail
		  const mediaContent = entry.getElementsByTagNameNS("*", "content")[0]?.getAttribute("url");
		  const mediaThumbnail = entry.getElementsByTagNameNS("*", "thumbnail")[0]?.getAttribute("url");
		  if (mediaContent) {
		    image = mediaContent;
		    break;
		  } else if (mediaThumbnail) {
		    image = mediaThumbnail;
		    break;
		  }
		}
		
		// Decode XML/HTML entities in content
		const decodedItem = decodeItemContent({
		  title,
		  link,
		  content,
		  snippet,
		  guid,
		  pubDate,
		  author,
		  image,
		});
		
		return decodedItem;
	});

	return {
		title,
		items
	};
}
