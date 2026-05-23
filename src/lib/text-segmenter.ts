/**
 * Text segmentation utilities using Intl.Segmenter for full-text search.
 * Generates word lists and n-grams from text content.
 */

const DEFAULT_LOCALE = 'en-US';

const segmenterCache = new Map<string, Intl.Segmenter>();

export function getSegmenter(locale?: string): Intl.Segmenter {
	const loc = locale || DEFAULT_LOCALE;
	if (!segmenterCache.has(loc)) {
		segmenterCache.set(loc, new Intl.Segmenter(loc, { granularity: 'word' }));
	}
	return segmenterCache.get(loc)!;
}

/**
 * Normalizes a language tag to a standard format.
 * Defaults to 'en-US' for unknown tags.
 */
export function normalizeLanguage(langCode?: string): string {
	if (!langCode) return DEFAULT_LOCALE;
	const lower = langCode.toLowerCase();
	if (lower === 'en' || lower === 'english') return 'en-US';
	if (lower === 'en-us' || lower === 'en-us') return 'en-US';
	const normalized = lower.replace('_', '-');
	if (normalized.match(/^[a-z]{2,3}(-[a-z]{2})?$/)) {
		const parts = normalized.split('-');
		if (parts[0] === 'en' && parts.length === 1) return 'en-US';
		return `${parts[0].toLowerCase()}-${parts[1]?.toUpperCase() || 'US'}`;
	}
	return DEFAULT_LOCALE;
}

/**
 * Strips HTML tags from a string.
 */
export function stripHtml(html: string): string {
	if (!html) return '';
	return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Segments text into individual words using Intl.Segmenter.
 * Filters out punctuation and whitespace-only segments.
 */
export function segmentWords(text: string, locale?: string): string[] {
	if (!text) return [];

	const plainText = stripHtml(text);
	if (!plainText) return [];

	const words: string[] = [];
	const segmenter = getSegmenter(locale);
	const segments = segmenter.segment(plainText);

	for (const segment of segments) {
		const word = segment.segment.trim().toLowerCase();
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
	language: string;
}

export function generateSearchIndex(
	title: string,
	snippet: string,
	siteContent?: string,
	language?: string
): SearchIndexFields {
	const normalizedLang = normalizeLanguage(language);
	const titleWords = segmentWords(title, normalizedLang);
	const snippetWords = segmentWords(snippet, normalizedLang);
	const siteContentWords = siteContent ? segmentWords(siteContent, normalizedLang) : [];

	const titleNgrams = generateAllNgrams(titleWords, 3);
	const snippetNgrams = generateAllNgrams(snippetWords, 3);
	const siteContentNgrams = generateAllNgrams(siteContentWords, 3);

	return {
		titleWords,
		snippetWords,
		siteContentWords,
		titleNgrams,
		snippetNgrams,
		siteContentNgrams,
		language: normalizedLang
	};
}
