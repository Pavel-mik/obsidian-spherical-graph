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
