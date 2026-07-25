import workerSource from 'virtual:spherical-graph-worker';
import { SphericalSolver } from './SphericalSolver';
import {
	createRunRequest,
	getRunRequestTransferables,
	isLayoutWorkerResponse,
	isTerminalLayoutMessage,
	solverInputFromRunRequest,
	type LayoutErrorMessage,
	type LayoutRunRequest,
	type LayoutWorkerRequest,
	type LayoutWorkerResponse,
} from './workerProtocol';
import type { LayoutSolverInput } from './layoutTypes';

export type LayoutExecutionMode = 'worker' | 'fallback';

export interface LayoutRunHandle {
	readonly operationId: string;
	readonly executionMode: LayoutExecutionMode;
	cancel(operationId?: string): void;
	dispose(): void;
}

export type LayoutMessageHandler = (message: LayoutWorkerResponse) => void;

export interface LayoutRunner {
	start(
		request: LayoutRunRequest,
		onMessage: LayoutMessageHandler,
	): LayoutRunHandle;
	cancel(operationId: string): void;
	dispose(): void;
}

/**
 * Adapter-shaped runner for LayoutLifecycleController, whose planner produces
 * a complete solver input rather than a serialized protocol request.
 */
export interface LayoutSolverRunner {
	start(
		input: LayoutSolverInput,
		onMessage: LayoutMessageHandler,
	): LayoutRunHandle;
	cancel(operationId: string): void;
	dispose(): void;
}

interface LayoutWorkerLike {
	onmessage: ((event: MessageEvent<unknown>) => void) | null;
	onerror: ((event: ErrorEvent) => void) | null;
	postMessage(
		message: LayoutWorkerRequest,
		transfer?: Transferable[],
	): void;
	terminate(): void;
}

export interface InlineWorkerEnvironment {
	readonly makeBlob: (
		parts: BlobPart[],
		options: BlobPropertyBag,
	) => Blob;
	readonly createObjectUrl: (blob: Blob) => string;
	readonly revokeObjectUrl: (url: string) => void;
	readonly createWorker: (url: string) => LayoutWorkerLike;
}

function defaultWorkerEnvironment(): InlineWorkerEnvironment {
	return {
		makeBlob: (parts, options) => new Blob(parts, options),
		createObjectUrl: (blob) => URL.createObjectURL(blob),
		revokeObjectUrl: (url) => URL.revokeObjectURL(url),
		createWorker: (url) => new Worker(url),
	};
}

interface ActiveWorkerRun {
	readonly request: LayoutRunRequest;
	readonly expectedPositionLength: number;
	readonly onMessage: LayoutMessageHandler;
	readonly worker: LayoutWorkerLike;
	readonly objectUrl: string;
	closed: boolean;
}

function clientError(
	request: LayoutRunRequest,
	message: string,
): LayoutErrorMessage {
	return {
		type: 'error',
		operationId: request.operationId,
		mode: request.mode,
		graphSignature: request.graphSignature,
		message,
	};
}

export class InlineLayoutWorkerClient implements LayoutRunner {
	private readonly environment: InlineWorkerEnvironment;
	private readonly source: string;
	private active: ActiveWorkerRun | null = null;

	constructor(
		source = workerSource,
		environment: InlineWorkerEnvironment = defaultWorkerEnvironment(),
	) {
		this.source = source;
		this.environment = environment;
	}

