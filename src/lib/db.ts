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

/** One row in the shared words dictionary. word is the unique text key. */
export interface Word {
	word: string;
	lang: string;
}

/** One row in the shared n-grams dictionary. ngram is the unique text key. */
export interface Ngram {
	ngram: string;
	lang: string;
}

export enum FieldType {
	title,
	snippet,
	siteContent
}

/** Link row – belongs a single (word, article, field) triple.
 *  The composite partial index `[articleId+fieldType]` makes it O(1)
 *  to retrieve all words belonging to one article for one field. */
export interface ArticleWordLink {
	articleId: number;
	wordId: string;
	fieldType: FieldType;
	offset: number;
}

/** Link row – belongs a single (ngram, article, field) triple.
 * 同一个 k-gram 同一篇文章同一字段只存一条. */
export interface ArticleNgramLink {
	articleId: number;
	ngramId: string;
	fieldType: FieldType;
	offset: number;
}

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
	words!: Table<Word>;
	ngrams!: Table<Ngram>;
	articleWords!: Table<ArticleWordLink>;
	articleNgrams!: Table<ArticleNgramLink>;

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
		this.version(12)
			.stores({
				users: '++id, &name',
				feeds: '++id, userId, &url, folderId, [userId+order]',
				articles: '++id, userId, feedId, &guid, pubDate, [read+feedId], starred, title, [userId+pubDate], [userId+title], language',
				folders: '++id, userId, [userId+name], parentId, [userId+order]',
				views: '++id, userId, &name',
				words: '&word, lang',
				ngrams: '&ngram, lang',
				articleWords: '++id, [articleId+fieldType], [articleId+fieldType+wordId+offset], [wordId]',
				articleNgrams: '++id, [articleId+fieldType], [articleId+fieldType+ngramId+offset], [ngramId]',
			});

		// Hook for when new articles are added to add the search index words/ngrams automatically.
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

/**
 * Deletes all search-index rows (words, ngrams, and their linker entries)
 * belonging to `articleId`. Safe to call on a non-existent article id.
 */
async function deleteArticleSearchIndex(articleId: number): Promise<void> {
	await db.articleWords.where('articleId').equals(articleId).delete();
	await db.articleNgrams.where('articleId').equals(articleId).delete();
}

interface SearchIndexInput {
	title: string;
	snippet: string;
	siteContent?: string;
	language?: string;
}

interface ComputedSearchIndex {
	wordsByField: Record<string, string[]>;
	ngramsByField: Record<string, string[]>;
	language: string;
}

/**
 * Computes the tokenised word lists and n-gram lists for each searchable field.
 * Does **not** touch the database – call `saveArticleSearchIndex` to persist.
 */
function computeSearchIndex(
	{ title, snippet, siteContent, language }: SearchIndexInput
): ComputedSearchIndex {
	const normalizedLang = normalizeLanguage(language);
	const titleWords = segmentWords(title, normalizedLang);
	const snippetWords = segmentWords(snippet, normalizedLang);
	const siteContentWords = siteContent ? segmentWords(siteContent, normalizedLang) : [];

	const titleNgrams = generateAllNgrams(titleWords, 3);
	const snippetNgrams = generateAllNgrams(snippetWords, 3);
	const siteContentNgrams = generateAllNgrams(siteContentWords, 3);

	return {
		wordsByField: { title: titleWords, snippet: snippetWords, siteContent: siteContentWords },
		ngramsByField: { title: titleNgrams, snippet: snippetNgrams, siteContent: siteContentNgrams },
		language: normalizedLang,
	};
}

/**
 * Persists the search index for `articleId` into the normalised dictionary tables.
 * Replaces whatever search index this article previously held.
 */
