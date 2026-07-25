import { describe, expect, it } from 'vitest';
import {
	createRunRequest,
	getRunRequestTransferables,
	isLayoutWorkerRequest,
	isLayoutWorkerResponse,
} from '../../src/layout/workerProtocol';
import { initializeFullLayout } from '../../src/layout/initialization';
import type {
	LayoutFinalDiagnostics,
	LayoutSolverInput,
} from '../../src/layout/layoutTypes';

function diagnostics(): LayoutFinalDiagnostics {
	return {
		operationId: 'op',
		mode: 'initialize',
		phase: 'finalizing',
		iteration: 1,
		maxAngularDisplacement: 0,
		meanVectorNorm: 0,
		covarianceDiagonal: [1 / 3, 1 / 3, 1 / 3],
		evaluatedRepulsionPairs: 1,
		movableNodeCount: 2,
		anchoredNodeCount: 0,
		hardFixedNodeCount: 0,
		cappedNodeCount: 0,
		maxExistingNodeDisplacement: 0,
		elapsedMs: 1,
		converged: true,
		maximumNormError: 0,
		repulsionMode: 'exact',
	};
}

function input(): LayoutSolverInput {
	return {
		operationId: 'op',
		mode: 'initialize',
		graphSignature: 'signature',
		effectiveSeed: 1,
		positions: initializeFullLayout(2, 1),
		edgeEndpoints: new Uint32Array([0, 1]),
		edgeWeights: new Float32Array([1]),
	};
}

describe('layout worker protocol', () => {
	it('creates a typed run request and enumerates transferable buffers', () => {
		const request = createRunRequest(input());
		expect(isLayoutWorkerRequest(request)).toBe(true);
		expect(getRunRequestTransferables(request)).toHaveLength(3);
	});

	it('accepts final-only completed messages', () => {
		const message = {
			type: 'completed',
			operationId: 'op',
			mode: 'initialize',
			graphSignature: 'signature',
			positions: initializeFullLayout(2, 1),
			diagnostics: diagnostics(),
		};
		expect(isLayoutWorkerResponse(message)).toBe(true);
	});

	it('keeps progress diagnostic-only and rejects malformed messages', () => {
		const progress = diagnostics();
		const { converged, maximumNormError, repulsionMode, ...baseProgress } =
			progress;
		expect(converged).toBe(true);
		expect(maximumNormError).toBe(0);
		expect(repulsionMode).toBe('exact');
		const message = {
			type: 'progress',
			operationId: 'op',
			mode: 'initialize',
			graphSignature: 'signature',
			progress: baseProgress,
		};
		expect('positions' in message).toBe(false);
		expect(isLayoutWorkerResponse(message)).toBe(true);
		expect(
			isLayoutWorkerResponse({
				...message,
				progress: { ...baseProgress, meanVectorNorm: Number.NaN },
			}),
		).toBe(false);
	});
});
