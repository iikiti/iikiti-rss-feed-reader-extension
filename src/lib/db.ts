import Dexie, { type Table } from 'dexie';

import { eng } from 'stopword';
import { segmentWords, generateAllNgrams, getSegmenter, normalizeLanguage } from './text-segmenter';

export interface User {
	id?: number;
	name: string;
	createdAt: number;
}

export interface Feed {
	id?: number;
	userId: number;
	url: string;
	title: string;
	folderId?: number;
	order?: number;
	lastFetched?: Date;
	error?: string;
	favicon?: string;
	language?: string;
}

export interface Article {
	id?: number;
	userId: number;
	feedId: number;
	guid: string;
	title: string;
	link: string;
	content: string;
	siteContent?: string;
	snippet: string;
	pubDate: number;
	read: boolean;
	starred: boolean;
	author?: string;
	image?: string;
	language?: string;
	titleWords?: string[];
	snippetWords?: string[];
	siteContentWords?: string[];
	titleNgrams?: string[];
	snippetNgrams?: string[];
	siteContentNgrams?: string[];
}

export interface Folder {
	id?: number;
	userId: number;
	name: string;
	parentId?: number;
	order?: number;
}

export interface View {
	id?: number;
	userId: number;
	name: string;
	filterJson: string;
}

export class IikitiDB extends Dexie {
	users!: Table<User>;
	feeds!: Table<Feed>;
	articles!: Table<Article>;
	folders!: Table<Folder>;
	views!: Table<View>;

constructor() {
		super('iikiti');
		// Version 1: Original schema (no users)
		// Version 2: Added views
		// Version 3: Added users table and userId to all tables
		// Version 4: Added indexes for pubDate and title on articles for sorting
		// Version 5: Fixed unique constraint on folder name (now unique per user)
		// Version 6: Added siteContent field to articles
		// Version 7: Added full-text search index fields
		// Version 8: Added order field to folders and feeds
		// Version 9: Added compound indexes [userId+pubDate] and [userId+title] for efficient
		//            per-user sorted pagination without loading all rows into memory
		// Version 10: Added language field to articles and feeds
		this.version(10).stores({
			users: '++id, &name',
			feeds: '++id, userId, &url, folderId, [userId+order]',
			articles: '++id, userId, feedId, &guid, pubDate, [read+feedId], starred, title, [userId+pubDate], [userId+title], language',
			folders: '++id, userId, [userId+name], parentId, [userId+order]',
			views: '++id, userId, &name'
		});
	}
}

export const db = new IikitiDB();

// User management functions
export async function getCurrentUserId(): Promise<number> {
	const result = await chrome.storage.local.get('currentUserId') as { currentUserId?: number };
	if (result.currentUserId) {
		// Verify the user still exists
		const user = await db.users.get(result.currentUserId);
		if (user) return result.currentUserId;
	}

	// Get or create default user
	const users = await db.users.toArray();
	if (users.length === 0) {
		const userId = await db.users.add({ name: 'Default User', createdAt: Date.now() });
		await chrome.storage.local.set({ currentUserId: userId });
		return userId as number;
	}

	// Set the first user as current
	await chrome.storage.local.set({ currentUserId: users[0].id });
	return users[0].id!;
}

export async function setCurrentUserId(userId: number): Promise<void> {
	await chrome.storage.local.set({ currentUserId: userId });
}

export async function getAllUsers(): Promise<User[]> {
	return db.users.toArray();
}

export async function createUser(name: string): Promise<number> {
	const userId = await db.users.add({ name, createdAt: Date.now() });
	return userId as number;
}