export async function setArticleSearchIndex(articleId: number, input: SearchIndexInput): Promise<void> {
	const index = computeSearchIndex(input);
	const langs = index.language;
	console.info('[setArticleSearchIndex]', { articleId, titleWords: index.wordsByField.title.length, snippetWords: index.wordsByField.snippet.length, siteContentWords: index.wordsByField.siteContent.length, language: langs });

	if (!articleId) {
		throw new Error('Article ID is invalid');
	} else if (false === (typeof articleId === 'number')) {
		throw new Error('Article ID is not a number');
	}

	// Collect the unique word IDs per field for this article.
	const wordEntries: ArticleWordLink[] = [];
	for (const [fieldType, words] of Object.entries(index.wordsByField) as Array<[string, string[]]>) {
		words.forEach((w, offset) => {
			if (false == (fieldType in FieldType)) {
				throw new Error('Invalid field type enum key ' + fieldType.toString());
			}
			wordEntries.push({
				"articleId": articleId,
				"wordId": w,
				"fieldType": FieldType[fieldType as keyof typeof FieldType],
				"offset": offset
			});
		});
	}

	// Collect the unique ngram IDs per field.
	const ngramEntries: ArticleNgramLink[] = [];
	for (const [fieldType, ngrams] of Object.entries(index.ngramsByField) as Array<[string, string[]]>) {
		ngrams.forEach((n, offset) => {
			if (false == (fieldType in FieldType)) {
				throw new Error('Invalid field type enum key ' + fieldType.toString());
			}
			ngramEntries.push({
				"articleId": articleId,
				"ngramId": n,
				"fieldType": FieldType[fieldType as keyof typeof FieldType],
				"offset": offset
			});
		});
	}

	console.info('[setArticleSearchIndex]', { articleId, wordEntries: wordEntries.length, ngramEntries: ngramEntries.length });

	await db.transaction('rw', [db.words, db.ngrams, db.articleWords, db.articleNgrams], async () => {
		// Replace existing linker rows for this article
		await deleteArticleSearchIndex(articleId);

		// Upsert dictionary entries
		for (const w of new Set(wordEntries.map(e => e.wordId))) {
			await db.words.put({ word: w, lang: langs });
		}
		for (const n of new Set(ngramEntries.map(e => e.ngramId))) {
			await db.ngrams.put({ ngram: n, lang: langs });
		}

		// Insert linker rows
		if (wordEntries.length) await db.articleWords.bulkPut(wordEntries);
		if (ngramEntries.length) await db.articleNgrams.bulkPut(ngramEntries);
	});

	console.info('[setArticleSearchIndex] done', { articleId });
}

/**
 * Deletes *all* link rows for `articleId` and clears back-references from
 * the shared word/ngram dictionaries. Returns true when the article existed.
 */
export async function deleteArticle(articleId: number): Promise<boolean> {
	const article = await db.articles.get(articleId);
	if (!article) return false;

	await db.transaction('rw', [db.articles, db.articleWords, db.articleNgrams, db.words, db.ngrams], async () => {
		await db.articles.delete(articleId);
		await db.articleWords.where('articleId').equals(articleId).delete();
		await db.articleNgrams.where('articleId').equals(articleId).delete();

		// Purge dictionary entries that are no longer referenced by any linker row.
		const liveWordIds = new Set((await db.articleWords.toArray()).map(aw => aw.wordId));
		const liveNgramIds = new Set((await db.articleNgrams.toArray()).map(an => an.ngramId));

		for (const w of await db.words.toArray()) {
			if (!liveWordIds.has(w.word)) await db.words.delete(w.word);
		}
		for (const n of await db.ngrams.toArray()) {
			if (!liveNgramIds.has(n.ngram)) await db.ngrams.delete(n.ngram);
		}
	});
	return true;
}

// ── Word / n-gram data helpers ─────────────────────────────────────────────────

