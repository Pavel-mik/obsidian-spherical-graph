import {
	diffGraphDescriptors,
	GraphDiff,
	GraphDiffSummary,
	GraphRenameHint,
} from "../graph/graphDiff";
import { GraphData } from "../graph/graphTypes";
import {
	CommitCompletedResultInput,
} from "../persistence/PluginDataStore";
import {
	CURRENT_ALGORITHM_VERSION,
	PersistedLayoutSnapshot,
	deriveEffectiveSeed,
	isSnapshotUsable,
	validateCompletedPositions,
} from "../persistence/layoutState";
import {
	LayoutOperationMode,
	LayoutProgress,
	LayoutSolverInput,
} from "./layoutTypes";
import {
	isLayoutWorkerResponse,
	type LayoutCancelledMessage as WorkerLayoutCancelledMessage,
	type LayoutCompletedMessage as WorkerLayoutCompletedMessage,
	type LayoutErrorMessage as WorkerLayoutErrorMessage,
	type LayoutProgressMessage as WorkerLayoutProgressMessage,
	type LayoutStartedMessage as WorkerLayoutStartedMessage,
	type LayoutWorkerResponse,
} from "./workerProtocol";

export type LayoutLifecycleState =
	| { readonly kind: "no-layout" }
	| { readonly kind: "initializing"; readonly operationId: string }
	| {
			readonly kind: "fixed-clean";
			readonly snapshotId: string;
		}
	| {
			readonly kind: "fixed-dirty";
			readonly snapshotId: string;
			readonly diff: GraphDiffSummary;
		}
	| {
			readonly kind: "refreshing";
			readonly operationId: string;
			readonly snapshotId: string;
		}
	| {
			readonly kind: "renewing";
			readonly operationId: string;
			readonly snapshotId?: string;
		}
	| {
			readonly kind: "error";
			readonly previousSnapshotId?: string;
			readonly message: string;
		};

export type LayoutOperationPayload = Omit<
	LayoutSolverInput,
	"operationId" | "mode" | "graphSignature" | "effectiveSeed"
>;

export interface LayoutPlanContext {
	readonly operationId: string;
	readonly mode: LayoutOperationMode;
	readonly graph: GraphData;
	readonly committedSnapshot?: PersistedLayoutSnapshot;
	readonly diff?: GraphDiff;
	readonly effectiveSeed: number;
}

export interface LayoutOperationPlanner {
	createPayload(context: LayoutPlanContext): LayoutOperationPayload;
}

export type LayoutStartedMessage = WorkerLayoutStartedMessage;
export type LayoutProgressMessage = WorkerLayoutProgressMessage;
export type LayoutCompletedMessage = WorkerLayoutCompletedMessage;
export type LayoutCancelledMessage = WorkerLayoutCancelledMessage;
export type LayoutErrorMessage = WorkerLayoutErrorMessage;
export type LayoutRunnerMessage = LayoutWorkerResponse;

export interface LayoutOperationSession {
	cancel(operationId: string): void;
	/**
	 * Terminates the worker/fallback and releases every owned resource,
	 * including a Blob URL where applicable. It must be idempotent.
	 */
	dispose(): void;
}

export interface LayoutOperationRunner {
	start(
		input: LayoutSolverInput,
		onMessage: (message: LayoutRunnerMessage) => void,
	): LayoutOperationSession;
	/** Clears runner-level ownership after its per-run handle is disposed. */
	dispose(): void;
}

export interface LayoutSnapshotPersistence {
	readonly committedSnapshot?: PersistedLayoutSnapshot;
	commitCompletedResult(
		input: CommitCompletedResultInput,
	): Promise<PersistedLayoutSnapshot | undefined>;
	renameCommittedPaths(
		renames: GraphDiff["renamedNodes"],
	): Promise<PersistedLayoutSnapshot | undefined>;
}

export interface CommittedLayoutSink {
	/** Restores persisted coordinates without treating them as a new solve. */
	restore(
		snapshot: PersistedLayoutSnapshot,
		currentGraph: GraphData,
	): void;
	/** Performs the one atomic renderer swap after a valid completed result. */
	commit(
		snapshot: PersistedLayoutSnapshot,
		currentGraph: GraphData,
	): void;
	/**
	 * Updates names/topology/visibility while retaining the exact committed
	 * position map. New unpositioned notes remain absent.
	 */
	updateVisibleGraph?(
		snapshot: PersistedLayoutSnapshot,
		currentGraph: GraphData,
		diff?: GraphDiff,
	): void;
}

