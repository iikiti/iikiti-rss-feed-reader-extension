import { db, type View as ViewData, type ArticleCounts } from '$lib/db';
import { Entity, clearFormError, type FormState } from './Entity';

export interface ViewFilter {
	read: 'all' | 'unread' | 'read';
	starred: 'all' | 'starred';
}

export interface ViewFormState extends FormState {
	name: string;
	filter: ViewFilter;
}

export function createViewFormState(): ViewFormState {
	return {
		name: '',
		filter: { read: 'all', starred: 'all' },
		error: ''
	};
}

export class View extends Entity<ViewData> {
	constructor(data: ViewData) {
		super(data);
	}

	get name(): string {
		return this.data.name;
	}

	get filter(): ViewFilter {
		return JSON.parse(this.data.filterJson);
	}

	get filterJson(): string {
		return this.data.filterJson;
	}

	async save(userId: number, form: ViewFormState, editing: boolean): Promise<boolean> {
		if (!form.name.trim()) {
			form.error = 'Please enter a view name';
			return false;
		}

		const filterJson = JSON.stringify(form.filter);

		if (editing && this.data.id) {
			await this.update({ name: form.name.trim(), filterJson });
			return true;
		} else {
			const addedId = await db.views.add({
				userId,
				name: form.name.trim(),
				filterJson
			});
			this.data.id = addedId as number;
			this.data.name = form.name.trim();
			this.data.filterJson = filterJson;
			return true;
		}
	}

	async update(updates: Partial<Pick<ViewData, 'name' | 'filterJson'>>): Promise<void> {
		if (!this.data.id) return;
		await db.views.update(this.data.id, updates);
		Object.assign(this.data, updates);
	}

	async delete(): Promise<void> {
		if (!this.data.id) return;
		await db.views.delete(this.data.id);
	}
}

export function viewFromData(data: ViewData): View {
	return new View(data);
}

export function viewsFromData(data: ViewData[]): View[] {
	return data.map(d => new View(d));
}