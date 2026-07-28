import { hashString } from '../geometry/deterministicHash';
import type { GraphData } from '../graph/graphTypes';
import type { DetectedContinent } from './geographyTypes';

export interface WeightedNeighbor {
	readonly index: number;
	readonly weight: number;
}

export interface PartitionFamily {
	readonly partitions: readonly Int32Array[];
}

export interface EvaluatedCandidate extends DetectedContinent {
	readonly cohesion: number;
}

function boundedEdgeWeight(value: number): number {
	return Math.min(4, 0.75 + Math.log1p(Math.max(0, value)));
}

export function buildWeightedAdjacency(
	graph: GraphData,
): WeightedNeighbor[][] {
	const adjacency = Array.from(
		{ length: graph.nodes.length },
		(): WeightedNeighbor[] => [],
	);
	for (const edge of graph.edges) {
		if (
			edge.source === edge.target ||
			edge.source < 0 ||
			edge.target < 0 ||
			edge.source >= graph.nodes.length ||
			edge.target >= graph.nodes.length
		) {
			continue;
		}
		const weight = boundedEdgeWeight(edge.weight);
		adjacency[edge.source]?.push({ index: edge.target, weight });
		adjacency[edge.target]?.push({ index: edge.source, weight });
	}
	return adjacency;
}

export function candidateMetrics(
	graph: GraphData,
	members: readonly number[],
	partitionFamilies: readonly PartitionFamily[],
): {
	readonly stability: number;
	readonly conductance: number;
	readonly cohesion: number;
	readonly score: number;
} {
	const memberSet = new Set(members);
	let internalWeight = 0;
	let boundaryWeight = 0;
	let incidentWeight = 0;
	let internalEdgeCount = 0;
	const stableEdgeTotals = new Float64Array(partitionFamilies.length);
	const internalNeighbors = new Map<number, Set<number>>();
	for (const edge of graph.edges) {
		const sourceInside = memberSet.has(edge.source);
		const targetInside = memberSet.has(edge.target);
		const weight = boundedEdgeWeight(edge.weight);
		if (sourceInside || targetInside) {
			incidentWeight += weight;
		}
		if (sourceInside && targetInside) {
			internalWeight += weight;
			internalEdgeCount += 1;
			const sourceNeighbors =
				internalNeighbors.get(edge.source) ?? new Set<number>();
			sourceNeighbors.add(edge.target);
			internalNeighbors.set(edge.source, sourceNeighbors);
			const targetNeighbors =
				internalNeighbors.get(edge.target) ?? new Set<number>();
			targetNeighbors.add(edge.source);
			internalNeighbors.set(edge.target, targetNeighbors);
			for (
				let familyIndex = 0;
				familyIndex < partitionFamilies.length;
				familyIndex += 1
			) {
				for (
					const partition of
					partitionFamilies[familyIndex]?.partitions ?? []
				) {
					stableEdgeTotals[familyIndex] =
						(stableEdgeTotals[familyIndex] ?? 0) +
						(partition[edge.source] === partition[edge.target]
							? 1
							: 0);
				}
			}
		} else if (sourceInside !== targetInside) {
			boundaryWeight += weight;
		}
	}
	const conductance =
		incidentWeight <= 1e-12
			? 1
			: boundaryWeight /
				Math.max(1e-12, 2 * internalWeight + boundaryWeight);
	let stability = 0;
	if (internalEdgeCount > 0) {
		for (
			let familyIndex = 0;
			familyIndex < partitionFamilies.length;
			familyIndex += 1
		) {
			const runCount =
				partitionFamilies[familyIndex]?.partitions.length ?? 0;
			if (runCount === 0) {
				continue;
			}
			stability = Math.max(
				stability,
				(stableEdgeTotals[familyIndex] ?? 0) /
					(internalEdgeCount * runCount),
			);
		}
	}
	let twoHopCoverage = 0;
	if (members.length > 1) {
		for (const member of members) {
			const reachable = new Set<number>();
			for (const neighbor of internalNeighbors.get(member) ?? []) {
				reachable.add(neighbor);
				for (
					const secondHop of
					internalNeighbors.get(neighbor) ?? []
				) {
					if (secondHop !== member) {
						reachable.add(secondHop);
					}
				}
			}
			twoHopCoverage +=
				reachable.size / Math.max(1, members.length - 1);
		}
		twoHopCoverage /= members.length;
	}
	const edgeSurplus =
		members.length <= 1
			? 0
			: internalEdgeCount / Math.max(1, members.length - 1);
	const cyclicCohesion = Math.min(
		1,
		Math.max(0, (edgeSurplus - 1) / 0.7),
	);
	const cohesion = Math.max(twoHopCoverage, cyclicCohesion);
	const sizeSignal = Math.min(
		1,
		members.length / Math.max(8, graph.nodes.length * 0.18),
	);
	return {
		stability,
		conductance,
		cohesion,
		score:
			stability * 0.4 +
			(1 - conductance) * 0.3 +
			sizeSignal * 0.15 +
			cohesion * 0.15,
	};
}

export function continentId(nodeIds: readonly string[]): string {
	const signature = [...nodeIds].sort().join('\u0000');
	return `continent-${hashString(signature).toString(16).padStart(8, '0')}`;
}