export async function deleteUser(userId: number): Promise<void> {
	// Delete all user data
	await db.feeds.where('userId').equals(userId).delete();
	await db.articles.where('userId').equals(userId).delete();
	await db.folders.where('userId').equals(userId).delete();
	await db.views.where('userId').equals(userId).delete();
	await db.users.delete(userId);

	// If this was the current user, switch to another user
	const result = await chrome.storage.local.get('currentUserId') as { currentUserId?: number };
	if (result.currentUserId === userId) {
		const remainingUsers = await db.users.toArray();
		if (remainingUsers.length > 0) {
			await chrome.storage.local.set({ currentUserId: remainingUsers[0].id });
		} else {
			// Create a new default user if all users deleted
			const newUserId = await db.users.add({ name: 'Default User', createdAt: Date.now() });
			await chrome.storage.local.set({ currentUserId: newUserId });
		}
	}
}

export async function renameUser(userId: number, newName: string): Promise<void> {
	await db.users.update(userId, { name: newName });
}

// Data access helpers that filter by current user
export async function getUserFeeds(userId: number): Promise<Feed[]> {
	return db.feeds.where('userId').equals(userId).toArray();
}

export async function getUserFolders(userId: number): Promise<Folder[]> {
	return db.folders.where('userId').equals(userId).toArray();
}

export async function getUserViews(userId: number): Promise<View[]> {
	return db.views.where('userId').equals(userId).toArray();
}

export async function getUserArticles(userId: number): Promise<Article[]> {
	return db.articles.where('userId').equals(userId).toArray();
}

// Update feed order
export async function updateFeedOrder(feedId: number, order: number): Promise<void> {
	await db.feeds.update(feedId, { order });
}

// Update folder order
export async function updateFolderOrder(folderId: number, order: number): Promise<void> {
	await db.folders.update(folderId, { order });
}

// Sort options for articles
export type SortOption = 'pubDateDesc' | 'pubDateAsc' | 'titleAsc' | 'titleDesc';

export async function getUserArticlesSorted(userId: number, sortBy: SortOption = 'pubDateDesc'): Promise<Article[]> {
	// Use compound index to avoid loading all articles and filtering in JS
	switch (sortBy) {
		case 'pubDateDesc':
			return db.articles.where('[userId+pubDate]').between([userId, Dexie.minKey], [userId, Dexie.maxKey]).reverse().toArray();
		case 'pubDateAsc':
			return db.articles.where('[userId+pubDate]').between([userId, Dexie.minKey], [userId, Dexie.maxKey]).toArray();
		case 'titleAsc':
			return db.articles.where('[userId+title]').between([userId, Dexie.minKey], [userId, Dexie.maxKey]).toArray();
		case 'titleDesc':
			return db.articles.where('[userId+title]').between([userId, Dexie.minKey], [userId, Dexie.maxKey]).reverse().toArray();
		default:
			return db.articles.where('[userId+pubDate]').between([userId, Dexie.minKey], [userId, Dexie.maxKey]).reverse().toArray();
	}
}

