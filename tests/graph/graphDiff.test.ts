import { describe, expect, it } from "vitest";

import {
	diffGraphDescriptors,
	graphChangeRatio,
} from "../../src/graph/graphDiff";
import { createGraphSignature } from "../../src/graph/graphSignature";
import {
	GraphDescriptor,
	GraphDescriptorEdge,
} from "../../src/graph/graphTypes";

function edge(
	sourceId: string,
	targetId: string,
	forwardWeight = 1,
	backwardWeight = 0,
): GraphDescriptorEdge {
	return {
		sourceId,
		targetId,
		weight: forwardWeight + backwardWeight,
		forwardWeight,
		backwardWeight,
	};
}

function descriptor(
	nodeIds: string[],
	edges: GraphDescriptorEdge[],
	filterSignature = "filter-a",
): GraphDescriptor {
	return {
		nodeIds,
		edges,
		filterSignature,
	};
}

describe("diffGraphDescriptors", () => {
	it("detects added and removed nodes and every edge change kind", () => {
		const previous = descriptor(
			["a.md", "b.md", "removed.md"],
			[
				edge("a.md", "b.md", 1),
				edge("a.md", "removed.md", 2),
			],
		);
		const current = descriptor(
			["a.md", "b.md", "new.md"],
			[
				edge("a.md", "b.md", 3),
				edge("b.md", "new.md", 1),
			],
		);
		const signature = createGraphSignature(current);
		const diff = diffGraphDescriptors(
			previous,
			current,
			signature,
		);

		expect(diff.addedNodeIds).toEqual(["new.md"]);
		expect(diff.removedNodeIds).toEqual(["removed.md"]);
		expect(diff.addedEdges).toEqual([
			edge("b.md", "new.md", 1),
		]);
		expect(diff.removedEdges).toEqual([
			edge("a.md", "removed.md", 2),
		]);
		expect(diff.changedEdgeWeights).toEqual([
			{
				sourceId: "a.md",
				targetId: "b.md",
				previousWeight: 1,
				currentWeight: 3,
				previousForwardWeight: 1,
				currentForwardWeight: 3,
				previousBackwardWeight: 0,
				currentBackwardWeight: 0,
			},
		]);
		expect(diff.requiresLayout).toBe(true);
		expect(diff.linkChangeCount).toBe(3);
		expect(diff.affectedNodeIds).toEqual([
			"a.md",
			"b.md",
			"new.md",
			"removed.md",
		]);
	});

	it("accepts a reliable one-to-one rename and remaps its incident edges", () => {
		const previous = descriptor(
			["old.md", "peer.md"],
			[edge("old.md", "peer.md", 2, 1)],
		);
		const current = descriptor(
			["new.md", "peer.md"],
			[edge("new.md", "peer.md", 2, 1)],
		);
		const diff = diffGraphDescriptors(
			previous,
			current,
			createGraphSignature(current),
			[
				{
					oldPath: "old.md",
					newPath: "new.md",
					reliability: "reliable",
					source: "vault-event",
				},
			],
		);

		expect(diff.renamedNodes).toEqual([
			{ oldPath: "old.md", newPath: "new.md" },
		]);
		expect(diff.addedNodeIds).toEqual([]);
		expect(diff.removedNodeIds).toEqual([]);
		expect(diff.addedEdges).toEqual([]);
		expect(diff.removedEdges).toEqual([]);
		expect(diff.changedEdgeWeights).toEqual([]);
		expect(diff.isEmpty).toBe(false);
		expect(diff.requiresLayout).toBe(false);
	});

	it("rejects heuristic or colliding rename hints", () => {
		const previous = descriptor(["a.md", "b.md"], []);
		const current = descriptor(["b.md", "c.md"], []);
		const diff = diffGraphDescriptors(
			previous,
			current,
			createGraphSignature(current),
			[
				{
					oldPath: "a.md",
					newPath: "c.md",
					reliability: "heuristic",
				},
				{
					oldPath: "b.md",
					newPath: "c.md",
					reliability: "reliable",
				},
			],
		);
		expect(diff.renamedNodes).toEqual([]);
		expect(diff.rejectedRenameHints).toHaveLength(2);
		expect(diff.addedNodeIds).toEqual(["c.md"]);
		expect(diff.removedNodeIds).toEqual(["a.md"]);
	});

	it("tracks filter-only changes and reports a bounded change ratio", () => {
		const previous = descriptor(["a.md"], [], "one");
		const current = descriptor(["a.md"], [], "two");
		const diff = diffGraphDescriptors(
			previous,
			current,
			createGraphSignature(current),
		);
		expect(diff.filterChanged).toBe(true);
		expect(diff.requiresLayout).toBe(true);
		expect(graphChangeRatio(diff, previous, current)).toBe(0);
	});
});
