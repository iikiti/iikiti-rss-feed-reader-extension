import { type ArticleCounts } from '$lib/db';

export interface EntityData {
	id?: number;
	userId: number;
}

export abstract class Entity<T extends EntityData> {
	protected data: T;
	protected _counts: ArticleCounts = { total: 0, unread: 0 };

	constructor(data: T) {
		this.data = data;
	}

	get id(): number | undefined {
		return this.data.id;
	}

	get counts(): ArticleCounts {
		return this._counts;
	}

	setCounts(counts: ArticleCounts): void {
		this._counts = counts;
	}

	abstract save(userId: number, form: any, editing: boolean): Promise<boolean>;
	abstract update(updates: Partial<T>): Promise<void>;
	abstract delete(): Promise<void | any>;
}

export interface FormState {
	error: string;
	loading?: boolean;
}

export function setFormError(form: FormState, error: string): void {
	form.error = error;
}

export function setFormLoading(form: FormState, loading: boolean): void {
	form.loading = loading;
}

export function clearFormError(form: FormState): void {
	form.error = '';
}