// Get paginated articles with optional filtering.
// For the unfiltered case (no feedId/folderId/read/starred) the compound index
// [userId+pubDate] / [userId+title] is used for DB-level sorting and pagination,
// which avoids loading the entire article set into memory.
// When filters are present the data is loaded for that user and filtered in JS.
export async function getPaginatedArticles(
	userId: number,
	options: {
		feedId?: number;
		folderId?: number;
		read?: boolean;
		starred?: boolean;
		sortBy?: SortOption;
		limit?: number;
		offset?: number;
	} = {}
): Promise<{ articles: Article[]; hasMore: boolean }> {
	const limit = options.limit ?? 25;
	const offset = options.offset ?? 0;
	const sortBy = options.sortBy ?? 'pubDateDesc';

	const hasFilters =
		options.feedId !== undefined ||
		options.folderId !== undefined ||
		options.read !== undefined ||
		options.starred !== undefined;

	// ── Fast path: no extra filters ─────────────────────────────────────────
	// Use the compound index for true DB-level sorted pagination.
	if (!hasFilters) {
		const isDateSort = sortBy === 'pubDateDesc' || sortBy === 'pubDateAsc';
		const indexName = isDateSort ? '[userId+pubDate]' : '[userId+title]';
		const isDesc = sortBy === 'pubDateDesc' || sortBy === 'titleDesc';

		let coll = db.articles
			.where(indexName)
			.between([userId, Dexie.minKey], [userId, Dexie.maxKey]);
		if (isDesc) coll = coll.reverse();

		const [articles, totalCount] = await Promise.all([
			coll.offset(offset).limit(limit).toArray(),
			db.articles.where('userId').equals(userId).count(),
		]);

		return { articles, hasMore: offset + limit < totalCount };
	}

	// ── Filtered path ────────────────────────────────────────────────────────
	// Load only this user's articles then apply filters in JS.
	let articles = await db.articles.where('userId').equals(userId).toArray();

	if (options.feedId !== undefined) {
		articles = articles.filter(a => a.feedId === options.feedId);
	}
	if (options.folderId !== undefined) {
		const feedsInFolder = await db.feeds.where('userId').equals(userId).toArray();
		const getChildFolderIds = (parentId: number): number[] => {
			const childIds = feedsInFolder
				.filter(f => f.folderId === parentId)
				.map(f => f.id!);
			// re-use feedsInFolder as a proxy; actual folder recursion is below
			const childFolders = feedsInFolder; // unused — see below
			void childFolders;
			return childIds;
		};
		// Collect all folder IDs in the subtree
		const allFolders = await db.folders.where('userId').equals(userId).toArray();
		const getAllDescendantFolderIds = (parentId: number): number[] => {
			const children = allFolders.filter(f => f.parentId === parentId).map(f => f.id!);
			return [...children, ...children.flatMap(id => getAllDescendantFolderIds(id))];
		};
		const folderIds = [options.folderId, ...getAllDescendantFolderIds(options.folderId)];
		const folderFeedIds = feedsInFolder
			.filter(f => f.folderId !== undefined && folderIds.includes(f.folderId))
			.map(f => f.id!);
		articles = articles.filter(a => folderFeedIds.includes(a.feedId));
	}
	if (options.read !== undefined) {
		articles = articles.filter(a => a.read === options.read);
	}
	if (options.starred !== undefined) {
		articles = articles.filter(a => a.starred === options.starred);
	}

	// Sort
	articles.sort((a, b) => {
		switch (sortBy) {
			case 'pubDateDesc': return (b.pubDate || 0) - (a.pubDate || 0);
			case 'pubDateAsc':  return (a.pubDate || 0) - (b.pubDate || 0);
			case 'titleAsc':    return (a.title || '').localeCompare(b.title || '');
			case 'titleDesc':   return (b.title || '').localeCompare(a.title || '');
			default:            return (b.pubDate || 0) - (a.pubDate || 0);
		}
	});

	const hasMore = articles.length > offset + limit;
	return { articles: articles.slice(offset, offset + limit), hasMore };
}

export interface SearchOptions {
	feedId?: number;
	read?: boolean;
	starred?: boolean;
	limit?: number;
	offset?: number;
	useNgrams?: boolean;
	language?: string;
}

export async function searchArticles(
	userId: number,
	query: string,
	options: SearchOptions = {}
): Promise<Article[]> {
	const limit = options.limit ?? 25;
	const offset = options.offset ?? 0;
	const useNgrams = options.useNgrams ?? true;
	const searchLocale = options.language ? normalizeLanguage(options.language) : undefined;

	if (!query || !query.trim()) {
		let coll = db.articles
			.where('[userId+pubDate]')
			.between([userId, Dexie.minKey], [userId, Dexie.maxKey])
			.reverse();

		if (options.feedId !== undefined) coll = coll.and(a => a.feedId === options.feedId);
		if (options.read !== undefined)   coll = coll.and(a => a.read === options.read);
		if (options.starred !== undefined) coll = coll.and(a => a.starred === options.starred);

		return coll.offset(offset).limit(limit).toArray();
	}

	const words = segmentWords(query, searchLocale);
	const searchTerms = useNgrams ? [...new Set([...words, ...generateAllNgrams(words, 3)])] : words;

	if (searchTerms.length === 0) {
		return [];
	}

	let articles = await db.articles.where('userId').equals(userId).toArray();

	if (options.feedId !== undefined) {
		articles = articles.filter(a => a.feedId === options.feedId);
	}
	if (options.read !== undefined) {
		articles = articles.filter(a => a.read === options.read);
	}
	if (options.starred !== undefined) {
		articles = articles.filter(a => a.starred === options.starred);
	}

	const matchingArticles = articles.filter(article => {
		const searchableFields = [
			...(article.titleWords || []),
			...(article.snippetWords || []),
			...(article.siteContentWords || [])
		];
		if (useNgrams) {
			searchableFields.push(
				...(article.titleNgrams || []),
				...(article.snippetNgrams || []),
				...(article.siteContentNgrams || [])
			);
		}
		return searchTerms.some(term =>
			searchableFields.some(field => field.includes(term))
		);
	});

	return scoreAndSortArticles(matchingArticles, searchTerms)
		.slice(offset, offset + limit);
}

