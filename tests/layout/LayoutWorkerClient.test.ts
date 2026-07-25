import { describe, expect, it, vi } from 'vitest';
import { initializeFullLayout } from '../../src/layout/initialization';
import {
	InlineLayoutWorkerClient,
	type InlineWorkerEnvironment,
} from '../../src/layout/LayoutWorkerClient';
import type {
	LayoutFinalDiagnostics,
	LayoutProgress,
} from '../../src/layout/layoutTypes';
import {
	createRunRequest,
	type LayoutWorkerRequest,
	type LayoutWorkerResponse,
} from '../../src/layout/workerProtocol';

class FakeWorker {
	onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	readonly posted: Array<{
		readonly message: LayoutWorkerRequest;
		readonly transfer: readonly Transferable[];
	}> = [];
	terminated = 0;

	postMessage(
		message: LayoutWorkerRequest,
		transfer: Transferable[] = [],
	): void {
		this.posted.push({ message, transfer });
	}

	terminate(): void {
		this.terminated += 1;
	}

	emit(data: unknown): void {
		this.onmessage?.({ data } as MessageEvent<unknown>);
	}
}

function progress(): LayoutProgress {
	return {
		operationId: 'operation',
		mode: 'initialize',
		phase: 'initial',
		iteration: 4,
		maxAngularDisplacement: 0.01,
		meanVectorNorm: 0,
		covarianceDiagonal: [1 / 3, 1 / 3, 1 / 3],
		evaluatedRepulsionPairs: 4,
		movableNodeCount: 2,
		anchoredNodeCount: 0,
		hardFixedNodeCount: 0,
		cappedNodeCount: 0,
		maxExistingNodeDisplacement: 0,
		elapsedMs: 200,
	};
}

function diagnostics(): LayoutFinalDiagnostics {
	return {
		...progress(),
		phase: 'finalizing',
		converged: true,
		maximumNormError: 0,
		repulsionMode: 'exact',
	};
}

function setup(): {
	readonly worker: FakeWorker;
	readonly client: InlineLayoutWorkerClient;
	readonly revokeObjectUrl: ReturnType<typeof vi.fn>;
} {
	const worker = new FakeWorker();
	const revokeObjectUrl = vi.fn();
	const environment: InlineWorkerEnvironment = {
		makeBlob: (parts, options) => new Blob(parts, options),
		createObjectUrl: () => 'blob:test-worker',
		revokeObjectUrl,
		createWorker: () => worker,
	};
	return {
		worker,
		client: new InlineLayoutWorkerClient('worker source', environment),
		revokeObjectUrl,
	};
}

function request() {
	return createRunRequest({
		operationId: 'operation',
		mode: 'initialize',
		graphSignature: 'signature',
		effectiveSeed: 7,
		positions: initializeFullLayout(2, 7),
		edgeEndpoints: new Uint32Array([0, 1]),
		edgeWeights: new Float32Array([1]),
	});
}

describe('InlineLayoutWorkerClient', () => {
	it('transfers input, ignores stale messages, and exposes positions only once', () => {
		const { worker, client, revokeObjectUrl } = setup();
		const messages: LayoutWorkerResponse[] = [];
		client.start(request(), (message) => messages.push(message));
		expect(worker.posted).toHaveLength(1);
		expect(worker.posted[0]?.message.type).toBe('run');
		expect(worker.posted[0]?.transfer).toHaveLength(3);

		worker.emit({
			type: 'completed',
			operationId: 'stale',
			mode: 'initialize',
			graphSignature: 'signature',
			positions: initializeFullLayout(2, 7),
			diagnostics: diagnostics(),
		});
		expect(messages).toHaveLength(0);
		expect(worker.terminated).toBe(0);

		worker.emit({
			type: 'progress',
			operationId: 'operation',
			mode: 'initialize',
			graphSignature: 'signature',
			progress: progress(),
		});
		expect(messages).toHaveLength(1);
		expect('positions' in (messages[0] ?? {})).toBe(false);

		worker.emit({
			type: 'completed',
			operationId: 'operation',
			mode: 'initialize',
			graphSignature: 'signature',
			positions: initializeFullLayout(2, 7),
			diagnostics: diagnostics(),
		});
		expect(messages.map((message) => message.type)).toEqual([
			'progress',
			'completed',
		]);
		expect(
			messages.filter((message) => 'positions' in message),
		).toHaveLength(1);
		expect(worker.terminated).toBe(1);
		expect(revokeObjectUrl).toHaveBeenCalledOnce();
		expect(revokeObjectUrl).toHaveBeenCalledWith('blob:test-worker');

		worker.emit({
			type: 'completed',
			operationId: 'operation',
			mode: 'initialize',
			graphSignature: 'signature',
			positions: initializeFullLayout(2, 7),
			diagnostics: diagnostics(),
		});
		expect(messages).toHaveLength(2);
	});

	it('turns an invalid final buffer into an error and cleans up', () => {
		const { worker, client, revokeObjectUrl } = setup();
		const messages: LayoutWorkerResponse[] = [];
		client.start(request(), (message) => messages.push(message));
		worker.emit({
			type: 'completed',
			operationId: 'operation',
			mode: 'initialize',
			graphSignature: 'signature',
			positions: initializeFullLayout(1, 7),
			diagnostics: diagnostics(),
		});
		expect(messages).toHaveLength(1);
		expect(messages[0]?.type).toBe('error');
		expect(worker.terminated).toBe(1);
		expect(revokeObjectUrl).toHaveBeenCalledOnce();
	});

	it('sends cancel/dispose and releases worker resources idempotently', () => {
		const { worker, client, revokeObjectUrl } = setup();
		const handle = client.start(request(), () => undefined);
		handle.cancel();
		expect(worker.posted[1]?.message).toEqual({
			type: 'cancel',
			operationId: 'operation',
		});
		handle.dispose();
		expect(worker.posted[2]?.message).toEqual({ type: 'dispose' });
		expect(worker.terminated).toBe(1);
		expect(revokeObjectUrl).toHaveBeenCalledOnce();
		handle.dispose();
		client.dispose();
		expect(worker.terminated).toBe(1);
		expect(revokeObjectUrl).toHaveBeenCalledOnce();
	});
});
