import { describe, expect, it, vi } from "vitest";

import { GraphDataService } from "../../src/graph/GraphDataService";
import {
	diffGraphDescriptors,
	GraphDiff,
} from "../../src/graph/graphDiff";
import {
	GraphData,
	GraphDataSource,
} from "../../src/graph/graphTypes";
import {
	CommittedLayoutSink,
	LayoutCompletedMessage,
	LayoutErrorMessage,
	LayoutLifecycleController,
	LayoutOperationPlanner,
	LayoutOperationRunner,
	LayoutOperationSession,
	LayoutProgressMessage,
	LayoutRunnerMessage,
	LayoutSnapshotPersistence,
} from "../../src/layout/LayoutLifecycleController";
import {
	LayoutFinalDiagnostics,
	LayoutOperationMode,
	LayoutProgress,
	LayoutSolverInput,
} from "../../src/layout/layoutTypes";
import {
	CommitCompletedResultInput,
} from "../../src/persistence/PluginDataStore";
import {
	PersistedLayoutSnapshot,
	createCommittedLayoutSnapshot,
	renameSnapshotPaths,
} from "../../src/persistence/layoutState";

function source(
	paths: readonly string[],
	links: Readonly<Record<string, Readonly<Record<string, number>>>> = {},
): GraphDataSource {
	return {
		getMarkdownFiles: () =>
			paths.map((path) => ({
				path,
				basename: path.replace(/\.md$/, ""),
			})),
		getResolvedLinks: () => links,
	};
}

function graph(
	paths: readonly string[],
	links: Readonly<Record<string, Readonly<Record<string, number>>>> = {},
): GraphData {
	return new GraphDataService(source(paths, links)).buildGraph();
}

function fibonacciLikePositions(nodeCount: number): Float32Array {
	const positions = new Float32Array(nodeCount * 3);
	for (let index = 0; index < nodeCount; index += 1) {
		const axis = index % 3;
		positions[index * 3 + axis] = index % 2 === 0 ? 1 : -1;
	}
	return positions;
}

function snapshotFor(
	currentGraph: GraphData,
	id = "saved",
	mode: LayoutOperationMode = "initialize",
	generation = 0,
): PersistedLayoutSnapshot {
	const snapshot = createCommittedLayoutSnapshot({
		snapshotId: id,
		graph: currentGraph,
		mode,
		effectiveSeed: 10,
		renewGeneration: generation,
		completedAt: 1,
		positions: fibonacciLikePositions(currentGraph.nodes.length),
	});
	if (snapshot === undefined) {
		throw new Error("Expected a valid test snapshot.");
	}
	return snapshot;
}

function progress(
	operationId: string,
	mode: LayoutOperationMode,
): LayoutProgress {
	return {
		operationId,
		mode,
		phase: mode === "refresh" ? "new-node-warmup" : "initial",
		iteration: 4,
		maxAngularDisplacement: 0.01,
		meanVectorNorm: 0.01,
		covarianceDiagonal: [0.33, 0.33, 0.34],
		evaluatedRepulsionPairs: 20,
		movableNodeCount: 1,
		anchoredNodeCount: 0,
		hardFixedNodeCount: 0,
		cappedNodeCount: 0,
		maxExistingNodeDisplacement: 0,
		elapsedMs: 5,
	};
}

function diagnostics(
	operationId: string,
	mode: LayoutOperationMode,
): LayoutFinalDiagnostics {
	return {
		...progress(operationId, mode),
		phase: "finalizing",
		converged: true,
		maximumNormError: 0,
		repulsionMode: "exact",
	};
}

class FakeSession implements LayoutOperationSession {
	cancelCount = 0;
	disposeCount = 0;
	cancelledOperationId: string | undefined;

	cancel(operationId: string): void {
		this.cancelCount += 1;
		this.cancelledOperationId = operationId;
	}

	dispose(): void {
		this.disposeCount += 1;
	}
}

