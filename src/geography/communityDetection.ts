import {
	deterministicPermutation,
	deriveSeed,
	hashString,
} from '../geometry/deterministicHash';
import type { GraphData } from '../graph/graphTypes';
import type {
	CommunityDetectionResult,
	DetectedContinent,
} from './geographyTypes';

interface WeightedNeighbor {
	readonly index: number;
	readonly weight: number;
}

export interface CommunityDetectionOptions {
	readonly resolutions?: readonly number[];
	readonly runsPerResolution?: number;
	readonly consensusThreshold?: number;
	readonly minContinentNodes?: number;
	readonly maxContinents?: number;
	readonly maximumConductance?: number;
}

export const DEFAULT_COMMUNITY_DETECTION_OPTIONS = Object.freeze({
	resolutions: Object.freeze([0.11, 0.18, 0.28]),
	runsPerResolution: 3,
	consensusThreshold: 0.56,
	maxContinents: 7,
	maximumConductance: 0.66,
});

const STRONG_REGION_MAXIMUM_CONDUCTANCE = 0.28;
const STRONG_REGION_MINIMUM_STABILITY = 0.72;

function boundedEdgeWeight(value: number): number {
	return Math.min(4, 0.75 + Math.log1p(Math.max(0, value)));
}

function buildAdjacency(graph: GraphData): WeightedNeighbor[][] {
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

function connectedComponents(
	nodeCount: number,
	edges: readonly (readonly [number, number])[],
): number[][] {
	const neighbors = Array.from({ length: nodeCount }, (): number[] => []);
	for (const [source, target] of edges) {
		neighbors[source]?.push(target);
		neighbors[target]?.push(source);
	}
	const seen = new Uint8Array(nodeCount);
	const components: number[][] = [];
	for (let start = 0; start < nodeCount; start += 1) {
		if (seen[start] === 1) {
			continue;
		}
		const component: number[] = [];
		const queue = [start];
		seen[start] = 1;
		for (let cursor = 0; cursor < queue.length; cursor += 1) {
			const node = queue[cursor];
			if (node === undefined) {
				continue;
			}
			component.push(node);
			for (const neighbor of neighbors[node] ?? []) {
				if (seen[neighbor] === 0) {
					seen[neighbor] = 1;
					queue.push(neighbor);
				}
			}
		}
		components.push(component.sort((left, right) => left - right));
	}
	return components;
}

function candidateMetrics(
	graph: GraphData,
	members: readonly number[],
	partitions: readonly Int32Array[],
): {
	readonly stability: number;
	readonly conductance: number;
	readonly score: number;
} {
	const memberSet = new Set(members);
	let internalWeight = 0;
	let boundaryWeight = 0;
	let incidentWeight = 0;
	let stableEdgeTotal = 0;
	let internalEdgeCount = 0;
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
			for (const partition of partitions) {
				stableEdgeTotal +=
					partition[edge.source] === partition[edge.target] ? 1 : 0;
			}
		} else if (sourceInside !== targetInside) {
			boundaryWeight += weight;
		}
	}
	const conductance =
		incidentWeight <= 1e-12
			? 1
			: boundaryWeight / Math.max(1e-12, 2 * internalWeight + boundaryWeight);
	const stability =
		internalEdgeCount === 0 || partitions.length === 0
			? 0
			: stableEdgeTotal / (internalEdgeCount * partitions.length);
	const sizeSignal = Math.min(
		1,
		members.length / Math.max(8, graph.nodes.length * 0.18),
	);
	return {
		stability,
		conductance,
		score:
			stability * 0.5 +
			(1 - conductance) * 0.35 +
			sizeSignal * 0.15,
	};
}

function continentId(nodeIds: readonly string[]): string {
	const signature = [...nodeIds].sort().join('\u0000');
	return `continent-${hashString(signature).toString(16).padStart(8, '0')}`;
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
		!Number.isSafeInteger(runsPerResolution) ||
		runsPerResolution <= 0 ||
		threshold < 0 ||
		threshold > 1 ||
		minimum < 2 ||
		maxContinents < 1
	) {
		throw new RangeError('Invalid continental community detection options.');
	}

	const adjacency = buildAdjacency(graph);
	const partitions: Int32Array[] = [];
	for (let resolutionIndex = 0; resolutionIndex < resolutions.length; resolutionIndex += 1) {
		const resolution = resolutions[resolutionIndex];
		if (resolution === undefined) {
			continue;
		}
		for (let run = 0; run < runsPerResolution; run += 1) {
			partitions.push(
				localMovingCpmPartition(
					adjacency,
					resolution,
					deriveSeed(seed, resolutionIndex, run, graph.signature),
				),
			);
		}
	}

	const consensusEdges: Array<readonly [number, number]> = [];
	for (const edge of graph.edges) {
		let sameCount = 0;
		for (const partition of partitions) {
			sameCount +=
				partition[edge.source] === partition[edge.target] ? 1 : 0;
		}
		if (sameCount / partitions.length >= threshold) {
			consensusEdges.push([edge.source, edge.target]);
		}
	}

	const candidates = connectedComponents(nodeCount, consensusEdges)
		.filter((members) => members.length >= strongRegionMinimum)
		.map((members) => {
			const nodeIds = members
				.map((index) => graph.nodes[index]?.id)
				.filter((id): id is string => id !== undefined)
				.sort();
			const metrics = candidateMetrics(graph, members, partitions);
			return {
				id: continentId(nodeIds),
				memberIndices: members,
				memberNodeIds: nodeIds,
				...metrics,
			} satisfies DetectedContinent;
		})
		.filter(
			(candidate) => {
				const standardContinent =
					candidate.memberIndices.length >= minimum &&
					candidate.conductance <= maximumConductance &&
					candidate.stability >= 0.5;
				const exceptionallyClearRegion =
					explicitMinimum === undefined &&
					candidate.memberIndices.length >= strongRegionMinimum &&
					candidate.conductance <=
						Math.min(
							maximumConductance,
							STRONG_REGION_MAXIMUM_CONDUCTANCE,
						) &&
					candidate.stability >=
						STRONG_REGION_MINIMUM_STABILITY;
				return standardContinent || exceptionallyClearRegion;
			},
		)
		.sort(
			(left, right) =>
				right.score - left.score ||
				right.memberIndices.length - left.memberIndices.length ||
				left.id.localeCompare(right.id),
		)
		.slice(0, maxContinents)
		.sort(
			(left, right) =>
				(right.memberIndices.length - left.memberIndices.length) ||
				left.id.localeCompare(right.id),
		);

	for (let continentIndex = 0; continentIndex < candidates.length; continentIndex += 1) {
		for (const nodeIndex of candidates[continentIndex]?.memberIndices ?? []) {
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
