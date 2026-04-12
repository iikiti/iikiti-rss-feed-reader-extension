import { db, type Feed as FeedType, type ArticleCounts } from '$lib/db';
import { Entity, clearFormError, setFormLoading, type FormState } from './Entity';

export interface FeedFormState extends FormState {
	url: string;
	title: string;
	folderId: number | null;
}

export function createFeedFormState(): FeedFormState {
	return {
		url: '',
		title: '',
		folderId: null,
		error: '',
		loading: false
	};
}

export class Feed extends Entity<FeedType> {
	constructor(data: FeedType) {
		super(data);
	}

	get title(): string {
		return this.data.title;
	}

	get url(): string {
		return this.data.url;
	}

	get folderId(): number | undefined {
		return this.data.folderId;
	}

	get order(): number | undefined {
		return this.data.order;
	}

	async save(userId: number, form: FeedFormState, editing: boolean): Promise<boolean> {
		if (!form.url.trim()) {
			form.error = 'Please enter a feed URL';
			return false;
		}
		
		try {
			const parsed = new URL(form.url);
			if (!['http:', 'https:'].includes(parsed.protocol)) {
				form.error = 'Feed URL must use http or https';
				return false;
			}
		} catch {
			form.error = 'Invalid URL format';
			return false;
		}

		setFormLoading(form, true);
		clearFormError(form);

		try {
			if (editing && this.data.id) {
				await this.update({ title: form.title, url: form.url, folderId: form.folderId || undefined });
				return true;
			} else {
				const existing = await db.feeds.where('url').equals(form.url).first();
				if (existing) {
					form.error = 'This feed already exists';
					return false;
				}
				
				const addedId = await db.feeds.add({
					userId,
					url: form.url,
					title: form.title,
					folderId: form.folderId || undefined
				});
				
				this.data.id = addedId as number;
				return true;
			}
		} catch (err: any) {
			form.error = err.message || 'Failed to save feed';
			return false;
		} finally {
			setFormLoading(form, false);
		}
	}

	async update(updates: Partial<Pick<FeedType, 'title' | 'url' | 'folderId'>>): Promise<void> {
		if (!this.data.id) return;
		await db.feeds.update(this.data.id, updates);
		Object.assign(this.data, updates);
	}

	async delete(): Promise<void> {
		if (!this.data.id) return;
		await db.feeds.delete(this.data.id);
		await db.articles.where('feedId').equals(this.data.id).delete();
	}
}

export function feedFromData(data: FeedType): Feed {
	return new Feed(data);
}

export function feedsFromData(data: FeedType[]): Feed[] {
	return data.map(d => new Feed(d));
}