// ── Relevance scoring helpers ──────────────────────────────────────────────────

type FieldType = 'title' | 'snippet' | 'siteContent';

const FIELD_WEIGHTS: Record<FieldType, number> = {
	title: 30,
	snippet: 10,
	siteContent: 2,
};

/** Scaled position bonus: matches earlier in the field score higher.
 *  Returns a multiplier in [0.8, 1.1]: words at the very start get +10%,
 *  words at the very end get −20%.
 */
function positionMult(fraction: number): number {
	return 1.1 - 0.3 * fraction; // fraction 0 → 1.1, fraction 1 → 0.8
}

/** Find the index of `term` (lowercase) among the knowntokens of a field,
 *  or return -1 if not found.  Used for single-word lookups.
 */
function findWordIndex(term: string, wordList: string[]): number {
	return wordList.indexOf(term);
}

/** Find the starting word index of the n-gram `ngram` within `wordList`.
 *  Returns -1 if the n-gram sequence does not appear at that position.
 */
function findNgramIndex(ngram: string, wordList: string[]): number {
	if (wordList.length === 0) return -1;
	const tokens = ngram.split(' ');
	for (let i = 0; i <= wordList.length - tokens.length; i++) {
		let ok = true;
		for (let j = 0; j < tokens.length; j++) {
			if (wordList[i + j] !== tokens[j]) { ok = false; break; }
		}
		if (ok) return i;
	}
	return -1;
}

interface TermHit {
	fieldType: FieldType;
	/** Best score achieved for this search term in this field.
	 *  Stored during the "max score" pass and used to skip re-checking
	 *  an already-best-matched term during the "thanks" pass.
	 */
	maxScore?: number;
}

interface ArticleScore { article: Article; score: number }

/** Positions for every unique search term within every field of `article`.
 *  Returns a map keyed by `${fieldType}#${term}` → 0-based word-index within
 *  that field's word list, or -1 if the term is absent.
 */
function collectMatchPositions(
	article: Article,
	searchTerms: string[]
): Map<string, number> {
	const titleWords = article.titleWords ?? [];
	const snippetWords = article.snippetWords ?? [];
	const siteContentWords = article.siteContentWords ?? [];
	const map = new Map<string, number>();

	for (const term of searchTerms) {
		for (const { fieldType, wordList, ngramList } of [
			{ fieldType: 'title',       wordList: titleWords,       ngramList: article.titleNgrams ?? [] },
			{ fieldType: 'snippet',     wordList: snippetWords,     ngramList: article.snippetNgrams ?? [] },
			{ fieldType: 'siteContent', wordList: siteContentWords, ngramList: article.siteContentNgrams ?? [] },
		] as const) {
			const wordIdx = findWordIndex(term, wordList);
			if (wordIdx >= 0) {
				map.set(`${fieldType}#${term}`, wordIdx);
				continue;
			}
			const ngramIdx = findNgramIndex(term, ngramList);
			if (ngramIdx >= 0) {
				map.set(`${fieldType}#${term}`, ngramIdx);
			}
		}
	}

	return map;
}