class FakeRunner implements LayoutOperationRunner {
	readonly inputs: LayoutSolverInput[] = [];
	readonly sessions: FakeSession[] = [];
	private listener: ((message: LayoutRunnerMessage) => void) | undefined;
	throwOnStart = false;
	disposeCount = 0;
	messageOnStart:
		| ((input: LayoutSolverInput) => LayoutRunnerMessage)
		| undefined;

	start(
		input: LayoutSolverInput,
		onMessage: (message: LayoutRunnerMessage) => void,
	): LayoutOperationSession {
		if (this.throwOnStart) {
			throw new Error("worker creation failed");
		}
		this.inputs.push(input);
		const session = new FakeSession();
		this.sessions.push(session);
		this.listener = onMessage;
		if (this.messageOnStart !== undefined) {
			onMessage(this.messageOnStart(input));
		}
		return session;
	}

	emit(message: LayoutRunnerMessage): void {
		this.listener?.(message);
	}

	dispose(): void {
		this.disposeCount += 1;
	}
}

class FakePersistence implements LayoutSnapshotPersistence {
	committedSnapshot: PersistedLayoutSnapshot | undefined;
	commitCalls = 0;
	renameCalls = 0;
	rejectCommit = false;
	throwCommit = false;
	private pendingCommit:
		| {
				readonly input: CommitCompletedResultInput;
				readonly resolve: (
					value: PersistedLayoutSnapshot | undefined,
				) => void;
		  }
		| undefined;
	delayCommit = false;

	constructor(snapshot?: PersistedLayoutSnapshot) {
		this.committedSnapshot = snapshot;
	}

	async commitCompletedResult(
		input: CommitCompletedResultInput,
	): Promise<PersistedLayoutSnapshot | undefined> {
		this.commitCalls += 1;
		if (this.throwCommit) {
			throw new Error("save failed");
		}
		if (this.rejectCommit) {
			return undefined;
		}
		if (this.delayCommit) {
			return new Promise((resolve) => {
				this.pendingCommit = { input, resolve };
			});
		}
		return this.applyCommit(input);
	}

	async renameCommittedPaths(
		renames: GraphDiff["renamedNodes"],
	): Promise<PersistedLayoutSnapshot | undefined> {
		this.renameCalls += 1;
		if (this.committedSnapshot === undefined) {
			return undefined;
		}
		const renamed = renameSnapshotPaths(
			this.committedSnapshot,
			renames,
		);
		this.committedSnapshot = renamed;
		return renamed;
	}

	resolvePendingCommit(): void {
		const pending = this.pendingCommit;
		if (pending === undefined) {
			throw new Error("No pending commit.");
		}
		this.pendingCommit = undefined;
		pending.resolve(this.applyCommit(pending.input));
	}

	private applyCommit(
		input: CommitCompletedResultInput,
	): PersistedLayoutSnapshot | undefined {
		if (
			(this.committedSnapshot?.snapshotId ?? null) !==
			input.expectedSnapshotId
		) {
			return undefined;
		}
		const generation =
			input.mode === "renew"
				? (this.committedSnapshot?.renewGeneration ?? 0) + 1
				: (this.committedSnapshot?.renewGeneration ?? 0);
		const snapshot = createCommittedLayoutSnapshot({
			snapshotId: `layout-${input.operationId}`,
			graph: input.graph,
			mode: input.mode,
			effectiveSeed: input.effectiveSeed,
			renewGeneration: generation,
			completedAt: input.completedAt,
			positions: input.positions,
			algorithmVersion: input.algorithmVersion,
			normTolerance: input.normTolerance,
		});
		if (snapshot !== undefined) {
			this.committedSnapshot = snapshot;
		}
		return snapshot;
	}
}

class FakeSink implements CommittedLayoutSink {
	readonly restored: PersistedLayoutSnapshot[] = [];
	readonly committed: PersistedLayoutSnapshot[] = [];
	visibleUpdates = 0;

	restore(snapshot: PersistedLayoutSnapshot): void {
		this.restored.push(snapshot);
	}

	commit(snapshot: PersistedLayoutSnapshot): void {
		this.committed.push(snapshot);
	}