export interface LayoutLifecycleControllerOptions {
	readonly planner: LayoutOperationPlanner;
	readonly runner: LayoutOperationRunner;
	readonly persistence: LayoutSnapshotPersistence;
	readonly sink: CommittedLayoutSink;
	readonly getBaseSeed: () => number;
	readonly createOperationId?: () => string;
	readonly now?: () => number;
	readonly normTolerance?: number;
	readonly algorithmVersion?: number;
}

export interface LayoutLifecycleView {
	readonly state: LayoutLifecycleState;
	readonly progress?: LayoutProgress;
	readonly activeWorkerCount: 0 | 1;
	readonly committedSnapshot?: PersistedLayoutSnapshot;
}

export type LayoutLifecycleListener = (
	view: LayoutLifecycleView,
) => void;

interface ActiveOperation {
	readonly operationId: string;
	readonly mode: LayoutOperationMode;
	readonly graph: GraphData;
	readonly effectiveSeed: number;
	readonly expectedSnapshotId: string | null;
	session?: LayoutOperationSession;
	terminalReceived: boolean;
}

let fallbackOperationSequence = 0;

function defaultOperationId(): string {
	fallbackOperationSequence += 1;
	const randomUuid =
		typeof crypto !== "undefined" &&
		typeof crypto.randomUUID === "function"
			? crypto.randomUUID()
			: undefined;
	return randomUuid ?? `operation-${Date.now()}-${fallbackOperationSequence}`;
}

function messageHasPositions(message: LayoutWorkerResponse): boolean {
	return (
		message.type !== "completed" &&
		Object.prototype.hasOwnProperty.call(message, "positions")
	);
}

/**
 * Sole owner of fixed-layout state transitions. The controller never exposes a
 * working position buffer and owns at most one short-lived runner session.
 */
export class LayoutLifecycleController {
	private readonly options: LayoutLifecycleControllerOptions;
	private readonly listeners = new Set<LayoutLifecycleListener>();
	private stateValue: LayoutLifecycleState = Object.freeze({
		kind: "no-layout",
	});
	private progressValue: LayoutProgress | undefined;
	private committedValue: PersistedLayoutSnapshot | undefined;
	private currentGraph: GraphData | undefined;
	private currentDiff: GraphDiff | undefined;
	private activeOperation: ActiveOperation | undefined;
	private unusableSnapshotId: string | undefined;
	private workerCount: 0 | 1 = 0;
	private disposed = false;

	constructor(options: LayoutLifecycleControllerOptions) {
		this.options = options;
	}

	get state(): LayoutLifecycleState {
		return this.stateValue;
	}

	get progress(): LayoutProgress | undefined {
		return this.progressValue;
	}

	get committedSnapshot(): PersistedLayoutSnapshot | undefined {
		return this.committedValue;
	}

	get activeWorkerCount(): 0 | 1 {
		return this.workerCount;
	}

	subscribe(listener: LayoutLifecycleListener): () => void {
		this.listeners.add(listener);
		listener(this.view());
		return () => {
			this.listeners.delete(listener);
		};
	}

	/**
	 * Restores a usable committed map, otherwise automatically starts the sole
	 * allowed automatic operation: Initialize.
	 */
	open(
		graph: GraphData,
		snapshot = this.options.persistence.committedSnapshot,
	): boolean {
		if (this.disposed || this.activeOperation !== undefined) {
			return false;
		}
		this.currentGraph = graph;
		this.progressValue = undefined;
		if (
			snapshot !== undefined &&
			isSnapshotUsable(
				snapshot,
				graph,
				this.options.algorithmVersion ??
					CURRENT_ALGORITHM_VERSION,
			)
		) {
			this.committedValue = snapshot;
			this.unusableSnapshotId = undefined;
			this.options.sink.restore(snapshot, graph);
			this.currentDiff = diffGraphDescriptors(
				snapshot.graphDescriptor,
				graph.descriptor,
				graph.signature,
				[],
				snapshot.graphSignature,
			);
			this.setFixedState(this.currentDiff);
			return false;
		}

		this.committedValue = undefined;
		this.unusableSnapshotId = snapshot?.snapshotId;
		this.currentDiff = undefined;
		this.setState({ kind: "no-layout" });
		return this.startOperation("initialize");
	}

