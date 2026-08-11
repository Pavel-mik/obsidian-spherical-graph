export const SYNC_WARNING_BYTES = 3 * 1024 * 1024;
export const SYNC_HARD_LIMIT_BYTES = Math.floor(4.5 * 1024 * 1024);

export class SyncBudgetExceededError extends Error {
	constructor(readonly byteLength: number) {
		super(
			`The saved Spherical Graph layout is ${(byteLength / 1024 / 1024).toFixed(1)} MB and cannot be kept below the 4.5 MB Sync-safe budget.`,
		);
		this.name = 'SyncBudgetExceededError';
	}
}

export interface SyncBudgetResult<T> {
	readonly data: T;
	readonly byteLength: number;
	readonly graphCacheDropped: boolean;
	readonly warning: boolean;
}

export function serializedUtf8Size(value: unknown): number {
	return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

/**
 * Keeps the canonical layout, camera, settings, and pins intact. The graph
 * cache is derived and can be rebuilt from the vault, so it is the only field
 * removed when a single data.json would approach the Standard Sync limit.
 */
export function prepareSyncSafeData<
	T extends Readonly<{ graphCache?: unknown }>,
>(
	data: T,
	warningBytes = SYNC_WARNING_BYTES,
	hardLimitBytes = SYNC_HARD_LIMIT_BYTES,
): SyncBudgetResult<T> {
	let byteLength = serializedUtf8Size(data);
	if (byteLength <= hardLimitBytes) {
		return {
			data,
			byteLength,
			graphCacheDropped: false,
			warning: byteLength >= warningBytes,
		};
	}

	if (data.graphCache !== null && data.graphCache !== undefined) {
		const compacted = { ...data, graphCache: null } as T;
		byteLength = serializedUtf8Size(compacted);
		if (byteLength <= hardLimitBytes) {
			return {
				data: compacted,
				byteLength,
				graphCacheDropped: true,
				warning: byteLength >= warningBytes,
			};
		}
	}

	throw new SyncBudgetExceededError(byteLength);
}
