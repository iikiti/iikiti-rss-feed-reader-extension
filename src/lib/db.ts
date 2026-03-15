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
  lastFetched?: number;
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
  read: boolean; // 0 = unread, 1 = read
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
    this.version(7).stores({
      users: '++id, &name',
      feeds: '++id, userId, &url, folderId',
      articles: '++id, userId, feedId, &guid, pubDate, [read+feedId], starred, title',
      folders: '++id, userId, [userId+name], parentId',
      views: '++id, userId, &name'
    }).upgrade(tx => {
      return Promise.resolve();
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
  let users = await db.users.toArray();
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

// Get total article counts for a user (without pagination limits)
export async function getUserArticleCounts(userId: number): Promise<{ total: number; unread: number }> {
  const total = await db.articles.where('userId').equals(userId).count();
  const unread = await db.articles.where('userId').equals(userId).and(a => !a.read).count();
  return { total, unread };
}

// Get article counts for a specific feed
export async function getFeedArticleCounts(userId: number, feedId: number): Promise<{ total: number; unread: number }> {
  const total = await db.articles.where('userId').equals(userId).and(a => a.feedId === feedId).count();
  const unread = await db.articles.where('userId').equals(userId).and(a => a.feedId === feedId && !a.read).count();
  return { total, unread };
}

// Sort options for articles
export type SortOption = 'pubDateDesc' | 'pubDateAsc' | 'titleAsc' | 'titleDesc';

export async function getUserArticlesSorted(userId: number, sortBy: SortOption = 'pubDateDesc'): Promise<Article[]> {
  // Use Table directly to enable orderBy, then filter by userId using .and()
  const table = db.articles;
  let collection: Article[];
  
  switch (sortBy) {
    case 'pubDateDesc':
      collection = await table.orderBy('pubDate').reverse().toArray();
      break;
    case 'pubDateAsc':
      collection = await table.orderBy('pubDate').toArray();
      break;
    case 'titleAsc':
      collection = await table.orderBy('title').toArray();
      break;
    case 'titleDesc':
      collection = await table.orderBy('title').reverse().toArray();
      break;
    default:
      collection = await table.orderBy('pubDate').reverse().toArray();
  }
  
  // Filter by userId after sorting (Dexie doesn't support compound queries well with indexes)
  return collection.filter(article => article.userId === userId);
}

// Get paginated articles with optional filtering
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
  
  // Get all user articles
  let articles = await db.articles.where('userId').equals(userId).toArray();
  
  // Apply filters
  if (options.feedId !== undefined) {
    articles = articles.filter(a => a.feedId === options.feedId);
  }
  if (options.folderId !== undefined) {
    // Get feed IDs in folder
    const feedsInFolder = await db.feeds.where('userId').equals(userId).toArray();
    const folderFeedIds = feedsInFolder.filter(f => f.folderId === options.folderId).map(f => f.id!);
    // Get child folder feed IDs recursively
    const childFolders = await db.folders.where('userId').equals(userId).toArray();
    const getChildFolderIds = (parentId: number): number[] => {
      const childIds = childFolders.filter(f => f.parentId === parentId).map(f => f.id!);
      return [...childIds, ...childIds.flatMap(id => getChildFolderIds(id))];
    };
    const childFolderIds = getChildFolderIds(options.folderId);
    const allFolderFeedIds = [...folderFeedIds, ...feedsInFolder
      .filter(f => childFolderIds.includes(f.folderId!))
      .map(f => f.id!)];
    articles = articles.filter(a => allFolderFeedIds.includes(a.feedId));
  }
  if (options.read !== undefined) {
    articles = articles.filter(a => a.read === options.read);
  }
  if (options.starred !== undefined) {
    articles = articles.filter(a => a.starred === options.starred);
  }
  
  // Sort
  const sortBy = options.sortBy ?? 'pubDateDesc';
  articles.sort((a, b) => {
    switch (sortBy) {
      case 'pubDateDesc':
        return (b.pubDate || 0) - (a.pubDate || 0);
      case 'pubDateAsc':
        return (a.pubDate || 0) - (b.pubDate || 0);
      case 'titleAsc':
        return (a.title || '').localeCompare(b.title || '');
      case 'titleDesc':
        return (b.title || '').localeCompare(a.title || '');
      default:
        return (b.pubDate || 0) - (a.pubDate || 0);
    }
  });
  
  const hasMore = articles.length > offset + limit;
  return {
    articles: articles.slice(offset, offset + limit),
    hasMore
  };
}

// Full-text search function that searches indexed fields
// Segments the search query into words and ngrams and matches against indexed arrays
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
    // If no query, return filtered articles with pagination
    let collection = db.articles.where('userId').equals(userId);
    
    if (options.feedId !== undefined) {
      collection = collection.and(a => a.feedId === options.feedId);
    }
    if (options.read !== undefined) {
      collection = collection.and(a => a.read === options.read);
    }
    if (options.starred !== undefined) {
      collection = collection.and(a => a.starred === options.starred);
    }
    
    // Apply ordering by pubDate descending and pagination
    const articles = await collection.toArray();
    // Sort and paginate in memory (Dexie doesn't support offset well)
    return articles
      .sort((a, b) => (b.pubDate || 0) - (a.pubDate || 0))
      .slice(offset, offset + limit);
  }
  
  // Segment query into words and ngrams
  const words = segmentWords(query);
  const ngrams = generateAllNgrams(words, 3);
  const searchTerms = [...new Set([...words, ...ngrams])]; // Dedupe
  
  if (searchTerms.length === 0) {
    return [];
  }
  
  // Get all user articles and filter in memory
  let articles = await db.articles.where('userId').equals(userId).toArray();
  
  // Apply additional filters
  if (options.feedId !== undefined) {
    articles = articles.filter(a => a.feedId === options.feedId);
  }
  if (options.read !== undefined) {
    articles = articles.filter(a => a.read === options.read);
  }
  if (options.starred !== undefined) {
    articles = articles.filter(a => a.starred === options.starred);
  }
  console.log(searchTerms);
  // Filter by search terms in indexed fields
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
  
  // Sort by pubDate descending and paginate
  return matchingArticles
    .sort((a, b) => (b.pubDate || 0) - (a.pubDate || 0))
    .slice(offset, offset + limit);
}