	/**
	 * Applies a rebuilt graph model. It can only change pending/fixed state and
	 * visible topology; it never starts a layout operation.
	 */
	async markGraphChanged(graph: GraphData, diff: GraphDiff): Promise<void> {
		if (this.disposed) {
			return;
		}
		this.currentGraph = graph;
		this.currentDiff = diff;
		const committed = this.committedValue;
		if (committed === undefined) {
			if (this.activeOperation === undefined) {
				this.setState({ kind: "no-layout" });
			}
			return;
		}

		if (this.activeOperation !== undefined) {
			this.options.sink.updateVisibleGraph?.(committed, graph, diff);
			this.emit();
			return;
		}

		if (!diff.requiresLayout && diff.renamedNodes.length > 0) {
			const renamed =
				await this.options.persistence.renameCommittedPaths(
					diff.renamedNodes,
				);
			if (renamed === undefined) {
				this.setError("Could not migrate the renamed note position.");
				return;
			}
			this.committedValue = renamed;
			this.currentDiff = diffGraphDescriptors(
				renamed.graphDescriptor,
				graph.descriptor,
				graph.signature,
				[],
				renamed.graphSignature,
			);
		}
		const latestCommitted = this.committedValue;
		if (latestCommitted !== undefined) {
			this.options.sink.updateVisibleGraph?.(
				latestCommitted,
				graph,
				this.currentDiff,
			);
		}
		this.setFixedState(this.currentDiff);
	}

	startRefresh(): boolean {
		if (
			this.stateValue.kind !== "fixed-dirty" ||
			this.currentDiff === undefined ||
			!this.currentDiff.requiresLayout
		) {
			return false;
		}
		return this.startOperation("refresh");
	}

	startRenew(): boolean {
		if (
			this.stateValue.kind !== "fixed-clean" &&
			this.stateValue.kind !== "fixed-dirty" &&
			this.stateValue.kind !== "error"
		) {
			return false;
		}
		return this.startOperation("renew");
	}

	retryInitialize(): boolean {
		if (
			this.stateValue.kind !== "error" ||
			this.committedValue !== undefined
		) {
			return false;
		}
		return this.startOperation("initialize");
	}

	cancel(): boolean {
		const operation = this.activeOperation;
		if (
			operation === undefined ||
			operation.terminalReceived ||
			this.disposed
		) {
			return false;
		}
		operation.terminalReceived = true;
		try {
			operation.session?.cancel(operation.operationId);
		} finally {
			this.releaseSession(operation);
		}
		this.activeOperation = undefined;
		this.progressValue = undefined;
		this.setState(this.rollbackStateForCurrentGraph());
		void this.settlePureRenameAfterRollback();
		return true;
	}

	dispose(): void {
		if (this.disposed) {
			return;
		}
		const operation = this.activeOperation;
		if (operation !== undefined && !operation.terminalReceived) {
			operation.terminalReceived = true;
			try {
				operation.session?.cancel(operation.operationId);
			} finally {
				this.releaseSession(operation);
			}
		} else if (operation !== undefined) {
			this.releaseSession(operation);
		}
		this.activeOperation = undefined;
		this.progressValue = undefined;
		this.listeners.clear();
		this.disposed = true;
	}

	private startOperation(mode: LayoutOperationMode): boolean {
		const graph = this.currentGraph;
		if (
			this.disposed ||
			this.activeOperation !== undefined ||
			graph === undefined
		) {
			return false;
		}
		const committed = this.committedValue;
		if (
			(mode === "initialize" && committed !== undefined) ||
			(mode === "refresh" &&
				(committed === undefined ||
					this.currentDiff === undefined ||
					!this.currentDiff.requiresLayout))
		) {
			return false;
		}

		const operationId = (
			this.options.createOperationId ?? defaultOperationId
		)();
		if (operationId.length === 0) {
			this.setError("Could not create a layout operation identifier.");
			return false;
		}
		const generation =
			mode === "renew"
				? (committed?.renewGeneration ?? 0) + 1
				: (committed?.renewGeneration ?? 0);
		const effectiveSeed = deriveEffectiveSeed(
			this.options.getBaseSeed(),
			generation,
			graph.signature,
		);
		const operation: ActiveOperation = {
			operationId,
			mode,
			graph,
			effectiveSeed,
			expectedSnapshotId:
				committed?.snapshotId ?? this.unusableSnapshotId ?? null,
			terminalReceived: false,
		};

		let input: LayoutSolverInput;
		try {
			const payload = this.options.planner.createPayload({
				operationId,
				mode,
				graph,
				committedSnapshot: committed,
				diff: this.currentDiff,
				effectiveSeed,
			});
			input = {
				...payload,
				operationId,
				mode,
				graphSignature: graph.signature,
				effectiveSeed,
			};
		} catch (error: unknown) {
			this.setError(
				error instanceof Error
					? error.message
					: "Could not prepare the layout operation.",
			);
			return false;
		}

		this.activeOperation = operation;
		this.progressValue = undefined;
		this.setState(
			mode === "initialize"
				? { kind: "initializing", operationId }
				: mode === "refresh"
					? {
							kind: "refreshing",
							operationId,
							snapshotId: committed?.snapshotId ?? "",
						}
					: {
							kind: "renewing",
							operationId,
							...(committed === undefined
								? {}
								: { snapshotId: committed.snapshotId }),
						},
		);

		try {
			this.workerCount = 1;
			const session = this.options.runner.start(
				input,
				(message) => {
					this.receive(message);
				},
			);
			if (
				this.activeOperation === operation &&
				!operation.terminalReceived &&
				this.workerCount === 1
			) {
				operation.session = session;
			} else {
				try {
					session.dispose();
				} finally {
					this.options.runner.dispose();
				}
			}
			this.emit();
			return true;
		} catch (error: unknown) {
			this.workerCount = 0;
			this.activeOperation = undefined;
			this.setError(
				error instanceof Error
					? error.message
					: "Could not start the layout worker.",
			);
			return false;
		}
	}

