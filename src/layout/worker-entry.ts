import { SphericalSolver } from './SphericalSolver';
import {
	isLayoutWorkerRequest,
	solverInputFromRunRequest,
	type LayoutErrorMessage,
	type LayoutRunRequest,
	type LayoutWorkerResponse,
} from './workerProtocol';

declare const self: DedicatedWorkerGlobalScope;

interface ActiveRun {
	readonly request: LayoutRunRequest;
	readonly solver: SphericalSolver;
}

let activeRun: ActiveRun | null = null;

function postResponse(
	message: LayoutWorkerResponse,
	transfer: Transferable[] = [],
): void {
	self.postMessage(message, transfer);
}

function errorMessage(
	request: LayoutRunRequest,
	error: unknown,
): LayoutErrorMessage {
	return {
		type: 'error',
		operationId: request.operationId,
		mode: request.mode,
		graphSignature: request.graphSignature,
		message:
			error instanceof Error
				? error.message
				: 'The spherical layout calculation failed.',
	};
}

async function run(request: LayoutRunRequest): Promise<void> {
	if (activeRun !== null) {
		postResponse({
			...errorMessage(
				request,
				new Error('A layout calculation is already active.'),
			),
		});
		return;
	}

	try {
		const solver = new SphericalSolver(
			solverInputFromRunRequest(request),
		);
		activeRun = { request, solver };
		postResponse({
			type: 'started',
			operationId: request.operationId,
			mode: request.mode,
			graphSignature: request.graphSignature,
		});
		const result = await solver.solveAsync({
			onProgress: (progress) => {
				if (activeRun?.request.operationId !== request.operationId) {
					return;
				}
				postResponse({
					type: 'progress',
					operationId: request.operationId,
					mode: request.mode,
					graphSignature: request.graphSignature,
					progress,
				});
			},
		});
		if (activeRun?.request.operationId !== request.operationId) {
			return;
		}
		if (result.status === 'cancelled') {
			postResponse({
				type: 'cancelled',
				operationId: request.operationId,
				mode: request.mode,
				graphSignature: request.graphSignature,
				diagnostics: result.diagnostics,
			});
		} else {
			const positions = result.positions;
			const territory = result.territory;
			const transfer =
				[
					...(positions.buffer instanceof ArrayBuffer ? [positions.buffer] : []),
					...(territory?.ownerByCell.buffer instanceof ArrayBuffer
						? [territory.ownerByCell.buffer]
						: []),
				];
			postResponse(
				{
					type: 'completed',
					operationId: request.operationId,
					mode: request.mode,
					graphSignature: request.graphSignature,
					positions,
					diagnostics: result.diagnostics,
					...(territory === undefined ? {} : { territory }),
				},
				transfer,
			);
		}
	} catch (error) {
		postResponse(errorMessage(request, error));
	} finally {
		activeRun = null;
		self.close();
	}
}

self.addEventListener('message', (event: MessageEvent<unknown>) => {
	const message = event.data;
	if (!isLayoutWorkerRequest(message)) {
		return;
	}
	if (message.type === 'dispose') {
		activeRun?.solver.cancel();
		activeRun = null;
		self.close();
		return;
	}
	if (message.type === 'cancel') {
		if (activeRun?.request.operationId === message.operationId) {
			activeRun.solver.cancel();
		}
		return;
	}
	void run(message);
});