	updateVisibleGraph(): void {
		this.visibleUpdates += 1;
	}
}

class FakePlanner implements LayoutOperationPlanner {
	createPayload(context: {
		readonly graph: GraphData;
	}): Omit<
		LayoutSolverInput,
		"operationId" | "mode" | "graphSignature" | "effectiveSeed"
	> {
		const edgeEndpoints = new Uint32Array(context.graph.edges.length * 2);
		const edgeWeights = new Float32Array(context.graph.edges.length);
		context.graph.edges.forEach((edge, index) => {
			edgeEndpoints[index * 2] = edge.source;
			edgeEndpoints[index * 2 + 1] = edge.target;
			edgeWeights[index] = edge.weight;
		});
		return {
			positions: fibonacciLikePositions(context.graph.nodes.length),
			edgeEndpoints,
			edgeWeights,
		};
	}
}

interface Harness {
	readonly controller: LayoutLifecycleController;
	readonly runner: FakeRunner;
	readonly persistence: FakePersistence;
	readonly sink: FakeSink;
}

function harness(snapshot?: PersistedLayoutSnapshot): Harness {
	const runner = new FakeRunner();
	const persistence = new FakePersistence(snapshot);
	const sink = new FakeSink();
	let operationSequence = 0;
	const controller = new LayoutLifecycleController({
		planner: new FakePlanner(),
		runner,
		persistence,
		sink,
		getBaseSeed: () => 42,
		createOperationId: () => {
			operationSequence += 1;
			return `op-${operationSequence}`;
		},
		now: () => 100,
	});
	return { controller, runner, persistence, sink };
}

function currentOperation(harnessValue: Harness): LayoutSolverInput {
	const input = harnessValue.runner.inputs.at(-1);
	if (input === undefined) {
		throw new Error("Expected a running operation.");
	}
	return input;
}

function completed(
	input: LayoutSolverInput,
	positions = fibonacciLikePositions(input.positions.length / 3),
): LayoutCompletedMessage {
	return {
		type: "completed",
		operationId: input.operationId,
		mode: input.mode,
		graphSignature: input.graphSignature,
		positions,
		diagnostics: diagnostics(input.operationId, input.mode),
	};
}