	private receive(value: unknown): void {
		if (!isLayoutWorkerResponse(value)) {
			return;
		}
		const message = value;
		const operation = this.activeOperation;
		if (
			this.disposed ||
			operation === undefined ||
			operation.terminalReceived ||
			message.operationId !== operation.operationId
		) {
			return;
		}
		if (
			(message.mode !== undefined && message.mode !== operation.mode) ||
			(message.graphSignature !== undefined &&
				message.graphSignature !== operation.graph.signature)
		) {
			return;
		}
		if (messageHasPositions(message)) {
			return;
		}

		switch (message.type) {
			case "started":
				return;
			case "progress":
				if (
					message.progress.operationId !== operation.operationId ||
					message.progress.mode !== operation.mode
				) {
					return;
				}
				this.progressValue = message.progress;
				this.emit();
				return;
			case "cancelled":
				operation.terminalReceived = true;
				this.releaseSession(operation);
				this.activeOperation = undefined;
				this.progressValue = undefined;
				this.setState(this.rollbackStateForCurrentGraph());
				void this.settlePureRenameAfterRollback();
				return;
			case "error":
				operation.terminalReceived = true;
				this.releaseSession(operation);
				this.activeOperation = undefined;
				this.progressValue = undefined;
				this.setError(message.message);
				return;
			case "completed":
				operation.terminalReceived = true;
				this.releaseSession(operation);
				if (
					validateCompletedPositions(
						message.positions,
						operation.graph.nodes.map((node) => node.path),
						this.options.normTolerance,
					) === undefined
				) {
					this.activeOperation = undefined;
					this.progressValue = undefined;
					this.setError(
						"The completed layout contained invalid positions.",
					);
					return;
				}
				void this.commitCompleted(operation, message);
		}
	}

	private async commitCompleted(
		operation: ActiveOperation,
		message: LayoutCompletedMessage,
	): Promise<void> {
		let snapshot: PersistedLayoutSnapshot | undefined;
		try {
			snapshot = await this.options.persistence.commitCompletedResult({
				graph: operation.graph,
				mode: operation.mode,
				operationId: operation.operationId,
				effectiveSeed: operation.effectiveSeed,
				completedAt: (this.options.now ?? Date.now)(),
				positions: message.positions,
				expectedSnapshotId: operation.expectedSnapshotId,
				algorithmVersion:
					this.options.algorithmVersion ??
					CURRENT_ALGORITHM_VERSION,
				normTolerance: this.options.normTolerance,
			});
		} catch (error: unknown) {
			if (this.activeOperation === operation) {
				this.activeOperation = undefined;
				this.progressValue = undefined;
				this.setError(
					error instanceof Error
						? error.message
						: "Could not save the completed layout.",
				);
			}
			return;
		}
		if (this.activeOperation !== operation || this.disposed) {
			return;
		}
		if (snapshot === undefined) {
			this.activeOperation = undefined;
			this.progressValue = undefined;
			this.setError("The completed layout could not be committed.");
			return;
		}

		this.committedValue = snapshot;
		this.unusableSnapshotId = undefined;
		const currentGraph = this.currentGraph ?? operation.graph;
		let residualDiff = diffGraphDescriptors(
			snapshot.graphDescriptor,
			currentGraph.descriptor,
			currentGraph.signature,
			this.residualRenameHints(),
			snapshot.graphSignature,
		);
		if (
			!residualDiff.requiresLayout &&
			residualDiff.renamedNodes.length > 0
		) {
			try {
				const renamed =
					await this.options.persistence.renameCommittedPaths(
						residualDiff.renamedNodes,
					);
				if (renamed !== undefined) {
					snapshot = renamed;
					this.committedValue = renamed;
					residualDiff = diffGraphDescriptors(
						renamed.graphDescriptor,
						currentGraph.descriptor,
						currentGraph.signature,
						[],
						renamed.graphSignature,
					);
				}
			} catch {
				// The completed snapshot is already valid and committed. Keep it
				// as pending rather than risking a destructive rollback.
			}
		}
		this.options.sink.commit(snapshot, currentGraph);
		this.activeOperation = undefined;
		this.progressValue = undefined;
		this.currentDiff = residualDiff;
		this.setFixedState(residualDiff);
	}

