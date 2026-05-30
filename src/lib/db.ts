import Dexie, { type Table, type Transaction } from 'dexie';

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

export enum FieldType {
	title,
	snippet,
	siteContent
}

const FIELD_TYPES: FieldType[] = [FieldType.title, FieldType.snippet, FieldType.siteContent];

const onCreatingOrUpdatingArticle =
	function (
		this: { onsuccess: Function, onerror: Function },
		primaryKey: undefined | number | string,
		obj: Article,
		transaction: Transaction,
		modifications: undefined | {}
	) {
		this.onsuccess = async function (id: number | string) {
			const savedArticle = await db.articles.get(id);
			if (!savedArticle) {
				throw new Error('Article is missing: ' + id);
			}
			id = Number(id);
			transaction.on("complete", function () {
				console.info(`Successfully added article with id & guid`, id, savedArticle);
				setArticleSearchIndex(id, {
					title: savedArticle.title,
					snippet: savedArticle.snippet,
					siteContent: savedArticle.siteContent,
					language: savedArticle.language,
				});
			});
		};
		if (!modifications) {
			return db.articles.get({ "guid": obj.guid }).then((existing) => {
				if (existing) {
					console.warn(`Article with guid ${existing.guid} already exists, skipping.`);
					return null;
				}
				console.warn(`Existing?`, existing);
			});
		} else {
			return {};
		}
	};

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
		// Version 11: Normalised word/ngram storage into shared dictionary tables
		//             with articleWordLinks / articleNgrams junction tables, and
		//             removed the inline word/ngram arrays from the Article schema.
		// Version 12: Added article search index arrays and dropped the articleWords/articleNgrams tables.
		this.version(12)
			.stores({
				users: '++id, &name',
				feeds: '++id, userId, &url, folderId, [userId+order]',
				articles: '++id, userId, feedId, &guid, pubDate, [read+feedId], starred, title, [userId+pubDate], [userId+title], language, *titleWords, *snippetWords, *siteContentWords',
				folders: '++id, userId, [userId+name], parentId, [userId+order]',
				views: '++id, userId, &name',
			});
		// Version 13: Switched to using words on articles to minimize IDs passed in where conditions.
		this.version(13)
			.stores({
				users: '++id, &name',
				feeds: '++id, userId, &url, folderId, [userId+order]',
				articles: '++id, userId, feedId, &guid, pubDate, [read+feedId], starred, title, [userId+pubDate], [userId+title], language, *titleWords, *snippetWords, *siteContentWords',
				folders: '++id, userId, [userId+name], parentId, [userId+order]',
				views: '++id, userId, &name',
			})
			.upgrade(async trans => {
				await trans.table('articles').toCollection().modify((article: any) => {
					const normalizedLang = normalizeLanguage(article.language);
					article.titleWords = segmentWords(article.title, normalizedLang);
					article.snippetWords = segmentWords(article.snippet, normalizedLang);
					article.siteContentWords = article.siteContent ? segmentWords(article.siteContent, normalizedLang) : [];
				});
			});

		// Hook for when new articles are added to add the search index words automatically.
		this.articles.hook('creating', function (
			primaryKey,
			obj: Article,
			transaction: Transaction
		) {
			onCreatingOrUpdatingArticle.call(
				this as { onsuccess: Function, onerror: Function },
				primaryKey as undefined | number | string,
				obj,
				transaction,
				undefined
			);
		});
		this.articles.hook('updating', function (
			modifications,
			primaryKey,
			obj: Article,
			transaction: Transaction
		) {
			onCreatingOrUpdatingArticle.call(
				this as { onsuccess: Function, onerror: Function },
				primaryKey as undefined | number | string,
				obj,
				transaction,
				modifications
			);
		});
	}
}

export const db = new IikitiDB();

// ── Search index helpers ───────────────────────────────────────────────────────

interface SearchIndexInput {
	title: string;
	snippet: string;
	siteContent?: string;
	language?: string;
}

interface ComputedSearchIndex {
	wordsByField: Record<string, string[]>;
	language: string;
}

/**
 * Computes the tokenised word lists for each searchable field.
 * Does **not** touch the database – call `setArticleSearchIndex` to persist.
 */
