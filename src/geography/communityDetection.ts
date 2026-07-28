import {
	deterministicPermutation,
	deriveSeed,
} from '../geometry/deterministicHash';
import type { GraphData } from '../graph/graphTypes';
import { selectContinentalCandidates } from './communityCandidates';
import {
	buildWeightedAdjacency,
	type PartitionFamily,
	type WeightedNeighbor,
} from './communityMetrics';
import type { CommunityDetectionResult } from './geographyTypes';

export interface CommunityDetectionOptions {
	readonly resolutions?: readonly number[];
	readonly runsPerResolution?: number;
	readonly consensusThreshold?: number;
	readonly minContinentNodes?: number;
	readonly maxContinents?: number;
	readonly maximumConductance?: number;
}

export const DEFAULT_COMMUNITY_DETECTION_OPTIONS = Object.freeze({
	resolutions: Object.freeze([0.04, 0.085, 0.16, 0.28]),
	runsPerResolution: 3,
	consensusThreshold: 0.56,
	maxContinents: 7,
	maximumConductance: 0.66,
});

function compactPartition(labels: Int32Array): Int32Array {
	const membersByLabel = new Map<number, number[]>();
	for (let index = 0; index < labels.length; index += 1) {
		const label = labels[index] ?? index;
		const members = membersByLabel.get(label) ?? [];
		members.push(index);
		membersByLabel.set(label, members);
	}
	const groups = [...membersByLabel.values()].sort(
		(left, right) => (left[0] ?? 0) - (right[0] ?? 0),
	);
	const result = new Int32Array(labels.length);
	for (let community = 0; community < groups.length; community += 1) {
		for (const nodeIndex of groups[community] ?? []) {
			result[nodeIndex] = community;
		}
	}
	return result;
}

/**
 * Deterministic local-moving optimizer for the Constant Potts Model.
 *
 * The quality function is `sum(internal weight - gamma * possible pairs)`.
 * Unlike modularity, CPM does not suffer from a graph-size resolution limit;
 * running it at several gamma values gives the hierarchy used by consensus.
 */
export function localMovingCpmPartition(
	adjacency: readonly (readonly WeightedNeighbor[])[],
	resolution: number,
	seed: number,
): Int32Array {
	if (!Number.isFinite(resolution) || resolution <= 0) {
		throw new RangeError('CPM resolution must be finite and positive.');
	}
	const nodeCount = adjacency.length;
	const labels = new Int32Array(nodeCount);
	const sizes = new Int32Array(nodeCount);
	for (let index = 0; index < nodeCount; index += 1) {
		labels[index] = index;
		sizes[index] = 1;
	}

	for (let pass = 0; pass < 32; pass += 1) {
		let moved = false;
		const order = deterministicPermutation(
			nodeCount,
			deriveSeed(seed, pass, nodeCount),
		);
		for (const nodeIndex of order) {
			const current = labels[nodeIndex] ?? nodeIndex;
			const weightByCommunity = new Map<number, number>();
			for (const neighbor of adjacency[nodeIndex] ?? []) {
				const community = labels[neighbor.index] ?? neighbor.index;
				weightByCommunity.set(
					community,
					(weightByCommunity.get(community) ?? 0) + neighbor.weight,
				);
			}
			const currentInternalWeight =
				weightByCommunity.get(current) ?? 0;
			const removeTerm =
				currentInternalWeight -
				resolution * Math.max(0, (sizes[current] ?? 1) - 1);
			let bestCommunity = current;
			let bestGain = 1e-10;
			for (const [candidate, incidentWeight] of weightByCommunity) {
				if (candidate === current || (sizes[candidate] ?? 0) <= 0) {
					continue;
				}
				const gain =
					incidentWeight -
					resolution * (sizes[candidate] ?? 0) -
					removeTerm;
				if (
					gain > bestGain + 1e-10 ||
					(Math.abs(gain - bestGain) <= 1e-10 &&
						candidate < bestCommunity)
				) {
					bestGain = gain;
					bestCommunity = candidate;
				}
			}
			if (bestCommunity !== current) {
				sizes[current] = Math.max(0, (sizes[current] ?? 1) - 1);
				sizes[bestCommunity] = (sizes[bestCommunity] ?? 0) + 1;
				labels[nodeIndex] = bestCommunity;
				moved = true;
			}
		}
		if (!moved) {
			break;
		}
	}
	return compactPartition(labels);
}