	private residualRenameHints(): readonly GraphRenameHint[] {
		return (
			this.currentDiff?.renamedNodes.map((rename) => ({
				...rename,
				reliability: "reliable" as const,
				source: "vault-event" as const,
			})) ?? []
		);
	}

	private rollbackStateForCurrentGraph(): LayoutLifecycleState {
		const committed = this.committedValue;
		if (committed === undefined) {
			return Object.freeze({ kind: "no-layout" });
		}
		const diff = this.currentDiff;
		if (diff !== undefined && !diff.isEmpty) {
			return Object.freeze({
				kind: "fixed-dirty",
				snapshotId: committed.snapshotId,
				diff: diff.summary,
			});
		}
		return Object.freeze({
			kind: "fixed-clean",
			snapshotId: committed.snapshotId,
		});
	}

	private async settlePureRenameAfterRollback(): Promise<void> {
		const diff = this.currentDiff;
		const graph = this.currentGraph;
		if (
			this.disposed ||
			this.activeOperation !== undefined ||
			diff === undefined ||
			diff.requiresLayout ||
			diff.renamedNodes.length === 0 ||
			graph === undefined
		) {
			return;
		}
		try {
			const renamed =
				await this.options.persistence.renameCommittedPaths(
					diff.renamedNodes,
				);
			if (
				renamed === undefined ||
				this.disposed ||
				this.activeOperation !== undefined ||
				this.currentDiff !== diff
			) {
				return;
			}
			this.committedValue = renamed;
			this.currentDiff = diffGraphDescriptors(
				renamed.graphDescriptor,
				graph.descriptor,
				graph.signature,
				[],
				renamed.graphSignature,
			);
			this.options.sink.updateVisibleGraph?.(
				renamed,
				graph,
				this.currentDiff,
			);
			this.setFixedState(this.currentDiff);
		} catch (error: unknown) {
			if (!this.disposed && this.activeOperation === undefined) {
				this.setError(
					error instanceof Error
						? error.message
						: "Could not migrate the renamed note position.",
				);
			}
		}
	}

	private setFixedState(diff: GraphDiff | undefined): void {
		const committed = this.committedValue;
		if (committed === undefined) {
			this.setState({ kind: "no-layout" });
			return;
		}
		if (diff !== undefined && diff.requiresLayout) {
			this.setState({
				kind: "fixed-dirty",
				snapshotId: committed.snapshotId,
				diff: diff.summary,
			});
		} else {
			this.setState({
				kind: "fixed-clean",
				snapshotId: committed.snapshotId,
			});
		}
	}

	private releaseSession(operation: ActiveOperation): void {
		try {
			try {
				operation.session?.dispose();
			} finally {
				this.options.runner.dispose();
			}
		} finally {
			operation.session = undefined;
			this.workerCount = 0;
		}
	}

	private setError(message: string): void {
		const snapshotId = this.committedValue?.snapshotId;
		this.setState({
			kind: "error",
			...(snapshotId === undefined
				? {}
				: { previousSnapshotId: snapshotId }),
			message,
		});
	}

	private setState(state: LayoutLifecycleState): void {
		this.stateValue = Object.freeze(state);
		this.emit();
	}

	private view(): LayoutLifecycleView {
		return Object.freeze({
			state: this.stateValue,
			...(this.progressValue === undefined
				? {}
				: { progress: this.progressValue }),
			activeWorkerCount: this.workerCount,
			...(this.committedValue === undefined
				? {}
				: { committedSnapshot: this.committedValue }),
		});
	}

	private emit(): void {
		const view = this.view();
		for (const listener of this.listeners) {
			listener(view);
		}
	}
}