function computeSearchIndex(
	{ title, snippet, siteContent, language }: SearchIndexInput
): ComputedSearchIndex {
	const normalizedLang = normalizeLanguage(language);
	const titleWords = segmentWords(title, normalizedLang);
	const snippetWords = segmentWords(snippet, normalizedLang);
	const siteContentWords = siteContent ? segmentWords(siteContent, normalizedLang) : [];

	return {
		wordsByField: { title: titleWords, snippet: snippetWords, siteContent: siteContentWords },
		language: normalizedLang,
	};
}

/**
 * Persists the search index for `articleId` directly onto the article record.
 */
export async function setArticleSearchIndex(articleId: number, input: SearchIndexInput): Promise<void> {
	const index = computeSearchIndex(input);
	const language = index.language;
	console.info('[setArticleSearchIndex]', { articleId, titleWords: index.wordsByField.title.length, snippetWords: index.wordsByField.snippet.length, siteContentWords: index.wordsByField.siteContent.length, language });

	if (!articleId) {
		throw new Error('Article ID is invalid');
	} else if (typeof articleId !== 'number') {
		throw new Error('Article ID is not a number');
	}

	await db.articles.update(articleId, {
		titleWords: index.wordsByField.title,
		snippetWords: index.wordsByField.snippet,
		siteContentWords: index.wordsByField.siteContent,
		language,
	});

	console.info('[setArticleSearchIndex] done', { articleId });
}

/**
 * Deletes an article and its embedded search index fields.
 */
export async function deleteArticle(articleId: number): Promise<boolean> {
	const article = await db.articles.get(articleId);
	if (!article) return false;
	await db.articles.delete(articleId);
	return true;
}

// ── Word / n-gram data helpers ─────────────────────────────────────────────────

/** Fetch an article's tokenised word lists for each searchable field. */
function getArticleWordLists(article: Article): Record<FieldType, string[]> {
	return {
		[FieldType.title]: article.titleWords ?? [],
		[FieldType.snippet]: article.snippetWords ?? [],
		[FieldType.siteContent]: article.siteContentWords ?? [],
	};
}

// Maximum position considered for scoring position bonus
const MAX_POSITIONS: Record<FieldType, number> = {} as Record<FieldType, number>;

FIELD_TYPES.forEach((fieldType) => {
	MAX_POSITIONS[fieldType] = 0;
});

/**
 * Builds a helper object whose `getOccurrence(fieldType, term)` method returns
 * the first word position in `fieldType` or -1 when absent, while n-gram
 * occurrences are retrieved via `getNgramOccurrence(fieldType, ngram)`.
 *
 * Rather than eagerly loading everything we look up positions on demand
 * from the linker tables; the article-level filter (hasWordLinks / hasNgramLinks)
 * eliminates the vast majority of articles before any per-term position lookup occurs.
 */
// ── User management functions ──────────────────────────────────────────────────

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
export type SortOption = 'pubDateDesc' | 'pubDateAsc' | 'titleAsc' | 'titleDesc' | 'relevance';

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
		case 'relevance':
		default:
			return db.articles.where('[userId+pubDate]').between([userId, Dexie.minKey], [userId, Dexie.maxKey]).reverse().toArray();
	}
}

