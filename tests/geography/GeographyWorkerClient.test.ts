import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeographyWorkerClient } from '../../src/geography/GeographyWorkerClient';
import type { GeographyWorkerRequest } from '../../src/geography/geography-worker-entry';
import { GraphDataService } from '../../src/graph/GraphDataService';

class FakeWorker {
	static instances: FakeWorker[] = [];
	readonly terminate = vi.fn();
	request?: GeographyWorkerRequest;
	onmessage?: (event: MessageEvent<unknown>) => void;
	constructor() { FakeWorker.instances.push(this); }
	postMessage(request: GeographyWorkerRequest): void { this.request = request; }
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); FakeWorker.instances = []; });

describe('GeographyWorkerClient cancellation', () => {
	it('terminates a cancelled worker, releases its URL, and allows a subsequent build', async () => {
		vi.stubGlobal('Worker', FakeWorker);
		vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:geography');
		const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
		const graph = new GraphDataService({ getMarkdownFiles: () => [], getResolvedLinks: () => ({}) }).buildGraph();
		const client = new GeographyWorkerClient();
		const abort = new AbortController();
		const pending = client.build(graph, [], 1, undefined, undefined, abort.signal);
		const rejected = expect(pending).rejects.toThrow('cancelled');
		abort.abort();
		await rejected;
		expect(FakeWorker.instances[0]?.terminate).toHaveBeenCalledOnce();
		expect(revoke).toHaveBeenCalledOnce();

		const nextAbort = new AbortController();
		const next = client.build(graph, [], 1, undefined, undefined, nextAbort.signal);
		const worker = FakeWorker.instances[1];
		const geography = { version: 1, continents: [], islandNodeIds: [] };
		worker?.onmessage?.({ data: { type: 'completed', requestId: worker.request?.requestId, geography } } as MessageEvent<unknown>);
		await expect(next).resolves.toEqual(geography);
		nextAbort.abort();
		expect(worker?.terminate).toHaveBeenCalledOnce();
		expect(revoke).toHaveBeenCalledTimes(2);
	});
});