function automaticMinimum(nodeCount: number): number {
	return Math.max(
		6,
		Math.min(18, Math.ceil(Math.sqrt(nodeCount) * 0.62)),
	);
}

function automaticStrongRegionMinimum(nodeCount: number): number {
	return Math.max(
		6,
		Math.min(12, Math.ceil(Math.sqrt(nodeCount) * 0.42)),
	);
}

/**
 * Finds large, stable, low-conductance communities without forcing every note
 * into a continent. Consensus is formed only along real graph edges, so every
 * accepted landmass remains topologically connected.
 */
export function detectContinentalCommunities(
	graph: GraphData,
	seed: number,
	options: CommunityDetectionOptions = {},
): CommunityDetectionResult {
	const nodeCount = graph.nodes.length;
	const assignmentByNode = new Int32Array(nodeCount);
	assignmentByNode.fill(-1);
	if (nodeCount === 0) {
		return {
			continents: [],
			islandNodeIndices: [],
			assignmentByNode,
		};
	}

	const resolutions =
		options.resolutions ??
		DEFAULT_COMMUNITY_DETECTION_OPTIONS.resolutions;
	const runsPerResolution =
		options.runsPerResolution ??
		DEFAULT_COMMUNITY_DETECTION_OPTIONS.runsPerResolution;
	const threshold =
		options.consensusThreshold ??
		DEFAULT_COMMUNITY_DETECTION_OPTIONS.consensusThreshold;
	const explicitMinimum = options.minContinentNodes;
	const minimum = explicitMinimum ?? automaticMinimum(nodeCount);
	const strongRegionMinimum =
		explicitMinimum ?? automaticStrongRegionMinimum(nodeCount);
	const maxContinents =
		options.maxContinents ??
		DEFAULT_COMMUNITY_DETECTION_OPTIONS.maxContinents;
	const maximumConductance =
		options.maximumConductance ??
		DEFAULT_COMMUNITY_DETECTION_OPTIONS.maximumConductance;
	if (
		resolutions.length === 0 ||
		resolutions.some(
			(resolution) =>
				!Number.isFinite(resolution) || resolution <= 0,
		) ||
		!Number.isSafeInteger(runsPerResolution) ||
		runsPerResolution <= 0 ||
		threshold < 0 ||
		threshold > 1 ||
		minimum < 2 ||
		maxContinents < 1
	) {
		throw new RangeError('Invalid continental community detection options.');
	}

	const adjacency = buildWeightedAdjacency(graph);
	const partitionFamilies: PartitionFamily[] = [];
	for (
		let resolutionIndex = 0;
		resolutionIndex < resolutions.length;
		resolutionIndex += 1
	) {
		const resolution = resolutions[resolutionIndex];
		if (resolution === undefined) {
			continue;
		}
		const partitions: Int32Array[] = [];
		for (let run = 0; run < runsPerResolution; run += 1) {
			partitions.push(
				localMovingCpmPartition(
					adjacency,
					resolution,
					deriveSeed(
						seed,
						resolutionIndex,
						run,
						graph.signature,
					),
				),
			);
		}
		partitionFamilies.push({ partitions });
	}

	const candidates = selectContinentalCandidates(
		graph,
		partitionFamilies,
		threshold,
		{
			minimum,
			strongRegionMinimum,
			maxContinents,
			maximumConductance,
			explicitMinimum,
		},
	);
	for (
		let continentIndex = 0;
		continentIndex < candidates.length;
		continentIndex += 1
	) {
		for (
			const nodeIndex of
			candidates[continentIndex]?.memberIndices ?? []
		) {
			assignmentByNode[nodeIndex] = continentIndex;
		}
	}
	const islandNodeIndices: number[] = [];
	for (let index = 0; index < nodeCount; index += 1) {
		if (assignmentByNode[index] === -1) {
			islandNodeIndices.push(index);
		}
	}
	return {
		continents: candidates,
		islandNodeIndices,
		assignmentByNode,
	};
}