describe("LayoutLifecycleController initialization and fixed states", () => {
	it("starts initialization immediately when there is no usable snapshot", async () => {
		const h = harness();
		const currentGraph = graph(["a.md", "b.md"]);
		expect(h.controller.open(currentGraph)).toBe(true);
		expect(h.controller.state).toEqual({
			kind: "initializing",
			operationId: "op-1",
		});
		expect(h.controller.activeWorkerCount).toBe(1);
		expect(h.runner.inputs).toHaveLength(1);

		const input = currentOperation(h);
		h.runner.emit(completed(input));
		await vi.waitFor(() => {
			expect(h.controller.state.kind).toBe("fixed-clean");
		});
		expect(h.persistence.commitCalls).toBe(1);
		expect(h.sink.committed).toHaveLength(1);
		expect(h.runner.sessions[0]?.disposeCount).toBe(1);
		expect(h.controller.activeWorkerCount).toBe(0);
	});

	it("disposes a runner that completes synchronously during start", async () => {
		const h = harness();
		h.runner.messageOnStart = (input) => completed(input);
		expect(h.controller.open(graph(["a.md"]))).toBe(true);
		expect(h.controller.activeWorkerCount).toBe(0);
		expect(h.runner.sessions[0]?.disposeCount).toBe(1);
		await vi.waitFor(() => {
			expect(h.controller.state.kind).toBe("fixed-clean");
		});
		expect(h.runner.sessions[0]?.disposeCount).toBe(1);
	});

	it("restores a usable snapshot without creating a worker", () => {
		const currentGraph = graph(["a.md"]);
		const saved = snapshotFor(currentGraph);
		const h = harness(saved);
		expect(h.controller.open(currentGraph, saved)).toBe(false);
		expect(h.controller.state).toEqual({
			kind: "fixed-clean",
			snapshotId: "saved",
		});
		expect(h.runner.inputs).toHaveLength(0);
		expect(h.sink.restored).toEqual([saved]);
		expect(h.controller.activeWorkerCount).toBe(0);
	});

	it("atomically replaces an existing but algorithm-incompatible snapshot", async () => {
		const currentGraph = graph(["a.md"]);
		const incompatible: PersistedLayoutSnapshot = {
			...snapshotFor(currentGraph, "incompatible"),
			algorithmVersion: 99,
		};
		const h = harness(incompatible);
		expect(h.controller.open(currentGraph, incompatible)).toBe(true);
		const input = currentOperation(h);
		h.runner.emit(completed(input));
		await vi.waitFor(() => {
			expect(h.controller.state.kind).toBe("fixed-clean");
		});
		expect(h.persistence.commitCalls).toBe(1);
		expect(h.controller.committedSnapshot?.snapshotId).toBe("layout-op-1");
	});

	it("restores a changed graph as fixed-dirty without auto-refresh", () => {
		const oldGraph = graph(["a.md"]);
		const saved = snapshotFor(oldGraph);
		const currentGraph = graph(["a.md", "new.md"]);
		const h = harness(saved);
		h.controller.open(currentGraph, saved);
		expect(h.controller.state.kind).toBe("fixed-dirty");
		expect(h.runner.inputs).toHaveLength(0);
		expect(h.controller.activeWorkerCount).toBe(0);
	});

	it("does not restart a cancelled initialization from a later vault event", async () => {
		const h = harness();
		const initialGraph = graph(["a.md"]);
		h.controller.open(initialGraph);
		expect(h.controller.state.kind).toBe("initializing");
		expect(h.controller.cancel()).toBe(true);
		expect(h.controller.state.kind).toBe("no-layout");
		const changed = graph(["a.md", "b.md"]);
		const diff = diffGraphDescriptors(
			undefined,
			changed.descriptor,
			changed.signature,
		);
		await h.controller.markGraphChanged(changed, diff);
		expect(h.runner.inputs).toHaveLength(1);
		expect(h.controller.state.kind).toBe("no-layout");
	});
});

