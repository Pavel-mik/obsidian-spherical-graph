import { describe, expect, it } from 'vitest';
import {
	detectContinentalCommunities,
	localMovingCpmPartition,
} from '../../src/geography/communityDetection';
import type {
	GraphData,
	GraphDescriptorEdge,
	GraphEdge,
	GraphNode,
} from '../../src/graph/graphTypes';

function graphWithGroups(
	groupSizes: readonly number[],
	connectGroups = true,
	islandCount = 0,
): GraphData {
	const nodes: GraphNode[] = [];
	const edges: GraphEdge[] = [];
	let offset = 0;
	for (let groupIndex = 0; groupIndex < groupSizes.length; groupIndex += 1) {
		const size = groupSizes[groupIndex] ?? 0;
		for (let local = 0; local < size; local += 1) {
			const index = offset + local;
			nodes.push({
				index,
				id: `group-${groupIndex}/note-${local}.md`,
				path: `group-${groupIndex}/note-${local}.md`,
				basename: `note-${local}`,
				degree: 0,
				weightedDegree: 0,
				exists: true,
			});
		}
		for (let left = 0; left < size; left += 1) {
			for (let right = left + 1; right < size; right += 1) {
				edges.push({
					source: offset + left,
					target: offset + right,
					weight: 1,
					forwardWeight: 1,
					backwardWeight: 0,
				});
			}
		}
		offset += size;
	}
	if (connectGroups) {
		offset = 0;
		for (let groupIndex = 0; groupIndex + 1 < groupSizes.length; groupIndex += 1) {
			const nextOffset = offset + (groupSizes[groupIndex] ?? 0);
			edges.push({
				source: offset,
				target: nextOffset,
				weight: 1,
				forwardWeight: 1,
				backwardWeight: 0,
			});
			offset = nextOffset;
		}
	}
	for (let island = 0; island < islandCount; island += 1) {
		const index = nodes.length;
		nodes.push({
			index,
			id: `islands/note-${island}.md`,
			path: `islands/note-${island}.md`,
			basename: `island-${island}`,
			degree: 0,
			weightedDegree: 0,
			exists: true,
		});
	}
	const degrees = new Uint32Array(nodes.length);
	for (const edge of edges) {
		degrees[edge.source] = (degrees[edge.source] ?? 0) + 1;
		degrees[edge.target] = (degrees[edge.target] ?? 0) + 1;
	}
	const completedNodes = nodes.map((node) => ({
		...node,
		degree: degrees[node.index] ?? 0,
		weightedDegree: degrees[node.index] ?? 0,
	}));
	const descriptorEdges: GraphDescriptorEdge[] = edges.map((edge) => ({
		sourceId: completedNodes[edge.source]?.id ?? '',
		targetId: completedNodes[edge.target]?.id ?? '',
		weight: edge.weight,
		forwardWeight: edge.forwardWeight,
		backwardWeight: edge.backwardWeight,
	}));
	return {
		nodes: completedNodes,
		edges,
		signature: 'fixture',
		filterSignature: 'fixture-filter',
		descriptor: {
			nodeIds: completedNodes.map((node) => node.id),
			edges: descriptorEdges,
			filterSignature: 'fixture-filter',
		},
	};
}

function graphWithSparseChain(
	componentSize: number,
	islandCount: number,
): GraphData {
	const graph = graphWithGroups([], false, componentSize + islandCount);
	const edges: GraphEdge[] = [];
	for (let index = 0; index + 1 < componentSize; index += 1) {
		edges.push({
			source: index,
			target: index + 1,
			weight: 1,
			forwardWeight: 1,
			backwardWeight: 0,
		});
	}
	const degrees = new Uint32Array(graph.nodes.length);
	for (const edge of edges) {
		degrees[edge.source] = (degrees[edge.source] ?? 0) + 1;
		degrees[edge.target] = (degrees[edge.target] ?? 0) + 1;
	}
	const nodes = graph.nodes.map((node) => ({
		...node,
		degree: degrees[node.index] ?? 0,
		weightedDegree: degrees[node.index] ?? 0,
	}));
	return {
		...graph,
		nodes,
		edges,
		descriptor: {
			...graph.descriptor,
			edges: edges.map((edge) => ({
				sourceId: nodes[edge.source]?.id ?? '',
				targetId: nodes[edge.target]?.id ?? '',
				weight: edge.weight,
				forwardWeight: edge.forwardWeight,
				backwardWeight: edge.backwardWeight,
			})),
		},
	};
}

