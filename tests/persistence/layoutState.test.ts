import { describe, expect, it } from "vitest";

import { GraphDataService } from "../../src/graph/GraphDataService";
import { GraphDataSource } from "../../src/graph/graphTypes";
import {
	createPersistedContinentalGeography,
	MAX_PERSISTED_CONTINENT_CAP_RADIUS,
} from "../../src/geography";
import { createIntrinsicSphericalGrid } from "../../src/geography/sphericalGrid";
import {
	CURRENT_ALGORITHM_VERSION,
	CURRENT_SCHEMA_VERSION,
	MINIMUM_LOADABLE_ALGORITHM_VERSION,
	createCommittedLayoutSnapshot,
	diagnoseCompletedPositions,
	diagnoseContinentalGeography,
	deriveEffectiveSeed,
	isSnapshotUsable,
	prunePinnedNotePaths,
	pruneSnapshotPaths,
	reconcileCommittedLayout,
	renamePinnedNotePaths,
	renamePinnedNotePathsFromVault,
	renameSnapshotPaths,
	validateAndNormalizePosition,
	validateCompletedPositions,
	validatePinnedNotePaths,
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
	it("normalizes, deduplicates, renames, and prunes pin paths", () => {
		const pins = validatePinnedNotePaths([
			" Folder\\old.md ",
			"Folder/old.md",
			"../outside.md",
			"",
			42,
		]);
		expect(pins).toEqual(["Folder/old.md"]);
		const renamed = renamePinnedNotePaths(pins, [
			{
				oldPath: "Folder/old.md",
				newPath: "Folder/new.md",
			},
		]);
		expect(renamed).toEqual(["Folder/new.md"]);
		expect(
			prunePinnedNotePaths(
				[...renamed, "deleted.md"],
				new Set(["Folder/new.md"]),
			),
		).toEqual(["Folder/new.md"]);
	});

	it("applies exact file and segment-safe folder rename semantics to pins", () => {
		expect(
			renamePinnedNotePathsFromVault(
				[
					"Books/index.md",
					"Bookshelf/index.md",
					"Library/index.md",
				],
				"Books/index.md",
				"Library/index.md",
				"file",
			),
		).toEqual([
			"Bookshelf/index.md",
			"Library/index.md",
		]);

		expect(
			renamePinnedNotePathsFromVault(
				[
					"Books/a.md",
					"Books/sub/b.md",
					"Bookshelf/c.md",
					"Library/a.md",
				],
				"Books",
				"Library",
				"folder",
			),
		).toEqual([
			"Bookshelf/c.md",
			"Library/a.md",
			"Library/sub/b.md",
		]);
	});

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
			diagnoseCompletedPositions(
				new Float32Array([2, 0, 0]),
				["a.md"],
			),
		).toMatchObject({
			stage: "positions",
			code: "norm-out-of-tolerance",
			details: { nodeIndex: 0, norm: 2 },
		});
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

	it("commits and reloads a first layout with a maximally wide continent", () => {
		const currentGraph = new GraphDataService(
			graphSource(["Books/A.md", "Books/B.md"], {
				"Books/A.md": { "Books/B.md": 1 },
			}),
		).buildGraph();
		const positions = new Float32Array([1, 0, 0, -1, 0, 0]);
		const geography = createPersistedContinentalGeography(
			currentGraph,
			positions,
			42,
		);

		expect(geography.continents[0]?.capRadius).toBe(
			MAX_PERSISTED_CONTINENT_CAP_RADIUS,
		);
		const snapshot = createCommittedLayoutSnapshot({
			snapshotId: "wide-first-layout",
			graph: currentGraph,
			mode: "initialize",
			effectiveSeed: 42,
			renewGeneration: 0,
			completedAt: 10,
			positions,
			geography,
		});

		expect(snapshot?.snapshotId).toBe("wide-first-layout");
		expect(
			validatePersistedLayoutSnapshot(
				JSON.parse(JSON.stringify(snapshot)) as unknown,
			)?.snapshotId,
		).toBe("wide-first-layout");
	});

	it("round-trips the fixed directory territory raster through JSON persistence", () => {
		const currentGraph = new GraphDataService(
			graphSource(["Books/A.md", "Books/B.md"], {
				"Books/A.md": { "Books/B.md": 1 },
			}),
		).buildGraph();
		const positions = new Float32Array([
			1, 0, 0,
			0.98, 0.198_997_49, 0,
		]);
		const grid = createIntrinsicSphericalGrid(4);
		const ownerByCell = Int32Array.from(
			grid.vertices,
			(point) => point[0] > 0.15 ? 0 : -1,
		);
		const geography = createPersistedContinentalGeography(
			currentGraph,
			positions,
			42,
			undefined,
			{
				subdivision: 4,
				folderKeys: ["Books"],
				ownerByCell,
			},
		);
		const snapshot = createCommittedLayoutSnapshot({
			snapshotId: "territory-round-trip",
			graph: currentGraph,
			mode: "renew",
			effectiveSeed: 42,
			renewGeneration: 1,
			completedAt: 10,
			positions,
			geography,
		});
		const restored = validatePersistedLayoutSnapshot(
			JSON.parse(JSON.stringify(snapshot)) as unknown,
		);

		expect(restored?.geography?.territory?.subdivision).toBe(4);
		expect(restored?.geography?.territory?.folderKeys).toEqual(["Books"]);
		expect(restored?.geography?.territory?.ownerByCell).toEqual([
			...ownerByCell,
		]);
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

		expect(
			diagnoseContinentalGeography(
				raw.geography,
				currentGraph.descriptor,
			),
		).toMatchObject({
			stage: "geography",
			code: "omitted-linked-node",
			details: { omittedLinkedNodeCount: 2 },
		});
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
		const previousCompatibleSnapshot = createCommittedLayoutSnapshot({
			snapshotId: "algorithm-previous-compatible",
			graph: currentGraph,
			mode: "initialize",
			effectiveSeed: 42,
			renewGeneration: 0,
			completedAt: 10,
			positions: new Float32Array([1, 0, 0]),
			algorithmVersion: MINIMUM_LOADABLE_ALGORITHM_VERSION,
		});

		expect(CURRENT_ALGORITHM_VERSION).toBe(10);
		expect(isSnapshotUsable(legacySnapshot, currentGraph)).toBe(false);
		expect(isSnapshotUsable(previousCompatibleSnapshot, currentGraph)).toBe(true);
		expect(isSnapshotUsable(currentSnapshot, currentGraph)).toBe(true);
	});
});