// Get paginated articles with optional filtering.
// For the unfiltered case (no feedId/folderId/read/starred/searchQuery) the compound index
// [userId+pubDate] / [userId+title] is used for DB-level sorting and pagination,
// which avoids loading the entire article set into memory.
// When a search query is present, results are sorted by relevance score.
// When other filters are present the data is loaded for that user and filtered in JS.
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
		searchQuery?: string;
	} = {}
): Promise<{ articles: Article[]; hasMore: boolean }> {
	const limit = options.limit ?? 25;
	const offset = options.offset ?? 0;
	const sortBy = options.sortBy ?? 'pubDateDesc';

	const hasSearch = !!options.searchQuery?.trim();

	// ── Search path ─────────────────────────────────────────────────────────
	// When a search query is present (regardless of sortBy), use relevance-ranked search.
	if (hasSearch) {
		const searchOptions: SearchOptions = {
			limit,
			offset,
			useNgrams: true,
			language: undefined,
		};
		if (options.feedId !== undefined) searchOptions.feedId = options.feedId;
		if (options.read !== undefined) searchOptions.read = options.read;
		if (options.starred !== undefined) searchOptions.starred = options.starred;
		const results = await searchArticles(userId, options.searchQuery!.trim(), searchOptions);
		return { articles: results.articles, hasMore: results.hasMore };
	}

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
			case 'pubDateAsc': return (a.pubDate || 0) - (b.pubDate || 0);
			case 'titleAsc': return (a.title || '').localeCompare(b.title || '');
			case 'titleDesc': return (b.title || '').localeCompare(a.title || '');
			default: return (b.pubDate || 0) - (a.pubDate || 0);
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

export interface SearchResult {
	articles: Article[];
	hasMore: boolean;
}

/** Maximum candidate pool size during Phase 1 — keeps memory bounded even
 *  if the full-text index is large. */
const SEARCH_CANDIDATE_CAP = 500;

/** Positions 0-based within a field; earlier words get a small bonus via
 *  `positionMult`. Returns a multiplier in [0.8, 1.1]. */
function positionMult(fraction: number): number {
	return 1.1 - 0.3 * fraction; // fraction 0 → 1.1, fraction 1 → 0.8
}

interface ArticleScore { article: Article; score: number }

/** Phase 1 helper – for each search term collect candidate articles from indexed field word arrays. */
async function collectCandidateArticleIds(
	userId: number,
	searchTerms: string[],
	useNgrams: boolean,
	options: SearchOptions,
	candidateCap: number = SEARCH_CANDIDATE_CAP,
): Promise<Set<number>> {
	if (searchTerms.length === 0) return new Set();

	const wordTerms = Array.from(new Set(searchTerms.filter(term => !term.includes(' '))));
	if (wordTerms.length === 0) return new Set();

	const searchableFields = ['titleWords', 'snippetWords', 'siteContentWords'] as const;
	const articleIds = new Set<number>();
	let count = 0;

	for (const term of wordTerms) {
		for (const field of searchableFields) {
			let coll = db.articles.where(field).equals(term).and(a => a.userId === userId);
			if (options.feedId !== undefined) coll = coll.and(a => a.feedId === options.feedId);
			if (options.read !== undefined) coll = coll.and(a => a.read === options.read);
			if (options.starred !== undefined) coll = coll.and(a => a.starred === options.starred);

			const matchedArticles = await coll.toArray();
			for (const article of matchedArticles) {
				if (article.id !== undefined && !articleIds.has(article.id)) {
					articleIds.add(article.id);
					count++;
					if (count >= candidateCap) return articleIds;
				}
			}
		}
	}

	return articleIds;
}

/** Phase 2 helper – score every candidate article against searchTerms. */
async function scoreCandidateArticles(
	articles: Article[],
	searchTerms: string[],
	useNgrams: boolean,
): Promise<ArticleScore[]> {
	const FIELD_WEIGHTS: Record<FieldType, number> = {
		[FieldType.title]: 30,
		[FieldType.snippet]: 10,
		[FieldType.siteContent]: 2,
	};

	function ngramPosMatch(wordsInField: string[], tokens: string[]): number {
		if (!wordsInField.length || tokens.length === 0) return -1;
		for (let i = 0; i <= wordsInField.length - tokens.length; i++) {
			let ok = true;
			for (let j = 0; j < tokens.length; j++) {
				if (wordsInField[i + j] !== tokens[j]) { ok = false; break; }
			}
			if (ok) return i;
		}
		return -1;
	}

	return Promise.all(articles.map(async article => {
		const fieldWordArrays: Record<FieldType, string[]> = {
			[FieldType.title]: article.titleWords ?? [],
			[FieldType.snippet]: article.snippetWords ?? [],
			[FieldType.siteContent]: article.siteContentWords ?? [],
		};

		const wordCounts: Record<FieldType, number> = {
			[FieldType.title]: fieldWordArrays[FieldType.title].length,
			[FieldType.snippet]: fieldWordArrays[FieldType.snippet].length,
			[FieldType.siteContent]: fieldWordArrays[FieldType.siteContent].length,
		};

		let totalUnscaled = 0;
		const bestPerTerm = new Map<string, number>();

		for (const term of searchTerms) {
			const termTokens = term.split(' ').filter(Boolean);
			let best = 0;

			for (const fieldType of FIELD_TYPES) {
				const fw = FIELD_WEIGHTS[fieldType];
				const wordsInField = fieldWordArrays[fieldType];
				const wc = wordCounts[fieldType];
				if (fw <= 0 || wc === 0) continue;

				const exactIdx = termTokens.length === 1
					? wordsInField.indexOf(term)
					: ngramPosMatch(wordsInField, termTokens);
				if (exactIdx >= 0) {
					const raw = fw * positionMult(exactIdx / wc);
					best = Math.max(best, raw);
					continue;
				}

				if (!useNgrams || termTokens.length === 1) continue;

				const ngramIdx = ngramPosMatch(wordsInField, termTokens);
				if (ngramIdx >= 0) {
					const raw = fw * 0.5 * positionMult(ngramIdx / wc);
					best = Math.max(best, raw);
				}
			}

			bestPerTerm.set(term, best);
			totalUnscaled += best;
		}

		if (totalUnscaled === 0) return { article, score: 0 };

		let matchedTerms = 0;
		for (const v of bestPerTerm.values()) if (v > 0) matchedTerms++;

		const extraTerms = Math.min(matchedTerms - 1, 3);
		const termBonus = 1 + extraTerms * 0.15;

		return { article, score: Math.round(totalUnscaled * termBonus) };
	}));
}

export async function searchArticles(
	userId: number,
	query: string,
	options: SearchOptions = {}
): Promise<SearchResult> {
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
		if (options.read !== undefined) coll = coll.and(a => a.read === options.read);
		if (options.starred !== undefined) coll = coll.and(a => a.starred === options.starred);

		const articles = await coll.offset(offset).limit(limit + 1).toArray();
		return { articles: articles.slice(0, limit), hasMore: articles.length > limit };
	}

	const words = segmentWords(query, searchLocale);
	const searchTerms = useNgrams ? [...new Set([...words, ...generateAllNgrams(words, 3)])] : words;

	if (searchTerms.length === 0) {
		return { articles: [], hasMore: false };
	}

	// ── Phase 1: load candidate articles ─────────────────────────────────────
	const allUserArticles = await db.articles.where('userId').equals(userId).toArray();

	let articlePool: Article[];
	if (options.feedId !== undefined || options.read !== undefined || options.starred !== undefined) {
		articlePool = allUserArticles.filter(a => {
			if (options.feedId !== undefined && a.feedId !== options.feedId) return false;
			if (options.read !== undefined && a.read !== options.read) return false;
			if (options.starred !== undefined && a.starred !== options.starred) return false;
			return true;
		});
	} else {
		articlePool = allUserArticles;
	}

	// Use dictionary lookups to find candidate IDs -> filter pool
	const candidateSet = await collectCandidateArticleIds(
		userId,
		searchTerms,
		useNgrams,
		options,
		articlePool.length + 1,  // cap at pool size
	);

	// Intersect with the filtered pool
	const candidates = articlePool.filter(a => a.id !== undefined && candidateSet.has(a.id!));

	// ── Phase 2: score ────────────────────────────────────────────────────────
	const scored = await scoreCandidateArticles(candidates, searchTerms, useNgrams);

	scored.sort((a, b) => b.score - a.score);
	const sorted = scored.map(s => s.article);
	return { articles: sorted.slice(offset, offset + limit), hasMore: offset + limit < sorted.length };
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

	// Count all searchable tokens and phrase n-grams from this user's article fields.
	const articlesForUser = await db.articles.where('userId').equals(userId).toArray();
	const tokenFreq = new Map<string, number>();

	for (const article of articlesForUser) {
		const fields = [
			article.titleWords ?? [],
			article.snippetWords ?? [],
			article.siteContentWords ?? []
		];

		for (const fieldWords of fields) {
			for (const word of fieldWords) {
				tokenFreq.set(word, (tokenFreq.get(word) || 0) + 1);
			}

			for (const ngram of generateAllNgrams(fieldWords, 3)) {
				tokenFreq.set(ngram, (tokenFreq.get(ngram) || 0) + 1);
			}
		}
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
	for (const [token, freq] of tokenFreq) {
		if (token.startsWith(lowerQuery) && token !== lowerQuery) {
			wordMatches.push({ text: token, freq });
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