describe("LayoutLifecycleController pending and refresh semantics", () => {
	it("marks a vault change dirty without starting a solver", async () => {
		const oldGraph = graph(["a.md"]);
		const saved = snapshotFor(oldGraph);
		const h = harness(saved);
		h.controller.open(oldGraph, saved);
		const changed = graph(["a.md", "b.md"]);
		const diff = diffGraphDescriptors(
			saved.graphDescriptor,
			changed.descriptor,
			changed.signature,
			[],
			saved.graphSignature,
		);
		await h.controller.markGraphChanged(changed, diff);
		expect(h.controller.state.kind).toBe("fixed-dirty");
		expect(h.runner.inputs).toHaveLength(0);
		expect(h.sink.visibleUpdates).toBe(1);
	});

	it("treats a reliable pure rename as persistence migration, not layout work", async () => {
		const oldGraph = graph(["old.md"]);
		const saved = snapshotFor(oldGraph);
		const renamedGraph = graph(["new.md"]);
		const diff = diffGraphDescriptors(
			saved.graphDescriptor,
			renamedGraph.descriptor,
			renamedGraph.signature,
			[
				{
					oldPath: "old.md",
					newPath: "new.md",
					reliability: "reliable",
				},
			],
			saved.graphSignature,
		);
		const h = harness(saved);
		h.controller.open(oldGraph, saved);
		await h.controller.markGraphChanged(renamedGraph, diff);
		expect(h.persistence.renameCalls).toBe(1);
		expect(h.controller.committedSnapshot?.positionsByPath["new.md"]).toEqual(
			saved.positionsByPath["old.md"],
		);
		expect(h.controller.state.kind).toBe("fixed-clean");
		expect(h.controller.startRefresh()).toBe(false);
		expect(h.runner.inputs).toHaveLength(0);
	});

	it("keeps the old map rendered through progress and atomically swaps only completed", async () => {
		const oldGraph = graph(["a.md"]);
		const saved = snapshotFor(oldGraph);
		const changed = graph(["a.md", "b.md"]);
		const h = harness(saved);
		h.controller.open(changed, saved);
		expect(h.controller.startRefresh()).toBe(true);
		const input = currentOperation(h);
		const message: LayoutProgressMessage = {
			type: "progress",
			operationId: input.operationId,
			mode: input.mode,
			graphSignature: input.graphSignature,
			progress: progress(input.operationId, input.mode),
		};
		h.runner.emit(message);
		expect(h.controller.progress?.iteration).toBe(4);
		expect(h.persistence.commitCalls).toBe(0);
		expect(h.sink.committed).toHaveLength(0);

		h.runner.emit(completed(input));
		await vi.waitFor(() => {
			expect(h.sink.committed).toHaveLength(1);
		});
		expect(h.persistence.commitCalls).toBe(1);
		expect(h.controller.activeWorkerCount).toBe(0);
	});

	it("ignores progress messages that illegally contain positions", () => {
		const oldGraph = graph(["a.md"]);
		const saved = snapshotFor(oldGraph);
		const changed = graph(["a.md", "b.md"]);
		const h = harness(saved);
		h.controller.open(changed, saved);
		h.controller.startRefresh();
		const input = currentOperation(h);
		const malformed = {
			type: "progress",
			operationId: input.operationId,
			mode: input.mode,
			graphSignature: input.graphSignature,
			progress: progress(input.operationId, input.mode),
			positions: new Float32Array([1, 0, 0]),
		} as unknown as LayoutRunnerMessage;
		h.runner.emit(malformed);
		expect(h.controller.progress).toBeUndefined();
		expect(h.sink.committed).toHaveLength(0);
		expect(h.persistence.commitCalls).toBe(0);
	});

	it("does not create a worker for Refresh without a real diff", () => {
		const currentGraph = graph(["a.md"]);
		const saved = snapshotFor(currentGraph);
		const h = harness(saved);
		h.controller.open(currentGraph, saved);
		expect(h.controller.startRefresh()).toBe(false);
		expect(h.runner.inputs).toHaveLength(0);
	});

	it("prevents concurrent layout operations", () => {
		const oldGraph = graph(["a.md"]);
		const saved = snapshotFor(oldGraph);
		const h = harness(saved);
		h.controller.open(graph(["a.md", "b.md"]), saved);
		expect(h.controller.startRefresh()).toBe(true);
		expect(h.controller.startRefresh()).toBe(false);
		expect(h.controller.startRenew()).toBe(false);
		expect(h.runner.inputs).toHaveLength(1);
	});
});

