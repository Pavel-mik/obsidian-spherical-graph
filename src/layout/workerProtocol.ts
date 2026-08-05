import type {
	LayoutFinalDiagnostics,
	LayoutOperationMode,
	LayoutProgress,
	LayoutSolverInput,
} from './layoutTypes';

export type LayoutRunPayload = Omit<
	LayoutSolverInput,
	| 'operationId'
	| 'mode'
	| 'graphSignature'
	| 'effectiveSeed'
>;

export interface LayoutRunRequest {
	readonly type: 'run';
	readonly operationId: string;
	readonly mode: LayoutOperationMode;
	readonly graphSignature: string;
	readonly effectiveSeed: number;
	readonly payload: LayoutRunPayload;
}

export interface LayoutCancelRequest {
	readonly type: 'cancel';
	readonly operationId: string;
}

export interface LayoutDisposeRequest {
	readonly type: 'dispose';
}

export type LayoutWorkerRequest =
	| LayoutRunRequest
	| LayoutCancelRequest
	| LayoutDisposeRequest;

interface LayoutMessageIdentity {
	readonly operationId: string;
	readonly mode: LayoutOperationMode;
	readonly graphSignature: string;
}

export interface LayoutStartedMessage extends LayoutMessageIdentity {
	readonly type: 'started';
}

export interface LayoutProgressMessage extends LayoutMessageIdentity {
	readonly type: 'progress';
	readonly progress: LayoutProgress;
}

export interface LayoutCompletedMessage extends LayoutMessageIdentity {
	readonly type: 'completed';
	readonly positions: Float32Array;
	readonly diagnostics: LayoutFinalDiagnostics;
	readonly territory?: LayoutSolverInput['territory'];
}

export interface LayoutCancelledMessage extends LayoutMessageIdentity {
	readonly type: 'cancelled';
	readonly diagnostics: LayoutFinalDiagnostics;
}

export interface LayoutErrorMessage extends LayoutMessageIdentity {
	readonly type: 'error';
	readonly message: string;
}

export type LayoutWorkerResponse =
	| LayoutStartedMessage
	| LayoutProgressMessage
	| LayoutCompletedMessage
	| LayoutCancelledMessage
	| LayoutErrorMessage;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function isMode(value: unknown): value is LayoutOperationMode {
	return (
		value === 'initialize' ||
		value === 'refresh' ||
		value === 'renew'
	);
}

