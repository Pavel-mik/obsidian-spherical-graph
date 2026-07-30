import { describe, expect, it } from "vitest";

import { GraphDataService } from "../../src/graph/GraphDataService";
import { GraphDataSource } from "../../src/graph/graphTypes";
import {
	CURRENT_ALGORITHM_VERSION,
	CURRENT_SCHEMA_VERSION,
	createCommittedLayoutSnapshot,
	deriveEffectiveSeed,
	isSnapshotUsable,
	pruneSnapshotPaths,
	reconcileCommittedLayout,
	renameSnapshotPaths,
	validateAndNormalizePosition,
	validateCompletedPositions,
	validatePersistedLayoutSnapshot,
} from "../../src/persistence/layoutState";

function graphSource(
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

function graph(paths: readonly string[]) {
	return new GraphDataService(graphSource(paths)).buildGraph();
}

describe("layout state validation", () => {
	it("rejects non-finite and zero positions and normalizes valid positions", () => {
		expect(validateAndNormalizePosition([Number.NaN, 0, 1])).toBeUndefined();
		expect(
			validateAndNormalizePosition([Number.POSITIVE_INFINITY, 0, 1]),
		).toBeUndefined();
		expect(validateAndNormalizePosition([0, 0, 0])).toBeUndefined();
		expect(validateAndNormalizePosition([3, 0, 4])).toEqual([
			0.6, 0, 0.8,
		]);
	});

	it("validates the full completed buffer and enforces norm tolerance", () => {
		expect(
			validateCompletedPositions(
				new Float32Array([1, 0, 0, 0, 1, 0]),
				["a.md", "b.md"],
			),
		).toMatchObject({ maxNormError: 0 });
		expect(
			validateCompletedPositions(
				new Float32Array([2, 0, 0]),
				["a.md"],
			),
		).toBeUndefined();
		expect(
			validateCompletedPositions(
				new Float32Array([0, 0, 0]),
				["a.md"],
			),
		).toBeUndefined();
		expect(
			validateCompletedPositions(
				new Float32Array([Number.NaN, 0, 1]),
				["a.md"],
			),
		).toBeUndefined();
	});

	it("normalizes persisted vectors but rejects a corrupted snapshot atomically", () => {
		const currentGraph = graph(["a.md"]);
		const snapshot = createCommittedLayoutSnapshot({
			snapshotId: "snapshot",
			graph: currentGraph,
			mode: "initialize",
			effectiveSeed: 1,
			renewGeneration: 0,
			completedAt: 10,
			positions: new Float32Array([1, 0, 0]),
		});
		expect(snapshot).toBeDefined();
		const stretched = {
			...snapshot,
			positionsByPath: { "a.md": [2, 0, 0] },
		};
		expect(
			validatePersistedLayoutSnapshot(stretched)?.positionsByPath[
				"a.md"
			],
		).toEqual([1, 0, 0]);
		expect(
			validatePersistedLayoutSnapshot({
				...stretched,
				positionsByPath: { "a.md": [0, 0, 0] },
			}),
		).toBeUndefined();
	});
});

describe("snapshot reconciliation and migrations", () => {
	it("keeps only positioned current notes visible and reports pending/deleted", () => {
		const oldGraph = graph(["a.md", "deleted.md"]);
		const snapshot = createCommittedLayoutSnapshot({
			snapshotId: "old",
			graph: oldGraph,
			mode: "initialize",
			effectiveSeed: 1,
			renewGeneration: 0,
			completedAt: 10,
			positions: new Float32Array([1, 0, 0, 0, 1, 0]),
		});
		if (snapshot === undefined) {
			throw new Error("Expected test snapshot.");
		}
		const reconciled = reconcileCommittedLayout(
			snapshot,
			graph(["a.md", "new.md"]),
		);
		expect(reconciled.visibleNodeIds).toEqual(["a.md"]);
		expect(reconciled.pendingNodeIds).toEqual(["new.md"]);
		expect(reconciled.removedNodeIds).toEqual(["deleted.md"]);
		expect(reconciled.nodes.map((node) => node.index)).toEqual([0]);
		expect([...reconciled.positions]).toEqual([1, 0, 0]);
	});

	it("packs visible nodes and remaps only edges whose endpoints are committed", () => {
		const oldGraph = graph(["a.md", "b.md"]);
		const snapshot = createCommittedLayoutSnapshot({
			snapshotId: "old",
			graph: oldGraph,
			mode: "initialize",
			effectiveSeed: 1,
			renewGeneration: 0,
			completedAt: 10,
			positions: new Float32Array([1, 0, 0, 0, 1, 0]),
		});
		if (snapshot === undefined) {
			throw new Error("Expected test snapshot.");
		}
		const currentGraph = new GraphDataService(
			graphSource(
				["a.md", "b.md", "new.md"],
				{
					"a.md": { "b.md": 2, "new.md": 3 },
				},
			),
		).buildGraph();
		const reconciled = reconcileCommittedLayout(snapshot, currentGraph);
		expect(reconciled.nodes.map((node) => node.path)).toEqual([
			"a.md",
			"b.md",
		]);
		expect(reconciled.edges).toEqual([
			{
				source: 0,
				target: 1,
				weight: 2,
				forwardWeight: 2,
				backwardWeight: 0,
			},
		]);
		expect(reconciled.nodes[0]).toMatchObject({
			index: 0,
			degree: 1,
			weightedDegree: 2,
		});
		expect(reconciled.pendingNodeIds).toEqual(["new.md"]);
	});

	it("can render a reliable rename at the old coordinate before persistence migration", () => {
		const oldGraph = graph(["old.md"]);
		const snapshot = createCommittedLayoutSnapshot({
			snapshotId: "old",
			graph: oldGraph,
			mode: "initialize",
			effectiveSeed: 1,
			renewGeneration: 0,
			completedAt: 10,
			positions: new Float32Array([1, 0, 0]),
		});
		if (snapshot === undefined) {
			throw new Error("Expected test snapshot.");
		}
		const reconciled = reconcileCommittedLayout(
			snapshot,
			graph(["new.md"]),
			[{ oldPath: "old.md", newPath: "new.md" }],
		);
		expect(reconciled.visibleNodeIds).toEqual(["new.md"]);
		expect(reconciled.pendingNodeIds).toEqual([]);
		expect(reconciled.removedNodeIds).toEqual([]);
		expect([...reconciled.positions]).toEqual([1, 0, 0]);
	});

	it("moves a committed coordinate and descriptor through a reliable rename", () => {
		const originalGraph = graph(["old.md", "peer.md"]);
		const snapshot = createCommittedLayoutSnapshot({
			snapshotId: "old",
			graph: originalGraph,
			mode: "initialize",
			effectiveSeed: 1,
			renewGeneration: 0,
			completedAt: 10,
			positions: new Float32Array([1, 0, 0, 0, 1, 0]),
		});
		if (snapshot === undefined) {
			throw new Error("Expected test snapshot.");
		}
		const renamed = renameSnapshotPaths(snapshot, [
			{ oldPath: "old.md", newPath: "new.md" },
		]);
		expect(renamed?.positionsByPath["old.md"]).toBeUndefined();
		expect(renamed?.positionsByPath["new.md"]).toEqual(
			snapshot.positionsByPath["old.md"],
		);
		expect(renamed?.graphDescriptor.nodeIds).toEqual([
			"new.md",
			"peer.md",
		]);
	});

	it("prunes nonexistent paths and their incident edges", () => {
		const oldGraph = new GraphDataService(
			graphSource(["a.md", "b.md"], { "a.md": { "b.md": 1 } }),
		).buildGraph();
		const snapshot = createCommittedLayoutSnapshot({
			snapshotId: "old",
			graph: oldGraph,
			mode: "initialize",
			effectiveSeed: 1,
			renewGeneration: 0,
			completedAt: 10,
			positions: new Float32Array([1, 0, 0, 0, 1, 0]),
		});
		if (snapshot === undefined) {
			throw new Error("Expected test snapshot.");
		}
		const pruned = pruneSnapshotPaths(snapshot, new Set(["a.md"]));
		expect(pruned.graphDescriptor.nodeIds).toEqual(["a.md"]);
		expect(pruned.graphDescriptor.edges).toEqual([]);
		expect(pruned.positionsByPath["b.md"]).toBeUndefined();
	});

	it("derives deterministic generation-specific effective seeds", () => {
		const first = deriveEffectiveSeed(42, 1, "graph");
		expect(deriveEffectiveSeed(42, 1, "graph")).toBe(first);
		expect(deriveEffectiveSeed(42, 2, "graph")).not.toBe(first);
		expect(Number.isInteger(first)).toBe(true);
	});

	it("uses the current schema on created snapshots", () => {
		const snapshot = createCommittedLayoutSnapshot({
			snapshotId: "schema",
			graph: graph([]),
			mode: "initialize",
			effectiveSeed: 0,
			renewGeneration: 0,
			completedAt: 0,
			positions: new Float32Array(),
		});
		expect(snapshot?.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
	});

	it("preserves a fixed snapshot whose orphan notes are omitted from geography", () => {
		const currentGraph = graph(["orphan.md"]);
		const snapshot = createCommittedLayoutSnapshot({
			snapshotId: "orphan-over-water",
			graph: currentGraph,
			mode: "initialize",
			effectiveSeed: 42,
			renewGeneration: 0,
			completedAt: 10,
			positions: new Float32Array([1, 0, 0]),
		});

		expect(snapshot?.geography?.continents).toEqual([]);
		expect(snapshot?.geography?.islandNodeIds).toEqual([]);
		expect(
			validatePersistedLayoutSnapshot(
				JSON.parse(JSON.stringify(snapshot)) as unknown,
			)?.snapshotId,
		).toBe("orphan-over-water");
	});

	it("rejects geography that omits a linked note", () => {
		const currentGraph = new GraphDataService(
			graphSource(["a.md", "b.md"], {
				"a.md": { "b.md": 1 },
			}),
		).buildGraph();
		const snapshot = createCommittedLayoutSnapshot({
			snapshotId: "truncated-geography",
			graph: currentGraph,
			mode: "initialize",
			effectiveSeed: 42,
			renewGeneration: 0,
			completedAt: 10,
			positions: new Float32Array([1, 0, 0, 0, 1, 0]),
		});
		if (snapshot === undefined) {
			throw new Error("Expected a valid linked-note fixture.");
		}
		const raw = JSON.parse(JSON.stringify(snapshot)) as {
			geography: {
				version: number;
				continents: unknown[];
				islandNodeIds: string[];
			};
		};
		raw.geography = {
			version: raw.geography.version,
			continents: [],
			islandNodeIds: [],
		};

		expect(validatePersistedLayoutSnapshot(raw)).toBeUndefined();
	});

	it("invalidates pre-organic-spacing snapshots after the algorithm upgrade", () => {
		const currentGraph = graph(["a.md"]);
		const legacySnapshot = createCommittedLayoutSnapshot({
			snapshotId: "algorithm-5",
			graph: currentGraph,
			mode: "initialize",
			effectiveSeed: 42,
			renewGeneration: 0,
			completedAt: 10,
			positions: new Float32Array([1, 0, 0]),
			algorithmVersion: 5,
		});
		const currentSnapshot = createCommittedLayoutSnapshot({
			snapshotId: "algorithm-current",
			graph: currentGraph,
			mode: "initialize",
			effectiveSeed: 42,
			renewGeneration: 0,
			completedAt: 10,
			positions: new Float32Array([1, 0, 0]),
		});

		expect(CURRENT_ALGORITHM_VERSION).toBe(8);
		expect(isSnapshotUsable(legacySnapshot, currentGraph)).toBe(false);
		expect(isSnapshotUsable(currentSnapshot, currentGraph)).toBe(true);
	});
});