/** Fetch an article's tokenised word lists ordered by field, then reversed. */
async function getArticleWordLists(article: Article): Promise<Record<FieldType, string[]>> {
	const fetchFieldWords = async (fieldType: FieldType): Promise<string[]> => {
		return db.articleWords
			.where('[articleId+fieldType]').equals([article.id!, fieldType])
			.toArray()
			.then(links => links.map(l => l.wordId))
			.then(wordSheets => {
				// words table holds the canonical record for each word; join in bulk.
				if (wordSheets.length === 0) return [];
				return Promise.all(wordSheets.map(w => db.words.get(w).then(r => r?.word ?? w)))
					.then(words => words);
			});
	};
	const typedWordLists: Record<FieldType, string[]> = {} as Record<FieldType, string[]>;
	await Promise.all((Object.values(FieldType) as FieldType[]).map(async (fieldType) => {
		typedWordLists[fieldType] = await fetchFieldWords(fieldType);
	}));
	return typedWordLists;
}

// Maximum position considered for scoring position bonus
const MAX_POSITIONS: Record<FieldType, number> = {} as Record<FieldType, number>;

await Promise.all((Object.values(FieldType) as FieldType[]).map(async (fieldType) => {
	MAX_POSITIONS[fieldType] = 0;
}));

/**
 * Populates MAX_POSITIONS from the article's word lists so positionMult uses
 * per-field word counts rather than the full searchable token length.
 */
async function getArticleWordCounts(article: Article): Promise<Record<FieldType, number>> {
	const lists = await getArticleWordLists(article);
	let typedLengths: Record<FieldType, number> = {} as Record<FieldType, number>;
	(Object.values(FieldType) as FieldType[]).forEach((fieldType) => {
		typedLengths[fieldType] = lists[fieldType].length;
	});
	return typedLengths;
}

/**
 * Builds a helper object whose `getOccurrence(fieldType, term)` method returns
 * the first word position in `fieldType` or -1 when absent, while n-gram
 * occurrences are retrieved via `getNgramOccurrence(fieldType, ngram)`.
 *
 * Rather than eagerly loading everything we look up positions on demand
 * from the linker tables; the article-level filter (hasWordLinks / hasNgramLinks)
 * eliminates the vast majority of articles before any per-term position lookup occurs.
 */
async function getFieldOccurrenceHints(article: Article): Promise<{
	wordSheet: Map<string, FieldType[]>;   // wordId → [fieldType, …]
	ngramSheet: Map<string, FieldType[]>;  // ngramId → [fieldType, …]
	wordPositions: Map<FieldType, Map<string, number>>;   // fieldType#wordId → pos
	ngramPositions: Map<FieldType, Map<string, number>>;  // fieldType#ngramId → pos
}> {
	// Pre-load words per field in order so we can build a wordId → [fieldType] sheet.
	const rawWords = await db.articleWords.where('articleId').equals(article.id!).toArray();
	const rawNgrams = await db.articleNgrams.where('articleId').equals(article.id!).toArray();

	// Build field-type lookup maps: "wordId → set of fieldTypes that contain it"
	const wordFieldMap = new Map<string, Set<FieldType>>();
	for (const w of rawWords) {
		const s = wordFieldMap.get(w.wordId);
		if (s) { s.add(w.fieldType); }
		else { wordFieldMap.set(w.wordId, new Set([w.fieldType])); }
	}
	// Build per-field word arrays (ordered by position, i.e. by DB id)
	const fieldWordArrays = new Map<FieldType, string[]>();
	(Object.values(FieldType) as FieldType[]).forEach((fieldType) => {
		fieldWordArrays.set(fieldType, rawWords.filter(w => w.fieldType === fieldType).map(w => w.wordId));
	});

	// Build position maps: fieldType#wordId → first array index
	const wordPosMap = new Map<FieldType, Map<string, number>>();
	for (const [field, idsInField] of fieldWordArrays) {
		const perField = new Map<string, number>();
		for (let i = 0; i < idsInField.length; i++) {
			if (!perField.has(idsInField[i])) perField.set(idsInField[i], i);
		}
		wordPosMap.set(field, perField);
	}

	// Ngram field-type lookup map
	const ngramFieldMap = new Map<string, FieldType[]>();
	for (const n of rawNgrams) {
		const s = ngramFieldMap.get(n.ngramId);
		if (!s) { continue; }
		s.push(n.fieldType);
		ngramFieldMap.set(n.ngramId, s);
	}

	// Build per-field ngram arrays
	const fieldNgramArrays = new Map<FieldType, string[]>();
	(Object.values(FieldType) as FieldType[]).forEach((fieldType) => {
		fieldNgramArrays.set(fieldType, rawNgrams.filter(n => n.fieldType === fieldType).map(n => n.ngramId));
	});
	// Build position maps for ngrams
	const ngramPosMap = new Map<FieldType, Map<string, number>>();
	for (const [field, ngramsInField] of fieldNgramArrays) {
		const perField = new Map<string, number>();
		for (let i = 0; i < ngramsInField.length; i++) {
			if (!perField.has(ngramsInField[i])) perField.set(ngramsInField[i], i);
		}
		ngramPosMap.set(field, perField);
	}

	const wordSheet = new Map<string, FieldType[]>();
	for (const [wordId, fields] of wordFieldMap) wordSheet.set(wordId, [...fields]);

	const ngramSheet = new Map<string, FieldType[]>();
	for (const [ngramId, fields] of ngramFieldMap) ngramSheet.set(ngramId, [...fields]);

	return { wordSheet, ngramSheet, wordPositions: wordPosMap, ngramPositions: ngramPosMap };
}

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
	// Clean up all related search-index data
	const userArticles = await db.articles.where('userId').equals(userId).toArray();
	for (const a of userArticles) {
		await deleteArticleSearchIndex(a.id!);
	}

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