	start(
		request: LayoutRunRequest,
		onMessage: LayoutMessageHandler,
	): LayoutRunHandle {
		if (this.active !== null) {
			throw new Error('A layout worker is already active.');
		}
		const blob = this.environment.makeBlob(
			[this.source],
			{ type: 'text/javascript' },
		);
		const objectUrl = this.environment.createObjectUrl(blob);
		let worker: LayoutWorkerLike;
		try {
			worker = this.environment.createWorker(objectUrl);
		} catch (error) {
			this.environment.revokeObjectUrl(objectUrl);
			throw error;
		}
		const active: ActiveWorkerRun = {
			request,
			expectedPositionLength: request.payload.positions.length,
			onMessage,
			worker,
			objectUrl,
			closed: false,
		};
		this.active = active;

		worker.onmessage = (event) => {
			this.handleWorkerMessage(active, event.data);
		};
		worker.onerror = (event) => {
			if (active.closed || this.active !== active) {
				return;
			}
			const message =
				event.message || 'The spherical layout worker crashed.';
			try {
				active.onMessage(clientError(active.request, message));
			} finally {
				this.closeActive(active);
			}
		};

		try {
			worker.postMessage(
				request,
				getRunRequestTransferables(request),
			);
		} catch (error) {
			this.closeActive(active);
			throw error;
		}

		return {
			operationId: request.operationId,
			executionMode: 'worker',
			cancel: (operationId = request.operationId) => {
				if (
					this.active === active &&
					operationId === request.operationId
				) {
					active.worker.postMessage({
						type: 'cancel',
						operationId,
					});
				}
			},
			dispose: () => {
				if (this.active === active) {
					try {
						active.worker.postMessage({ type: 'dispose' });
					} finally {
						this.closeActive(active);
					}
				}
			},
		};
	}

	private handleWorkerMessage(
		active: ActiveWorkerRun,
		value: unknown,
	): void {
		if (active.closed || this.active !== active) {
			return;
		}
		if (!isLayoutWorkerResponse(value)) {
			try {
				active.onMessage(
					clientError(
						active.request,
						'The layout worker returned an invalid message.',
					),
				);
			} finally {
				this.closeActive(active);
			}
			return;
		}
		if (
			value.operationId !== active.request.operationId ||
			value.mode !== active.request.mode ||
			value.graphSignature !== active.request.graphSignature
		) {
			return;
		}
		if (
			value.type === 'completed' &&
			value.positions.length !== active.expectedPositionLength
		) {
			try {
				active.onMessage(
					clientError(
						active.request,
						'The worker returned a position buffer with the wrong length.',
					),
				);
			} finally {
				this.closeActive(active);
			}
			return;
		}

		try {
			active.onMessage(value);
		} finally {
			if (isTerminalLayoutMessage(value)) {
				this.closeActive(active);
			}
		}
	}

	private closeActive(active: ActiveWorkerRun): void {
		if (active.closed) {
			return;
		}
		active.closed = true;
		active.worker.onmessage = null;
		active.worker.onerror = null;
		active.worker.terminate();
		this.environment.revokeObjectUrl(active.objectUrl);
		if (this.active === active) {
			this.active = null;
		}
	}

	cancel(operationId: string): void {
		if (
			this.active !== null &&
			this.active.request.operationId === operationId
		) {
			this.active.worker.postMessage({
				type: 'cancel',
				operationId,
			});
		}
	}

	dispose(): void {
		const active = this.active;
		if (active === null) {
			return;
		}
		try {
			active.worker.postMessage({ type: 'dispose' });
		} finally {
			this.closeActive(active);
		}
	}
}

interface ActiveFallbackRun {
	readonly request: LayoutRunRequest;
	readonly solver: SphericalSolver;
	readonly onMessage: LayoutMessageHandler;
	closed: boolean;
}

export class YieldingLayoutFallbackRunner implements LayoutRunner {
	private active: ActiveFallbackRun | null = null;

	start(
		request: LayoutRunRequest,
		onMessage: LayoutMessageHandler,
	): LayoutRunHandle {
		if (this.active !== null) {
			throw new Error('A fallback layout calculation is already active.');
		}
		const solver = new SphericalSolver(
			solverInputFromRunRequest(request),
		);
		const active: ActiveFallbackRun = {
			request,
			solver,
			onMessage,
			closed: false,
		};
		this.active = active;
		queueMicrotask(() => {
			void this.execute(active);
		});

		return {
			operationId: request.operationId,
			executionMode: 'fallback',
			cancel: (operationId = request.operationId) => {
				if (
					this.active === active &&
					operationId === request.operationId
				) {
					solver.cancel();
				}
			},
			dispose: () => {
				if (this.active === active) {
					solver.cancel();
					active.closed = true;
					this.active = null;
				}
			},
		};
	}