/** Score one article against `searchTerms`.
 *
 *  Scoring rules (applied in priority order; each search term is awarded
 *  only its highest-scoring opportunity):
 *
 *  1. **Field weight**  — title ×30, snippet ×10, siteContent ×2
 *  2. **Match type**    — phrase/ngram match = ×2.0; unigram = ×1.0
 *  3. **Position**      — earlier matches in a field score higher
 *                          via `positionMult(totalWords, index)` in [0.8, 1.1]
 *  4. **Term bonus**    — each additional matching term adds 15% of the
 *                          highest single-term score (max +45%)
 */
function scoreArticle(article: Article, searchTerms: string[]): number {
	if (searchTerms.length === 0) return 0;

	const titleWords = article.titleWords ?? [];
	const snippetWords = article.snippetWords ?? [];
	const siteContentWords = article.siteContentWords ?? [];

	// Total words per field for position normalisation.
	const fieldWordCounts: Record<string, number> = {
		title: titleWords.length,
		snippet: snippetWords.length,
		siteContent: siteContentWords.length,
	};

	// Aggregate raw points per search term.
	// We keep the best-scoring hit per term so each term only counts once.
	const bestPerTerm = new Map<string, number>();
	let totalUnscaled = 0;

	for (const term of searchTerms) {
		let best = 0;

		for (const { fieldType, wordList, ngramList } of [
			{ fieldType: 'title',       wordList: titleWords,       ngramList: article.titleNgrams ?? [] },
			{ fieldType: 'snippet',     wordList: snippetWords,     ngramList: article.snippetNgrams ?? [] },
			{ fieldType: 'siteContent', wordList: siteContentWords, ngramList: article.siteContentNgrams ?? [] },
		] as const) {
			const fw = FIELD_WEIGHTS[fieldType];
			const wc = fieldWordCounts[fieldType];
			if (fw <= 0 || wc === 0) continue;

			// Exact unigram/phrase match — higher value.
			const idx = findWordIndex(term, wordList);
			if (idx >= 0) {
				const raw = fw * positionMult(idx / wc);
				best = Math.max(best, raw);
				continue;
			}

			// N-gram / partial match — slightly lower.
			const ngIdx = findNgramIndex(term, ngramList);
			if (ngIdx >= 0) {
				const raw = fw * 0.5 * positionMult(ngIdx / wc);
				best = Math.max(best, raw);
			}
		}

		bestPerTerm.set(term, best);
		totalUnscaled += best;
	}

	if (totalUnscaled === 0) return 0;

	// Count how many terms actually contributed (have a positive best score).
	let matchedTerms = 0;
	for (const v of bestPerTerm.values()) if (v > 0) matchedTerms++;

	// Each additional matched term beyond the first adds 15% of the top score,
	// capped at +45 % (i.e. three bonus terms).
	const topScore = Math.max(...bestPerTerm.values());
	const extraTerms = Math.min(matchedTerms - 1, 3);
	const termBonus = 1 + (extraTerms * 0.15);

	return Math.round(totalUnscaled * termBonus);
}

/** Score all articles and return them sorted by relevance score (descending). */
function scoreAndSortArticles(articles: Article[], searchTerms: string[]): Article[] {
	if (articles.length === 0) return articles;

	const scored: ArticleScore[] = articles.map(a => ({
		article: a,
		score: scoreArticle(a, searchTerms),
	}));

	scored.sort((a, b) => b.score - a.score);
	return scored.map(s => s.article);
}

// ── Search history helpers ─────────────────────────────────────────────────────
const SEARCH_HISTORY_KEY = 'searchHistory';
const MAX_HISTORY_ENTRIES = 500;

export interface SearchHistoryEntry {
	query: string;
	timestamp: number;
}

/**
 * Read the full search-history array from chrome.storage.local for this user.
 */
export async function readSearchHistory(userId: number): Promise<SearchHistoryEntry[]> {
	const result = await chrome.storage.local.get(SEARCH_HISTORY_KEY) as {
		[SEARCH_HISTORY_KEY]?: SearchHistoryEntry[];
	};
	return result[SEARCH_HISTORY_KEY] ?? [];
}