/** Phase 1 helper – for each search term look up matching word/ngram IDs in
 *  the shared dictionary, then gather all articleIds that have a linker row
 *  for at least one term. */
async function collectCandidateArticleIds(
	userId: number,
	searchTerms: string[],
	useNgrams: boolean,
	options: SearchOptions,
	candidateCap: number = SEARCH_CANDIDATE_CAP,
): Promise<Set<number>> {
	if (searchTerms.length === 0) return new Set();

	// 1. Matching word IDs from the shared dictionary
	const matchedWordIds = (await Promise.all(
		searchTerms.map(term => db.words.get(term).then(w => w?.word))
	)).filter((w): w is string => !!w);

	// 2. Matching ngram IDs from the shared dictionary
	const matchedNgramIds: string[] = [];
	if (useNgrams) {
		const ids = await Promise.all(
			searchTerms.map(term => db.ngrams.get(term).then(n => n?.ngram))
		);
		for (const n of ids) if (n) matchedNgramIds.push(n);
	}

	const articleIds = new Set<number>();
	let count = 0;

	for (const wordId of matchedWordIds) {
		const wordLinks = await db.articleWords
			.where('wordId').equals(wordId)
			.toArray();
		for (const link of wordLinks) {
			if (!articleIds.has(link.articleId)) {
				articleIds.add(link.articleId);
				count++;
			}
		}
		if (count >= candidateCap) return articleIds;
	}

	if (useNgrams) {
		for (const ngramId of matchedNgramIds) {
			const ngramLinks = await db.articleNgrams
				.where('ngramId').equals(ngramId)
				.toArray();
			for (const link of ngramLinks) {
				if (!articleIds.has(link.articleId)) {
					articleIds.add(link.articleId);
					count++;
				}
			}
			if (count >= candidateCap) return articleIds;
		}
	}

	return articleIds;
}