describe("LayoutLifecycleController rollback and stale-result protection", () => {
	it("cancels, disposes, and rolls back to the previous fixed state", () => {
		const oldGraph = graph(["a.md"]);
		const saved = snapshotFor(oldGraph);
		const h = harness(saved);
		h.controller.open(graph(["a.md", "b.md"]), saved);
		h.controller.startRefresh();
		const session = h.runner.sessions[0];
		expect(h.controller.cancel()).toBe(true);
		expect(session?.cancelCount).toBe(1);
		expect(session?.disposeCount).toBe(1);
		expect(h.controller.state.kind).toBe("fixed-dirty");
		expect(h.controller.committedSnapshot).toBe(saved);
		expect(h.persistence.commitCalls).toBe(0);
		expect(h.controller.activeWorkerCount).toBe(0);
		expect(h.runner.disposeCount).toBe(1);
		expect(h.controller.startRefresh()).toBe(true);
		expect(h.runner.inputs).toHaveLength(2);
	});

	it("retains and migrates a reliable rename detected during a cancelled run", async () => {
		const oldGraph = graph(["old.md"]);
		const saved = snapshotFor(oldGraph);
		const h = harness(saved);
		h.controller.open(oldGraph, saved);
		h.controller.startRenew();
		const renamedGraph = graph(["new.md"]);
		const renameDiff = diffGraphDescriptors(
			saved.graphDescriptor,
			renamedGraph.descriptor,
			renamedGraph.signature,
			[
				{
					oldPath: "old.md",
					newPath: "new.md",
					reliability: "reliable",
				},
			],
			saved.graphSignature,
		);
		await h.controller.markGraphChanged(renamedGraph, renameDiff);
		expect(h.controller.cancel()).toBe(true);
		expect(h.controller.state.kind).toBe("fixed-dirty");
		await vi.waitFor(() => {
			expect(h.controller.state.kind).toBe("fixed-clean");
		});
		expect(h.controller.committedSnapshot?.positionsByPath["new.md"]).toEqual(
			saved.positionsByPath["old.md"],
		);
		expect(h.persistence.renameCalls).toBe(1);
	});

	it("preserves the previous snapshot on worker error", () => {
		const currentGraph = graph(["a.md"]);
		const saved = snapshotFor(currentGraph);
		const h = harness(saved);
		h.controller.open(currentGraph, saved);
		h.controller.startRenew();
		const input = currentOperation(h);
		const message: LayoutErrorMessage = {
			type: "error",
			operationId: input.operationId,
			mode: input.mode,
			graphSignature: input.graphSignature,
			message: "solver failed",
		};
		h.runner.emit(message);
		expect(h.controller.state).toEqual({
			kind: "error",
			previousSnapshotId: saved.snapshotId,
			message: "solver failed",
		});
		expect(h.controller.committedSnapshot).toBe(saved);
		expect(h.persistence.commitCalls).toBe(0);
		expect(h.controller.activeWorkerCount).toBe(0);
		expect(h.runner.sessions[0]?.disposeCount).toBe(1);
	});

	it("ignores stale operation ids and input signatures", () => {
		const currentGraph = graph(["a.md"]);
		const saved = snapshotFor(currentGraph);
		const h = harness(saved);
		h.controller.open(currentGraph, saved);
		h.controller.startRenew();
		const input = currentOperation(h);
		h.runner.emit({
			...completed(input),
			operationId: "stale",
		});
		h.runner.emit({
			...completed(input),
			graphSignature: "wrong-signature",
		});
		expect(h.persistence.commitCalls).toBe(0);
		expect(h.controller.state.kind).toBe("renewing");
		expect(h.controller.activeWorkerCount).toBe(1);
	});

	it("rejects an invalid completed buffer without persistence or renderer mutation", () => {
		const currentGraph = graph(["a.md"]);
		const saved = snapshotFor(currentGraph);
		const h = harness(saved);
		h.controller.open(currentGraph, saved);
		h.controller.startRenew();
		const input = currentOperation(h);
		h.runner.emit(completed(input, new Float32Array([0, 0, 0])));
		expect(h.controller.state.kind).toBe("error");
		expect(h.persistence.commitCalls).toBe(0);
		expect(h.sink.committed).toHaveLength(0);
		expect(h.controller.committedSnapshot).toBe(saved);
		expect(h.controller.activeWorkerCount).toBe(0);
	});

	it("preserves the old map when persistence rejects or throws", async () => {
		const currentGraph = graph(["a.md"]);
		const saved = snapshotFor(currentGraph);
		const rejected = harness(saved);
		rejected.persistence.rejectCommit = true;
		rejected.controller.open(currentGraph, saved);
		rejected.controller.startRenew();
		rejected.runner.emit(completed(currentOperation(rejected)));
		await vi.waitFor(() => {
			expect(rejected.controller.state.kind).toBe("error");
		});
		expect(rejected.controller.committedSnapshot).toBe(saved);
		expect(rejected.sink.committed).toHaveLength(0);

		const thrown = harness(saved);
		thrown.persistence.throwCommit = true;
		thrown.controller.open(currentGraph, saved);
		thrown.controller.startRenew();
		thrown.runner.emit(completed(currentOperation(thrown)));
		await vi.waitFor(() => {
			expect(thrown.controller.state.kind).toBe("error");
		});
		expect(thrown.controller.committedSnapshot).toBe(saved);
		expect(thrown.sink.committed).toHaveLength(0);
	});

	it("terminates the worker immediately on completed while the atomic save is pending", async () => {
		const currentGraph = graph(["a.md"]);
		const saved = snapshotFor(currentGraph);
		const h = harness(saved);
		h.persistence.delayCommit = true;
		h.controller.open(currentGraph, saved);
		h.controller.startRenew();
		h.runner.emit(completed(currentOperation(h)));
		expect(h.controller.activeWorkerCount).toBe(0);
		expect(h.runner.sessions[0]?.disposeCount).toBe(1);
		expect(h.sink.committed).toHaveLength(0);
		expect(h.controller.committedSnapshot).toBe(saved);
		h.persistence.resolvePendingCommit();
		await vi.waitFor(() => {
			expect(h.sink.committed).toHaveLength(1);
		});
	});

	it("cancels and releases ownership when disposed during calculation", () => {
		const currentGraph = graph(["a.md"]);
		const saved = snapshotFor(currentGraph);
		const h = harness(saved);
		h.controller.open(currentGraph, saved);
		h.controller.startRenew();
		h.controller.dispose();
		expect(h.runner.sessions[0]?.cancelCount).toBe(1);
		expect(h.runner.sessions[0]?.disposeCount).toBe(1);
		expect(h.controller.activeWorkerCount).toBe(0);
		expect(h.persistence.commitCalls).toBe(0);
	});
});

