import Dexie, { type Table } from 'dexie';

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
