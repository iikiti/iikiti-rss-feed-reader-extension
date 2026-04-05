import Dexie, { type Table } from 'dexie';

// Import text segmenter for search
import { segmentWords, generateAllNgrams } from './text-segmenter';

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
}

export interface Article {
	id?: number;
	userId: number;
	feedId: number;
	guid: string;
	title: string;
	link: string;
	content: string;
	siteContent?: string; // Content fetched from the actual article page
	snippet: string;
	pubDate: number;
	read: boolean;
	starred: boolean;
	author?: string;
	image?: string;
	// Full-text search index fields
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
	parentId?: number; // For subfolders
	order?: number;
}

export interface View {
	id?: number;
	userId: number;
	name: string;
	filterJson: string; // JSON string of filter criteria
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
		//             per-user sorted pagination without loading all rows into memory
		this.version(9).stores({
			users: '++id, &name',
			feeds: '++id, userId, &url, folderId, [userId+order]',
			articles: '++id, userId, feedId, &guid, pubDate, [read+feedId], starred, title, [userId+pubDate], [userId+title]',
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

// Full-text search function that searches indexed fields.
// Segments the query into words and n-grams and matches against indexed arrays.
export async function searchArticles(
	userId: number,
	query: string,
	options: {
		feedId?: number;
		read?: boolean;
		starred?: boolean;
		limit?: number;
		offset?: number;
	} = {}
): Promise<Article[]> {
	const limit = options.limit ?? 25;
	const offset = options.offset ?? 0;

	if (!query || !query.trim()) {
		// No query — use compound index for sorted, paginated results
		let coll = db.articles
			.where('[userId+pubDate]')
			.between([userId, Dexie.minKey], [userId, Dexie.maxKey])
			.reverse();

		if (options.feedId !== undefined) coll = coll.and(a => a.feedId === options.feedId);
		if (options.read !== undefined)   coll = coll.and(a => a.read === options.read);
		if (options.starred !== undefined) coll = coll.and(a => a.starred === options.starred);

		return coll.offset(offset).limit(limit).toArray();
	}

	// Segment query into words and n-grams
	const words = segmentWords(query);
	const ngrams = generateAllNgrams(words, 3);
	const searchTerms = [...new Set([...words, ...ngrams])]; // dedupe

	if (searchTerms.length === 0) {
		return [];
	}

	// Load all user articles and filter by search terms in memory (FTS requires a full scan)
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
			...(article.siteContentWords || []),
			...(article.titleNgrams || []),
			...(article.snippetNgrams || []),
			...(article.siteContentNgrams || [])
		];
		return searchTerms.some(term =>
			searchableFields.some(field => field.includes(term))
		);
	});

	return matchingArticles
		.sort((a, b) => (b.pubDate || 0) - (a.pubDate || 0))
		.slice(offset, offset + limit);
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