function graphWithCustomEdges(
	nodeCount: number,
	edges: readonly GraphEdge[],
): GraphData {
	const graph = graphWithGroups([], false, nodeCount);
	const degrees = new Uint32Array(nodeCount);
	for (const edge of edges) {
		degrees[edge.source] = (degrees[edge.source] ?? 0) + 1;
		degrees[edge.target] = (degrees[edge.target] ?? 0) + 1;
	}
	const nodes = graph.nodes.map((node) => ({
		...node,
		degree: degrees[node.index] ?? 0,
		weightedDegree: degrees[node.index] ?? 0,
	}));
	return {
		...graph,
		nodes,
		edges,
		descriptor: {
			...graph.descriptor,
			edges: edges.map((edge) => ({
				sourceId: nodes[edge.source]?.id ?? '',
				targetId: nodes[edge.target]?.id ?? '',
				weight: edge.weight,
				forwardWeight: edge.forwardWeight,
				backwardWeight: edge.backwardWeight,
			})),
		},
	};
}

function edge(source: number, target: number): GraphEdge {
	return {
		source,
		target,
		weight: 1,
		forwardWeight: 1,
		backwardWeight: 0,
	};
}

describe('continental community detection', () => {
	it('separates dense regions joined by only a few outgoing roads', () => {
		const graph = graphWithGroups([10, 11, 9]);
		const result = detectContinentalCommunities(graph, 42, {
			minContinentNodes: 6,
			maxContinents: 6,
		});

		expect(result.continents).toHaveLength(3);
		expect(
			result.continents.map((continent) => continent.memberIndices.length),
		).toEqual([11, 10, 9]);
		expect(result.continents.every((continent) => continent.conductance < 0.1)).toBe(true);
		expect(result.islandNodeIndices).toEqual([]);
	});

	it('is deterministic and never assigns a node to overlapping continents', () => {
		const graph = graphWithGroups([8, 8, 5]);
		const first = detectContinentalCommunities(graph, 123, {
			minContinentNodes: 6,
		});
		const second = detectContinentalCommunities(graph, 123, {
			minContinentNodes: 6,
		});

		expect(
			first.continents.map((continent) => ({
				id: continent.id,
				members: continent.memberIndices,
			})),
		).toEqual(
			second.continents.map((continent) => ({
				id: continent.id,
				members: continent.memberIndices,
			})),
		);
		const assigned = new Set<number>();
		for (const continent of first.continents) {
			for (const member of continent.memberIndices) {
				expect(assigned.has(member)).toBe(false);
				assigned.add(member);
			}
		}
		expect(first.islandNodeIndices).toHaveLength(5);
	});

	it('keeps undersized sparse components as islands', () => {
		const graph = graphWithGroups([5], false);
		const result = detectContinentalCommunities(graph, 7, {
			minContinentNodes: 6,
		});
		expect(result.continents).toEqual([]);
		expect(result.islandNodeIndices).toEqual([0, 1, 2, 3, 4]);
	});

	it('recovers exceptionally clear smaller regions in a 636-note vault', () => {
		const graph = graphWithGroups(
			[40, 36, 18, 15, 12],
			true,
			515,
		);
		const result = detectContinentalCommunities(graph, 42);

		expect(graph.nodes).toHaveLength(636);
		expect(
			result.continents.map((continent) => continent.memberIndices.length),
		).toEqual([40, 36, 18, 15, 12]);
		expect(result.islandNodeIndices).toHaveLength(515);
		expect(
			result.continents
				.slice(3)
				.every(
					(continent) =>
						continent.stability >= 0.72 &&
						continent.conductance <= 0.28,
				),
		).toBe(true);
	});

	it('recovers a visually prominent hub community at an appropriate coarse scale', () => {
		const edges = Array.from(
			{ length: 23 },
			(_, index) => edge(0, index + 1),
		);
		const graph = graphWithCustomEdges(636, edges);
		const result = detectContinentalCommunities(graph, 42);

		expect(
			result.continents.map((continent) => continent.memberIndices.length),
		).toContain(24);
		expect(result.continents[0]?.memberIndices).toEqual(
			Array.from({ length: 24 }, (_, index) => index),
		);
	});

	it('keeps several prominent community shapes without promoting a sparse chain', () => {
		const edges: GraphEdge[] = [];
		for (let member = 1; member < 24; member += 1) {
			edges.push(edge(0, member));
		}
		for (let member = 25; member < 42; member += 1) {
			edges.push(edge(24, member));
		}
		for (let left = 42; left < 62; left += 1) {
			for (let right = left + 1; right < 62; right += 1) {
				edges.push(edge(left, right));
			}
		}
		for (let member = 62; member + 1 < 77; member += 1) {
			edges.push(edge(member, member + 1));
		}
		edges.push(edge(0, 42), edge(24, 43), edge(62, 44));
		const graph = graphWithCustomEdges(636, edges);
		const result = detectContinentalCommunities(graph, 114);
		const sizes = result.continents.map(
			(continent) => continent.memberIndices.length,
		);

		expect(sizes).toEqual([24, 20, 18]);
		expect(result.assignmentByNode[76]).toBe(-1);
	});

	it('completes a high-resolution boundary node with two clear internal neighbors', () => {
		const firstCore = graphWithGroups([14], false);
		const edges = [
			...firstCore.edges,
			edge(0, 14),
			edge(1, 14),
		];
		const graph = graphWithCustomEdges(15, edges);
		const result = detectContinentalCommunities(graph, 73, {
			minContinentNodes: 6,
			resolutions: [0.55],
		});
		const owner = result.assignmentByNode[14] ?? -1;

		expect(owner).toBeGreaterThanOrEqual(0);
		expect(
			result.continents[owner]?.memberIndices.slice(0, 14),
		).toEqual(Array.from({ length: 14 }, (_, index) => index));
		expect(result.continents[owner]?.memberIndices).toContain(14);
	});

	it('does not promote a sparse large-vault chain through the strong-region path', () => {
		const graph = graphWithSparseChain(15, 621);
		const result = detectContinentalCommunities(graph, 42);

		expect(result.continents).toEqual([]);
		expect(result.islandNodeIndices).toHaveLength(636);
	});

	it('honors an explicit minimum without the automatic strong-region rescue', () => {
		const graph = graphWithGroups(
			[40, 36, 18, 15, 12],
			true,
			515,
		);
		const result = detectContinentalCommunities(graph, 42, {
			minContinentNodes: 24,
		});

		expect(
			result.continents.map((continent) => continent.memberIndices.length),
		).toEqual([40, 36]);
	});

	it('optimizes CPM without relying on mutable random state', () => {
		const adjacency = [
			[{ index: 1, weight: 1 }],
			[
				{ index: 0, weight: 1 },
				{ index: 2, weight: 0.05 },
			],
			[
				{ index: 1, weight: 0.05 },
				{ index: 3, weight: 1 },
			],
			[{ index: 2, weight: 1 }],
		];
		expect(localMovingCpmPartition(adjacency, 0.3, 9)).toEqual(
			localMovingCpmPartition(adjacency, 0.3, 9),
		);
	});
});
