import Dexie, { type Table } from 'dexie';

export interface Feed {
  id?: number;
  url: string;
  title: string;
  folderId?: number;
  lastFetched?: number;
  error?: string;
  favicon?: string;
}

export interface Article {
  id?: number;
  feedId: number;
  guid: string;
  title: string;
  link: string;
  content: string;
  snippet: string;
  pubDate: number;
  read: boolean; // 0 = unread, 1 = read
  starred: boolean;
  author?: string;
}

export interface Folder {
  id?: number;
  name: string;
}

export class IikitiDB extends Dexie {
  feeds!: Table<Feed>;
  articles!: Table<Article>;
  folders!: Table<Folder>;

  constructor() {
    super('iikiti');
    this.version(1).stores({
      feeds: '++id, &url, folderId',
      articles: '++id, feedId, &guid, pubDate, [read+feedId], starred',
      folders: '++id, &name'
    });
  }
}

export const db = new IikitiDB();
