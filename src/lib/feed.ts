export interface ParsedFeed {
  title: string;
  items: ParsedItem[];
}

/**
 * Decodes XML/HTML encoded characters in a string.
 * Handles entities like &lt;, &gt;, &amp;, &quot;, &apos;, and numeric character references.
 */
export function decodeHtmlEntities(text: string): string {
  if (!text) return text;
  
  // Use a textarea element to decode HTML entities
  const textarea = document.createElement('textarea');
  textarea.innerHTML = text;
  return textarea.value;
}

/**
 * Decodes XML/HTML encoded characters in content fields of a ParsedItem.
 */
function decodeItemContent(item: ParsedItem): ParsedItem {
  return {
    ...item,
    title: decodeHtmlEntities(item.title),
    content: decodeHtmlEntities(item.content),
    snippet: decodeHtmlEntities(item.snippet),
  };
}

export interface ParsedItem {
  title: string;
  link: string;
  content: string;
  snippet: string;
  guid: string;
  pubDate: number; // timestamp
  author?: string;
  image?: string;
}

export async function fetchAndParseFeed(url: string): Promise<ParsedFeed> {
	const response = await fetch(url);
	const text = await response.text();
	const feed = parseFeed(text);

	// Extract images for items that don't have them
	const itemsWithImages = await Promise.all(
		feed.items.map(async (item) => {
			if (!item.image && item.link) {
				const image = await extractImageFromArticle(item.link);
				if (image) {
					console.log(`Image successfully acquired for ${url}: ${image}`);
					return { ...item, image };
				}
			}
			return item;
		})
	);

	return {
		...feed,
		items: itemsWithImages
	};
}

async function extractImageFromArticle(articleUrl: string): Promise<string | undefined> {
  try {
	console.info('Fetching article for image: ', articleUrl);
    const response = await fetch(articleUrl);
    const contentType = response.headers.get("content-type") || "";
    
    // Only process HTML pages
    if (!contentType.includes("text/html")) {
      throw Error(`Image extraction for ${articleUrl} failed: content-type is ${contentType}, expected text/html`);
    }
    
    const html = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    
    // Try Open Graph image
    const ogImage = doc.querySelector('meta[property="og:image"]')?.getAttribute("content");
    if (ogImage) return ogImage;
    
    // Try Twitter image
    const twitterImage = doc.querySelector('meta[name="twitter:image"]')?.getAttribute("content");
    if (twitterImage) return twitterImage;
    
    // Try other common meta image tags
    const metaImage = doc.querySelector('meta[name="image"]')?.getAttribute("content");
    if (metaImage) return metaImage;
    
    return undefined;
  } catch (e) {
    console.warn('Failed to extract image from article:', articleUrl, e);
    return undefined;
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
    const snippet = (description || content).substring(0, 200).replace(/<[^>]+>/g, '') + "...";
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
    const snippet = content.substring(0, 200).replace(/<[^>]+>/g, '') + "...";
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