describe("LayoutLifecycleController renew and concurrent graph changes", () => {
	it("uses a different effective seed only after each successful Renew generation", async () => {
		const currentGraph = graph(["a.md", "b.md"]);
		const saved = snapshotFor(currentGraph);
		const h = harness(saved);
		h.controller.open(currentGraph, saved);

		h.controller.startRenew();
		const first = currentOperation(h);
		h.runner.emit(completed(first));
		await vi.waitFor(() => {
			expect(h.controller.state.kind).toBe("fixed-clean");
		});

		h.controller.startRenew();
		const second = currentOperation(h);
		expect(second.effectiveSeed).not.toBe(first.effectiveSeed);
		h.runner.emit(completed(second));
		await vi.waitFor(() => {
			expect(h.controller.committedSnapshot?.renewGeneration).toBe(2);
		});
	});

	it("records changes during a run without restart and remains dirty after captured commit", async () => {
		const oldGraph = graph(["a.md"]);
		const saved = snapshotFor(oldGraph);
		const operationGraph = graph(["a.md", "b.md"]);
		const h = harness(saved);
		h.controller.open(operationGraph, saved);
		h.controller.startRefresh();
		const input = currentOperation(h);

		const latestGraph = graph(["a.md", "b.md", "c.md"]);
		const latestDiff = diffGraphDescriptors(
			saved.graphDescriptor,
			latestGraph.descriptor,
			latestGraph.signature,
			[],
			saved.graphSignature,
		);
		await h.controller.markGraphChanged(latestGraph, latestDiff);
		expect(h.runner.inputs).toHaveLength(1);
		expect(h.controller.state.kind).toBe("refreshing");

		h.runner.emit(completed(input));
		await vi.waitFor(() => {
			expect(h.controller.state.kind).toBe("fixed-dirty");
		});
		expect(h.runner.inputs).toHaveLength(1);
		expect(h.controller.committedSnapshot?.graphSignature).toBe(
			operationGraph.signature,
		);
	});

	it("returns to error with zero ownership when worker creation fails", () => {
		const currentGraph = graph(["a.md"]);
		const saved = snapshotFor(currentGraph);
		const h = harness(saved);
		h.runner.throwOnStart = true;
		h.controller.open(currentGraph, saved);
		expect(h.controller.startRenew()).toBe(false);
		expect(h.controller.state).toEqual({
			kind: "error",
			previousSnapshotId: saved.snapshotId,
			message: "worker creation failed",
		});
		expect(h.controller.activeWorkerCount).toBe(0);
	});
});
