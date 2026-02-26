// src/content/index.ts
var detectFeeds = () => {
  const feeds = Array.from(document.querySelectorAll('link[rel="alternate"][type="application/rss+xml"], link[rel="alternate"][type="application/atom+xml"]')).map((link) => ({
    title: link.getAttribute("title") || "RSS Feed",
    url: link.href,
    type: link.getAttribute("type")
  }));
  if (feeds.length > 0) {
    console.log("[iikiti] Detected feeds:", feeds);
    chrome.runtime.sendMessage({ type: "FEEDS_DETECTED", feeds });
  }
};
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", detectFeeds);
} else {
  detectFeeds();
}