	private async execute(active: ActiveFallbackRun): Promise<void> {
		if (active.closed || this.active !== active) {
			return;
		}
		const { request } = active;
		active.onMessage({
			type: 'started',
			operationId: request.operationId,
			mode: request.mode,
			graphSignature: request.graphSignature,
		});
		try {
			const result = await active.solver.solveAsync({
				onProgress: (progress) => {
					if (!active.closed && this.active === active) {
						active.onMessage({
							type: 'progress',
							operationId: request.operationId,
							mode: request.mode,
							graphSignature: request.graphSignature,
							progress,
						});
					}
				},
			});
			if (active.closed || this.active !== active) {
				return;
			}
			if (result.status === 'completed') {
				active.onMessage({
					type: 'completed',
					operationId: request.operationId,
					mode: request.mode,
					graphSignature: request.graphSignature,
					positions: result.positions,
					diagnostics: result.diagnostics,
				});
			} else {
				active.onMessage({
					type: 'cancelled',
					operationId: request.operationId,
					mode: request.mode,
					graphSignature: request.graphSignature,
					diagnostics: result.diagnostics,
				});
			}
		} catch (error) {
			if (!active.closed && this.active === active) {
				active.onMessage(
					clientError(
						request,
						error instanceof Error
							? error.message
							: 'The compatibility layout calculation failed.',
					),
				);
			}
		} finally {
			active.closed = true;
			if (this.active === active) {
				this.active = null;
			}
		}
	}

	cancel(operationId: string): void {
		if (
			this.active !== null &&
			this.active.request.operationId === operationId
		) {
			this.active.solver.cancel();
		}
	}

	dispose(): void {
		if (this.active !== null) {
			this.active.solver.cancel();
			this.active.closed = true;
			this.active = null;
		}
	}
}

export class ResilientLayoutRunner implements LayoutRunner {
	private readonly workerRunner: InlineLayoutWorkerClient;
	private readonly fallbackRunner: YieldingLayoutFallbackRunner;
	private activeRunner: LayoutRunner | null = null;

	constructor(
		workerRunner = new InlineLayoutWorkerClient(),
		fallbackRunner = new YieldingLayoutFallbackRunner(),
	) {
		this.workerRunner = workerRunner;
		this.fallbackRunner = fallbackRunner;
	}

	start(
		request: LayoutRunRequest,
		onMessage: LayoutMessageHandler,
	): LayoutRunHandle {
		if (this.activeRunner !== null) {
			throw new Error('A layout calculation is already active.');
		}
		try {
			const handle = this.workerRunner.start(
				request,
				this.wrapHandler(this.workerRunner, onMessage),
			);
			this.activeRunner = this.workerRunner;
			return handle;
		} catch {
			const handle = this.fallbackRunner.start(
				request,
				this.wrapHandler(this.fallbackRunner, onMessage),
			);
			this.activeRunner = this.fallbackRunner;
			return handle;
		}
	}

	private wrapHandler(
		runner: LayoutRunner,
		handler: LayoutMessageHandler,
	): LayoutMessageHandler {
		return (message) => {
			try {
				handler(message);
			} finally {
				if (
					this.activeRunner === runner &&
					isTerminalLayoutMessage(message)
				) {
					this.activeRunner = null;
				}
			}
		};
	}

	cancel(operationId: string): void {
		this.activeRunner?.cancel(operationId);
	}

	dispose(): void {
		this.activeRunner?.dispose();
		this.activeRunner = null;
	}
}

export class LayoutSolverRunnerAdapter implements LayoutSolverRunner {
	private readonly runner: LayoutRunner;

	constructor(runner: LayoutRunner = new ResilientLayoutRunner()) {
		this.runner = runner;
	}

	start(
		input: LayoutSolverInput,
		onMessage: LayoutMessageHandler,
	): LayoutRunHandle {
		return this.runner.start(createRunRequest(input), onMessage);
	}

	cancel(operationId: string): void {
		this.runner.cancel(operationId);
	}

	dispose(): void {
		this.runner.dispose();
	}
}
