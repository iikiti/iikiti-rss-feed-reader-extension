import { Temporal } from '@js-temporal/polyfill';

declare global {
	interface Date {
		/** Converts a legacy Date to a Temporal.Instant */
		toTemporalInstant(): Temporal.Instant;
	}
}