/** Phase 2 helper – score every candidate article against searchTerms.
 *  Resolves wordIds → string tokens from the `words` dictionary on demand
 *  and reads ngram linker rows only when ngram matching is enabled.
 */
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

	/** Resolve wordIds → their plain-text tokens, reading each word dict
	 *  entry as needed but avoiding repeated single-row reads. */
	async function resolveWordIds(articleId: number): Promise<Map<string, string>> {
		const links = await db.articleWords
			.where('articleId').equals(articleId)
			.toArray();
		const dict = new Map<string, string>();
		for (const link of links) dict.set(link.wordId, link.wordId);
		return dict;
	}

	function ngramPosMatch(ngramsInField: string[], ngram: string): number {
		if (!ngramsInField.length) return -1;
		const tokens = ngram.split(' ');
		for (let i = 0; i <= ngramsInField.length - tokens.length; i++) {
			let ok = true;
			for (let j = 0; j < tokens.length; j++) {
				if (ngramsInField[i + j] !== tokens[j]) { ok = false; break; }
			}
			if (ok) return i;
		}
		return -1;
	}

	return Promise.all(articles.map(async article => {
		const wordDict: Map<string, string> = await resolveWordIds(article.id!);
		const wordCounts = await getArticleWordCounts(article);

		let cachedNgramArrays: Record<FieldType, string[]> = {} as Record<FieldType, string[]>;

		(Object.values(FieldType) as FieldType[]).forEach((fieldType) => {
			cachedNgramArrays[fieldType] = [];
		});

		let totalUnscaled = 0;
		const bestPerTerm = new Map<string, number>();

		for (const term of searchTerms) {
			let best = 0;

			await Promise.all((Object.values(FieldType) as FieldType[]).map(async (fieldType) => {
				const fw = FIELD_WEIGHTS[fieldType];
				const wc = wordCounts[fieldType];
				if (fw <= 0 || wc === 0) return;

				const wordsInField = (await db.articleWords
					.where('[articleId+fieldType]')
					.equals([article.id!, fieldType])
					.toArray())
					.map(l => l.wordId);

				// Exact unigram match
				const wordIdx = wordsInField.findIndex(wid => wordDict.get(wid) === term);
				if (wordIdx >= 0) {
					const raw = fw * positionMult(wordIdx / wc);
					best = Math.max(best, raw);
					return;
				}

				// Ngram / partial match
				if (useNgrams) {
					const rawNgrams = await db.articleNgrams
						.where('articleId').equals(article.id!)
						.toArray();
					for (const n of rawNgrams) cachedNgramArrays![n.fieldType].push(n.ngramId);
					const ngIdx = ngramPosMatch(cachedNgramArrays[fieldType], term);
					if (ngIdx >= 0) {
						const raw = fw * 0.5 * positionMult(ngIdx / wc);
						best = Math.max(best, raw);
					}
				}
			}));

			bestPerTerm.set(term, best);
			totalUnscaled += best;
		}

		if (totalUnscaled === 0) return { article, score: 0 };

		let matchedTerms = 0;
		for (const v of bestPerTerm.values()) if (v > 0) matchedTerms++;

		const topScore = Math.max(...bestPerTerm.values());
		const extraTerms = Math.min(matchedTerms - 1, 3);
		const termBonus = 1 + (extraTerms * 0.15);

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
	// Load all words for this user's articles via the linker tables
	const allWordLinks = await db.articleWords.toArray();
	// wordId → frequency
	const wordFreq = new Map<string, number>();
	const addWordId = (wordId: string) => {
		const lw = wordId.toLowerCase();
		wordFreq.set(lw, (wordFreq.get(lw) || 0) + 1);
	};

	// Each word-link row already carries the article id; however we do not have
	// the userId here from the linker alone. Since wordFreq is built from ALL
	// word-links in the DB (IndexedDB is local to the profile, there is a single
	// set of tables), use the article-user mapping to filter.
	const articlesForUser = await db.articles.where('userId').equals(userId).toArray();
	const articleIdsForUser = new Set(articlesForUser.map(a => a.id).filter((id): id is number => id !== undefined));

	for (const link of allWordLinks) {
		if (articleIdsForUser.has(link.articleId)) {
			addWordId(link.wordId);
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
	for (const [wordId, freq] of wordFreq) {
		if (wordId.startsWith(lowerQuery) && wordId !== lowerQuery) {
			wordMatches.push({ text: wordId, freq });
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
