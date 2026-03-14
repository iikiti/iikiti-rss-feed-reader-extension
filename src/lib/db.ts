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
  parentId?: number; // For subfolders
}

export interface View {
  id?: number;
  name: string;
  filterJson: string; // JSON string of filter criteria
}

export class IikitiDB extends Dexie {
  feeds!: Table<Feed>;
  articles!: Table<Article>;
  folders!: Table<Folder>;
  views!: Table<View>;

  constructor() {
    super('iikiti');
    this.version(1).stores({
      feeds: '++id, &url, folderId',
      articles: '++id, feedId, &guid, pubDate, [read+feedId], starred',
      folders: '++id, &name, parentId'
    });
    this.version(2).stores({
      views: '++id, &name'
    }).upgrade(tx => {
      return tx.table('views').add({ name: 'All Articles', filterJson: '{}' });
    });
  }
}

export const db = new IikitiDB();