/**
 * Append a new query to the user's search history, de-duplicating against the
 * most-recent entries and capping total entries at MAX_HISTORY_ENTRIES.
 */
export async function saveSearchQuery(userId: number, query: string): Promise<void> {
	if (!query.trim() || query.trim().length < 3) return;

	const history = await readSearchHistory(userId);
	const trimmed = query.trim();

	// Remove the same query if it already exists so the new timestamp wins
	const existingIdx = history.findIndex(e => e.query === trimmed);
	if (existingIdx !== -1) {
		history.splice(existingIdx, 1);
	}

	history.unshift({ query: trimmed, timestamp: Date.now() });

	// Cap at MAX_HISTORY_ENTRIES
	if (history.length > MAX_HISTORY_ENTRIES) {
		history.length = MAX_HISTORY_ENTRIES;
	}

	await chrome.storage.local.set({ [SEARCH_HISTORY_KEY]: history });
}

// English stop-words from the `stopword` npm package (eng list).
// Lowercased for case-insensitive lookup; only trailing tokens are stripped.
const STOP_WORDS = new Set(eng.map((w: string) => w.toLowerCase()));

/**
 * If `candidate` ends with one or more stop-words, strip them off and
 * return the cleaned string.  Returns the original string if the whole
 * candidate is a stop word or if no trailing stop-word is found.
 *
 * Works on single words and multi-word phrases alike.
 */
function trimTrailingStopWords(candidate: string): string {
	const tokens = candidate.toLowerCase().split(/\s+/).filter(Boolean);
	// Walk backwards while the token is a stop word
	while (tokens.length > 1 && STOP_WORDS.has(tokens[tokens.length - 1])) {
		tokens.pop();
	}
	return tokens.join(' ');
}

// ── Autocomplete / search suggestions ─────────────────────────────────────────
// Builds two frequency maps — one for single words and one for multi-word
// phrases (n-grams drawn from article titles/snippets/site content).
// Also accepts an optional searchHistory list; matching history items are
// returned FIRST so users see their frequently-repeated phrases at the top.
// Returns up to `limit` unique suggestions (default 200) sorted by frequency
// descending, then alphabetically ascending.
export async function getSearchSuggestions(
	userId: number,
	query: string,
	options: { limit?: number; searchHistory?: string[] } = {}
): Promise<string[]> {
	const maxResults = options.limit ?? 200;
	if (!query || query.length < 1) return [];

	const lowerQuery = query.toLowerCase();
	const allArticles = await db.articles.where('userId').equals(userId).toArray();

	// word → frequency
	const wordFreq = new Map<string, number>();
	// phrase (space-joined n-gram) → frequency
	const phraseFreq = new Map<string, number>();

	const addWord = (w: string) => {
		const lw = w.toLowerCase();
		wordFreq.set(lw, (wordFreq.get(lw) || 0) + 1);
	};

	for (const article of allArticles) {
		for (const w of article.titleWords || []) addWord(w);
		for (const w of article.snippetWords || []) addWord(w);
		for (const w of article.siteContentWords || []) addWord(w);
	}

	// --- Phase 1: matching search-history items go first (highest priority) ---
	const historyMatches: string[] = [];
	if (options.searchHistory) {
		for (const entry of options.searchHistory) {
			if (entry.length < 3) continue; // skip 1–2 character entries
			if (entry.toLowerCase().startsWith(lowerQuery) && entry.toLowerCase() !== lowerQuery) {
				historyMatches.push(entry);
			}
		}
	}
	// deduplicate while preserving insertion order
	const seen = new Set<string>();
	const dedupedHistory: string[] = [];
	for (const h of historyMatches) {
		if (!seen.has(h)) {
			seen.add(h);
			dedupedHistory.push(h);
		}
	}

	// --- Phase 2: frequent words that start with the query prefix ---
	const wordMatches: Array<{ text: string; freq: number }> = [];
	for (const [word, freq] of wordFreq) {
		if (word.startsWith(lowerQuery) && word !== lowerQuery) {
			wordMatches.push({ text: word, freq });
		}
	}

	wordMatches.sort((a, b) => {
		if (b.freq !== a.freq) return b.freq - a.freq;
		return a.text.localeCompare(b.text);
	});

	// --- Merge: history first, then words up to the cap ---
	const results: string[] = [];
	for (const h of dedupedHistory) {
		if (results.length >= maxResults) break;
		if (h.toLowerCase() !== lowerQuery) {
			const cleaned = trimTrailingStopWords(h);
			if (cleaned) {
				results.push(cleaned);
				seen.add(cleaned);
			}
		}
	}
	for (const w of wordMatches) {
		if (results.length >= maxResults) break;
		if (!seen.has(w.text)) {
			const cleaned = trimTrailingStopWords(w.text);
			if (cleaned) {
				results.push(cleaned);
				seen.add(cleaned);
			}
		}
	}

	return results;
}

