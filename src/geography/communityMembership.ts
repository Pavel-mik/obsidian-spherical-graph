import type { GraphData } from '../graph/graphTypes';
import {
	buildWeightedAdjacency,
	candidateMetrics,
	continentId,
	type EvaluatedCandidate,
	type PartitionFamily,
} from './communityMetrics';

const MEMBERSHIP_AFFINITY_SHARE = 0.56;
const MEMBERSHIP_AFFINITY_DOMINANCE = 1.35;
const MEMBERSHIP_AFFINITY_MINIMUM_WEIGHT = 2.4;

export function completeCandidateMembership(
	graph: GraphData,
	candidates: readonly EvaluatedCandidate[],
	partitionFamilies: readonly PartitionFamily[],
): readonly EvaluatedCandidate[] {
	if (candidates.length === 0) {
		return [];
	}
	const adjacency = buildWeightedAdjacency(graph);
	const memberSets = candidates.map(
		(candidate) => new Set(candidate.memberIndices),
	);
	const assignment = new Int32Array(graph.nodes.length);
	assignment.fill(-1);
	for (
		let continentIndex = 0;
		continentIndex < memberSets.length;
		continentIndex += 1
	) {
		for (const member of memberSets[continentIndex] ?? []) {
			assignment[member] = continentIndex;
		}
	}

	for (let pass = 0; pass < 4; pass += 1) {
		const proposals: Array<readonly [number, number]> = [];
		for (let nodeIndex = 0; nodeIndex < graph.nodes.length; nodeIndex += 1) {
			if (assignment[nodeIndex] !== -1) {
				continue;
			}
			const weights = new Float64Array(candidates.length);
			const neighborCounts = new Uint16Array(candidates.length);
			let totalWeight = 0;
			for (const neighbor of adjacency[nodeIndex] ?? []) {
				totalWeight += neighbor.weight;
				const owner = assignment[neighbor.index] ?? -1;
				if (owner < 0) {
					continue;
				}
				weights[owner] =
					(weights[owner] ?? 0) + neighbor.weight;
				neighborCounts[owner] =
					(neighborCounts[owner] ?? 0) + 1;
			}
			let bestOwner = -1;
			let bestWeight = 0;
			let secondWeight = 0;
			for (let owner = 0; owner < weights.length; owner += 1) {
				const weight = weights[owner] ?? 0;
				if (weight > bestWeight) {
					secondWeight = bestWeight;
					bestWeight = weight;
					bestOwner = owner;
				} else if (weight > secondWeight) {
					secondWeight = weight;
				}
			}
			if (
				bestOwner >= 0 &&
				(neighborCounts[bestOwner] ?? 0) >= 2 &&
				bestWeight >= MEMBERSHIP_AFFINITY_MINIMUM_WEIGHT &&
				bestWeight / Math.max(1e-12, totalWeight) >=
					MEMBERSHIP_AFFINITY_SHARE &&
				bestWeight >=
					Math.max(
						MEMBERSHIP_AFFINITY_MINIMUM_WEIGHT,
						secondWeight * MEMBERSHIP_AFFINITY_DOMINANCE,
					)
			) {
				proposals.push([nodeIndex, bestOwner]);
			}
		}
		if (proposals.length === 0) {
			break;
		}
		for (const [nodeIndex, owner] of proposals) {
			assignment[nodeIndex] = owner;
			memberSets[owner]?.add(nodeIndex);
		}
	}

	return memberSets.map((members) => {
		const memberIndices = [...members].sort((left, right) => left - right);
		const memberNodeIds = memberIndices
			.map((index) => graph.nodes[index]?.id)
			.filter((id): id is string => id !== undefined)
			.sort();
		return {
			id: continentId(memberNodeIds),
			memberIndices,
			memberNodeIds,
			...candidateMetrics(
				graph,
				memberIndices,
				partitionFamilies,
			),
		};
	});
}
