/**
 * Text segmentation utilities using Intl.Segmenter for full-text search.
 * Generates word lists and n-grams from text content.
 */

// Create a segmenter for word tokenization
// Using 'en' locale as default, can be customized per-use
const wordSegmenter = new Intl.Segmenter('en', { granularity: 'word' });

/**
 * Strips HTML tags from a string.
 */
function stripHtml(html: string): string {
	if (!html) return '';
	return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Segments text into individual words using Intl.Segmenter.
 * Filters out punctuation and whitespace-only segments.
 */
export function segmentWords(text: string): string[] {
	if (!text) return [];
	
	const plainText = stripHtml(text);
	if (!plainText) return [];
	
	const words: string[] = [];
	const segments = wordSegmenter.segment(plainText);
	
	for (const segment of segments) {
		const word = segment.segment.trim().toLowerCase();
		// Only include words that have at least 2 characters and contain letters
		if (word.length >= 2 && /[a-zA-Z]/.test(word)) {
		  words.push(word);
		}
	}
	
	return words;
}

/**
 * Generates n-grams from a list of words.
 * @param words Array of words to generate n-grams from
 * @param n The size of each n-gram (1 = unigrams, 2 = bigrams, 3 = trigrams, etc.)
 */
export function generateNgrams(words: string[], n: number): string[] {
	if (!words || words.length < n || n < 1) return [];
	
	const ngrams: string[] = [];
	for (let i = 0; i <= words.length - n; i++) {
		const ngram = words.slice(i, i + n).join(' ');
		ngrams.push(ngram);
	}
	return ngrams;
}

/**
 * Generates all n-grams from unigrams to maxN.
 * @param words Array of words to generate n-grams from
 * @param maxN Maximum n-gram size (default 3)
 */
export function generateAllNgrams(words: string[], maxN: number = 3): string[] {
	const allNgrams: string[] = [];
	for (let n = 1; n <= maxN; n++) {
		allNgrams.push(...generateNgrams(words, n));
	}
	return allNgrams;
}

/**
 * Generates search index fields for an article.
 * Returns an object containing word lists and n-gram lists for title, snippet, and siteContent.
 */
export interface SearchIndexFields {
	titleWords: string[];
	snippetWords: string[];
	siteContentWords: string[];
	titleNgrams: string[];
	snippetNgrams: string[];
	siteContentNgrams: string[];
}

export function generateSearchIndex(
	title: string,
	snippet: string,
	siteContent?: string
): SearchIndexFields {
	// Segment text into words
	const titleWords = segmentWords(title);
	const snippetWords = segmentWords(snippet);
	const siteContentWords = siteContent ? segmentWords(siteContent) : [];
	
	// Generate n-grams (up to trigrams)
	const titleNgrams = generateAllNgrams(titleWords, 3);
	const snippetNgrams = generateAllNgrams(snippetWords, 3);
	const siteContentNgrams = generateAllNgrams(siteContentWords, 3);
	
	return {
		titleWords,
		snippetWords,
		siteContentWords,
		titleNgrams,
		snippetNgrams,
		siteContentNgrams
	};
}