function hasIdentity(
	value: Record<string, unknown>,
): value is Record<string, unknown> & LayoutMessageIdentity {
	return (
		typeof value.operationId === 'string' &&
		value.operationId.length > 0 &&
		isMode(value.mode) &&
		typeof value.graphSignature === 'string'
	);
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

export function isLayoutProgress(value: unknown): value is LayoutProgress {
	if (!isRecord(value)) {
		return false;
	}
	const covariance = value.covarianceDiagonal;
	return (
		typeof value.operationId === 'string' &&
		isMode(value.mode) &&
		(value.phase === 'initial' ||
			value.phase === 'new-node-warmup' ||
			value.phase === 'anchored-relaxation' ||
			value.phase === 'finalizing') &&
		isFiniteNumber(value.iteration) &&
		isFiniteNumber(value.maxAngularDisplacement) &&
		isFiniteNumber(value.meanVectorNorm) &&
		Array.isArray(covariance) &&
		covariance.length === 3 &&
		covariance.every(isFiniteNumber) &&
		isFiniteNumber(value.evaluatedRepulsionPairs) &&
		isFiniteNumber(value.movableNodeCount) &&
		isFiniteNumber(value.anchoredNodeCount) &&
		isFiniteNumber(value.hardFixedNodeCount) &&
		isFiniteNumber(value.cappedNodeCount) &&
		isFiniteNumber(value.maxExistingNodeDisplacement) &&
		isFiniteNumber(value.elapsedMs)
	);
}

export function isLayoutFinalDiagnostics(
	value: unknown,
): value is LayoutFinalDiagnostics {
	if (!isRecord(value) || !isLayoutProgress(value)) {
		return false;
	}
	const converged = value['converged'];
	const maximumNormError = value['maximumNormError'];
	const repulsionMode = value['repulsionMode'];
	const collisionPasses = value['collisionPasses'];
	const collisionRemainingOverlapCount =
		value['collisionRemainingOverlapCount'];
	const collisionMaximumPenetration =
		value['collisionMaximumPenetration'];
	return (
		typeof converged === 'boolean' &&
		isFiniteNumber(maximumNormError) &&
		(repulsionMode === 'exact' || repulsionMode === 'sampled') &&
		(collisionPasses === undefined ||
			isFiniteNumber(collisionPasses)) &&
		(collisionRemainingOverlapCount === undefined ||
			isFiniteNumber(collisionRemainingOverlapCount)) &&
		(collisionMaximumPenetration === undefined ||
			isFiniteNumber(collisionMaximumPenetration))
	);
}

function isRefreshPayload(value: unknown): boolean {
	if (!isRecord(value)) {
		return false;
	}
	return (
		value.existingNodeMask instanceof Uint8Array &&
		value.newNodeMask instanceof Uint8Array &&
		value.relaxationMovableMask instanceof Uint8Array &&
		value.anchorPositions instanceof Float32Array &&
		value.anchorStrengths instanceof Float32Array &&
		value.maxAnchorDistances instanceof Float32Array &&
		(value.alignToAnchors === undefined ||
			typeof value.alignToAnchors === 'boolean')
	);
}

function isRunPayload(value: unknown): value is LayoutRunPayload {
	if (!isRecord(value)) {
		return false;
	}
	return (
		value.positions instanceof Float32Array &&
		value.edgeEndpoints instanceof Uint32Array &&
		value.edgeWeights instanceof Float32Array &&
		(value.edgeTargetAngles === undefined ||
			value.edgeTargetAngles instanceof Float32Array) &&
		(value.folderIndexByNode === undefined ||
			value.folderIndexByNode instanceof Int32Array) &&
		(value.regionIndexByNode === undefined ||
			value.regionIndexByNode instanceof Int32Array) &&
		(value.collisionAngularRadii === undefined ||
			value.collisionAngularRadii instanceof Float32Array) &&
		(value.coastalPortScores === undefined ||
			value.coastalPortScores instanceof Float32Array) &&
		(value.coastalPortDirections === undefined ||
			value.coastalPortDirections instanceof Float32Array) &&
		(value.territory === undefined ||
			(isRecord(value.territory) &&
				Number.isSafeInteger(value.territory.subdivision) &&
				Array.isArray(value.territory.folderKeys) &&
				value.territory.folderKeys.every((key) => typeof key === 'string') &&
				value.territory.ownerByCell instanceof Int32Array)) &&
		(value.movableMask === undefined ||
			value.movableMask instanceof Uint8Array) &&
		(value.refresh === undefined || isRefreshPayload(value.refresh)) &&
		value.geography === undefined &&
		(value.settings === undefined || isRecord(value.settings))
	);
}

export function isLayoutWorkerRequest(
	value: unknown,
): value is LayoutWorkerRequest {
	if (!isRecord(value) || typeof value.type !== 'string') {
		return false;
	}
	if (value.type === 'dispose') {
		return true;
	}
	if (value.type === 'cancel') {
		return (
			typeof value.operationId === 'string' &&
			value.operationId.length > 0
		);
	}
	return (
		value.type === 'run' &&
		typeof value.operationId === 'string' &&
		value.operationId.length > 0 &&
		isMode(value.mode) &&
		typeof value.graphSignature === 'string' &&
		isFiniteNumber(value.effectiveSeed) &&
		isRunPayload(value.payload)
	);
}

export function isLayoutWorkerResponse(
	value: unknown,
): value is LayoutWorkerResponse {
	if (!isRecord(value) || !hasIdentity(value)) {
		return false;
	}
	switch (value.type) {
		case 'started':
			return true;
		case 'progress':
			return (
				isLayoutProgress(value.progress) &&
				value.progress.operationId === value.operationId &&
				value.progress.mode === value.mode
			);
		case 'completed':
			return (
				value.positions instanceof Float32Array &&
				isLayoutFinalDiagnostics(value.diagnostics) &&
				(value.territory === undefined ||
					(isRecord(value.territory) &&
						Number.isSafeInteger(value.territory.subdivision) &&
						Array.isArray(value.territory.folderKeys) &&
						value.territory.folderKeys.every((key) => typeof key === 'string') &&
						value.territory.ownerByCell instanceof Int32Array))
			);
		case 'cancelled':
			return isLayoutFinalDiagnostics(value.diagnostics);
		case 'error':
			return typeof value.message === 'string';
		default:
			return false;
	}
}

export function createRunRequest(
	input: LayoutSolverInput,
): LayoutRunRequest {
	const {
		operationId,
		mode,
		graphSignature,
		effectiveSeed,
		...payload
	} = input;
	return {
		type: 'run',
		operationId,
		mode,
		graphSignature,
		effectiveSeed,
		payload,
	};
}

export function solverInputFromRunRequest(
	request: LayoutRunRequest,
): LayoutSolverInput {
	return {
		operationId: request.operationId,
		mode: request.mode,
		graphSignature: request.graphSignature,
		effectiveSeed: request.effectiveSeed,
		...request.payload,
	};
}

export function getRunRequestTransferables(
	request: LayoutRunRequest,
): Transferable[] {
	const buffers = new Set<ArrayBuffer>();
	const add = (view: ArrayBufferView | undefined): void => {
		if (view?.buffer instanceof ArrayBuffer) {
			buffers.add(view.buffer);
		}
	};
	add(request.payload.positions);
	add(request.payload.edgeEndpoints);
	add(request.payload.edgeWeights);
	add(request.payload.edgeTargetAngles);
	add(request.payload.folderIndexByNode);
	add(request.payload.regionIndexByNode);
	add(request.payload.collisionAngularRadii);
	add(request.payload.coastalPortScores);
	add(request.payload.coastalPortDirections);
	add(request.payload.territory?.ownerByCell);
	add(request.payload.movableMask);
	if (request.payload.refresh !== undefined) {
		add(request.payload.refresh.existingNodeMask);
		add(request.payload.refresh.newNodeMask);
		add(request.payload.refresh.relaxationMovableMask);
		add(request.payload.refresh.anchorPositions);
		add(request.payload.refresh.anchorStrengths);
		add(request.payload.refresh.maxAnchorDistances);
	}
	return [...buffers];
}

export function isTerminalLayoutMessage(
	message: LayoutWorkerResponse,
): boolean {
	return (
		message.type === 'completed' ||
		message.type === 'cancelled' ||
		message.type === 'error'
	);
}
