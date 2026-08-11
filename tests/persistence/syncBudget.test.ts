import { describe, expect, it } from 'vitest';
import {
	SyncBudgetExceededError,
	prepareSyncSafeData,
	serializedUtf8Size,
} from '../../src/persistence/syncBudget';

describe('Sync persistence budget', () => {
	it('measures UTF-8 bytes instead of JavaScript string length', () => {
		expect(serializedUtf8Size({ label: 'město' })).toBeGreaterThan(
			JSON.stringify({ label: 'město' }).length,
		);
	});

	it('drops only the derived graph cache when that preserves the budget', () => {
		const result = prepareSyncSafeData(
			{
				committedLayout: { positions: 'canonical' },
				graphCache: { payload: 'x'.repeat(200) },
			},
			60,
			100,
		);
		expect(result.graphCacheDropped).toBe(true);
		expect(result.data.graphCache).toBeNull();
		expect(result.data.committedLayout).toEqual({ positions: 'canonical' });
	});

	it('rejects a canonical layout that alone exceeds the hard limit', () => {
		expect(() =>
			prepareSyncSafeData(
				{ committedLayout: 'x'.repeat(200), graphCache: null },
				60,
				100,
			),
		).toThrow(SyncBudgetExceededError);
	});
});