// ── Batch count helpers ──────────────────────────────────────────────────────
//
// getAllArticleCounts replaces the previous pattern of firing O(feeds + folders + views)
// individual DB queries in loadFeedAndFolderCounts().  It loads articles once and
// computes all counts in a single JS pass.

export interface ArticleCounts {
	total: number;
	unread: number;
}

export async function getAllArticleCounts(
	userId: number,
	feeds: Feed[],
	folders: Folder[],
	views: View[]
): Promise<{
	feedCounts: Record<number, ArticleCounts>;
	folderCounts: Record<number, ArticleCounts>;
	viewCounts: Record<number, ArticleCounts>;
	totalCounts: ArticleCounts;
}> {
	// Single DB fetch: only this user's articles
	const articles = await db.articles.where('userId').equals(userId).toArray();

	// ── Feed counts — O(articles) ────────────────────────────────────────────
	const feedCounts: Record<number, ArticleCounts> = {};
	let totalUnread = 0;

	for (const article of articles) {
		const c = (feedCounts[article.feedId] ??= { total: 0, unread: 0 });
		c.total++;
		if (!article.read) { c.unread++; totalUnread++; }
	}

	const totalCounts: ArticleCounts = { total: articles.length, unread: totalUnread };

	// ── Folder counts — recursive, but fully in-memory ───────────────────────
	// Build parent → children map for the folder tree
	const folderChildren: Record<number, number[]> = {};
	for (const folder of folders) {
		if (folder.parentId !== undefined && folder.id !== undefined) {
			(folderChildren[folder.parentId] ??= []).push(folder.id);
		}
	}

	function computeFolderCounts(folderId: number): ArticleCounts {
		const counts: ArticleCounts = { total: 0, unread: 0 };

		// Sum direct feeds
		for (const feed of feeds) {
			if (feed.folderId === folderId && feed.id !== undefined) {
				const fc = feedCounts[feed.id];
				if (fc) { counts.total += fc.total; counts.unread += fc.unread; }
			}
		}

		// Sum child folders
		for (const childId of folderChildren[folderId] ?? []) {
			const cc = computeFolderCounts(childId);
			counts.total += cc.total;
			counts.unread += cc.unread;
		}

		return counts;
	}

	const folderCounts: Record<number, ArticleCounts> = {};
	for (const folder of folders) {
		if (folder.id !== undefined) {
			folderCounts[folder.id] = computeFolderCounts(folder.id);
		}
	}

	// ── View counts ──────────────────────────────────────────────────────────
	const viewCounts: Record<number, ArticleCounts> = {};
	for (const view of views) {
		if (view.id === undefined) continue;
		const filter = JSON.parse(view.filterJson) as { read?: string; starred?: string };
		let total = 0, unread = 0;
		for (const article of articles) {
			if (filter.read === 'unread' && article.read) continue;
			if (filter.read === 'read' && !article.read) continue;
			if (filter.starred === 'starred' && !article.starred) continue;
			total++;
			if (!article.read) unread++;
		}
		viewCounts[view.id] = { total, unread };
	}

	return { feedCounts, folderCounts, viewCounts, totalCounts };
}
