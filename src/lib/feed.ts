export interface ParsedFeed {
  title: string;
  items: ParsedItem[];
}

export interface ParsedItem {
  title: string;
  link: string;
  content: string;
  snippet: string;
  guid: string;
  pubDate: number; // timestamp
  author?: string;
}

export async function fetchAndParseFeed(url: string): Promise<ParsedFeed> {
  const response = await fetch(url);
  const text = await response.text();
  return parseFeed(text);
}

export function parseFeed(xmlText: string): ParsedFeed {
  const parser = new DOMParser();
  const xml = parser.parseFromString(xmlText, "text/xml");
  
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
    
    return {
      title,
      link,
      content,
      snippet,
      guid,
      pubDate,
    };
  });

  return {
    title,
    items
  };
}
