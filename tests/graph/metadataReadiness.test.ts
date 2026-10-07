import { describe, expect, it, vi } from 'vitest';
import { waitForGraphMetadata } from '../../src/graph/metadataReadiness';

describe('graph metadata readiness', () => {
	it('waits for link resolution even when the workspace is already open', async () => {
		let resolved: (() => void) | undefined;
		const unsubscribe = vi.fn();
		const completed = vi.fn();
		const waiting = waitForGraphMetadata({ isReady: () => false, onResolved: (callback) => { resolved = callback; return unsubscribe; } }, new AbortController().signal).then(completed);
		await Promise.resolve();
		expect(completed).not.toHaveBeenCalled();
		resolved?.();
		await waiting;
		expect(completed).toHaveBeenCalledOnce();
		expect(unsubscribe).toHaveBeenCalledOnce();
	});

	it('does not wait for another event when all note links are already indexed', async () => {
		const onResolved = vi.fn();
		await waitForGraphMetadata({ isReady: () => true, onResolved }, new AbortController().signal);
		expect(onResolved).not.toHaveBeenCalled();
	});

	it('removes the metadata listener when the runtime is unloaded', async () => {
		const abort = new AbortController();
		const unsubscribe = vi.fn();
		const pending = waitForGraphMetadata({ isReady: () => false, onResolved: () => unsubscribe }, abort.signal);
		const rejected = expect(pending).rejects.toThrow('cancelled');
		abort.abort();
		await rejected;
		expect(unsubscribe).toHaveBeenCalledOnce();
	});
});
