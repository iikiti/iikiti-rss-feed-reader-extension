import { db, type Folder as FolderData, type Feed as FeedData, type ArticleCounts } from '$lib/db';
import { Entity, clearFormError, setFormLoading, type FormState } from './Entity';

export interface FolderFormState extends FormState {
	name: string;
	parentId: number | null;
}

export function createFolderFormState(): FolderFormState {
	return {
		name: '',
		parentId: null,
		error: ''
	};
}

export class Folder extends Entity<FolderData> {
	constructor(data: FolderData) {
		super(data);
	}

	get name(): string {
		return this.data.name;
	}

	get parentId(): number | undefined {
		return this.data.parentId;
	}

	get order(): number | undefined {
		return this.data.order;
	}

	async save(userId: number, form: FolderFormState, editing: boolean): Promise<boolean> {
		if (!form.name.trim()) {
			form.error = 'Please enter a folder name';
			return false;
		}

		const existing = await db.folders
			.where('userId')
			.equals(userId)
			.and(f => f.name === form.name.trim())
			.first();
		
		if (existing && existing.id !== this.data.id) {
			form.error = 'Folder already exists';
			return false;
		}

		if (editing && this.data.id) {
			await this.update({ name: form.name.trim(), parentId: form.parentId || undefined });
			return true;
		} else {
			const addedId = await db.folders.add({
				userId,
				name: form.name.trim(),
				parentId: form.parentId || undefined
			});
			this.data.id = addedId as number;
			return true;
		}
	}

	async update(updates: Partial<Pick<FolderData, 'name' | 'parentId'>>): Promise<void> {
		if (!this.data.id) return;
		await db.folders.update(this.data.id, updates);
		Object.assign(this.data, updates);
	}

	async delete(allFeeds?: FeedData[]): Promise<{ deletedFolderIds: number[]; updatedFeedCount: number }> {
		if (!this.data.id) return { deletedFolderIds: [], updatedFeedCount: 0 };

		const getSubfolders = async (pid: number): Promise<number[]> => {
			const children = await db.folders.where('parentId').equals(pid).toArray();
			let ids: number[] = [];
			for (const c of children) {
				ids.push(c.id!);
				ids = ids.concat(await getSubfolders(c.id!));
			}
			return ids;
		};

		const allIds = [this.data.id, ...await getSubfolders(this.data.id)];
		let updatedFeedCount = 0;

		if (allFeeds) {
			for (const fid of allIds) {
				const fds = allFeeds.filter(f => f.folderId === fid);
				for (const f of fds) {
					await db.feeds.update(f.id!, { folderId: undefined });
					updatedFeedCount++;
				}
			}
		}

		await db.folders.bulkDelete(allIds);
		return { deletedFolderIds: allIds, updatedFeedCount };
	}
}

export function folderFromData(data: FolderData): Folder {
	return new Folder(data);
}

export function foldersFromData(data: FolderData[]): Folder[] {
	return data.map(d => new Folder(d));
}