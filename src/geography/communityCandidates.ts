import type { GraphData } from '../graph/graphTypes';
import { completeCandidateMembership } from './communityMembership';
import {
	candidateMetrics,
	continentId,
	type EvaluatedCandidate,
	type PartitionFamily,
} from './communityMetrics';
import type { DetectedContinent } from './geographyTypes';

const STRONG_REGION_MAXIMUM_CONDUCTANCE = 0.28;
const STRONG_REGION_MINIMUM_STABILITY = 0.72;
const MINIMUM_TOPOLOGICAL_COHESION = 0.34;

export interface ContinentalCandidateSelectionOptions {
	readonly minimum: number;
	readonly strongRegionMinimum: number;
	readonly maxContinents: number;
	readonly maximumConductance: number;
	readonly explicitMinimum: number | undefined;
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

function consensusMemberSets(
	graph: GraphData,
	partitionFamilies: readonly PartitionFamily[],
	threshold: number,
): readonly number[][] {
	const unique = new Map<string, number[]>();
	const addComponents = (partitions: readonly Int32Array[]): void => {
		if (partitions.length === 0) {
			return;
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
		for (
			const members of
			connectedComponents(graph.nodes.length, consensusEdges)
		) {
			unique.set(members.join(','), members);
		}
	};
	for (const family of partitionFamilies) {
		addComponents(family.partitions);
	}
	addComponents(
		partitionFamilies.flatMap((family) => family.partitions),
	);
	return [...unique.values()];
}

function isSubset(
	subset: readonly number[],
	superset: ReadonlySet<number>,
): boolean {
	return subset.every((member) => superset.has(member));
}

function removeIncompleteVariants(
	candidates: readonly EvaluatedCandidate[],
): readonly EvaluatedCandidate[] {
	const membersByCandidate = new Map(
		candidates.map(
			(candidate) =>
				[candidate, new Set(candidate.memberIndices)] as const,
		),
	);
	return candidates.filter((candidate) => {
		for (const alternative of candidates) {
			if (
				alternative === candidate ||
				alternative.memberIndices.length <=
					candidate.memberIndices.length ||
				alternative.score + 0.06 < candidate.score
			) {
				continue;
			}
			if (
				isSubset(
					candidate.memberIndices,
					membersByCandidate.get(alternative) ??
						new Set(alternative.memberIndices),
				)
			) {
				return false;
			}
		}
		return true;
	});
}

function removeSplittableParents(
	candidates: readonly EvaluatedCandidate[],
): readonly EvaluatedCandidate[] {
	return candidates.filter((parent) => {
		const parentMembers = new Set(parent.memberIndices);
		const children = candidates
			.filter(
				(candidate) =>
					candidate !== parent &&
					candidate.memberIndices.length <
						parent.memberIndices.length &&
					candidate.score + 0.12 >= parent.score &&
					isSubset(candidate.memberIndices, parentMembers),
			)
			.sort(
				(left, right) =>
					right.score - left.score ||
					right.memberIndices.length -
						left.memberIndices.length ||
					left.id.localeCompare(right.id),
			);
		const covered = new Set<number>();
		let childCount = 0;
		for (const child of children) {
			if (child.memberIndices.some((member) => covered.has(member))) {
				continue;
			}
			for (const member of child.memberIndices) {
				covered.add(member);
			}
			childCount += 1;
		}
		return !(
			childCount >= 2 &&
			covered.size >= parent.memberIndices.length * 0.82
		);
	});
}

function selectDisjointCandidates(
	candidates: readonly EvaluatedCandidate[],
	maxContinents: number,
): readonly EvaluatedCandidate[] {
	const selected: EvaluatedCandidate[] = [];
	const assigned = new Set<number>();
	for (
		const candidate of
		[...candidates].sort(
			(left, right) =>
				right.score - left.score ||
				right.memberIndices.length - left.memberIndices.length ||
				left.id.localeCompare(right.id),
		)
	) {
		if (
			selected.length >= maxContinents ||
			candidate.memberIndices.some((member) => assigned.has(member))
		) {
			continue;
		}
		selected.push(candidate);
		for (const member of candidate.memberIndices) {
			assigned.add(member);
		}
	}
	return selected;
}

export function selectContinentalCandidates(
	graph: GraphData,
	partitionFamilies: readonly PartitionFamily[],
	consensusThreshold: number,
	options: ContinentalCandidateSelectionOptions,
): readonly DetectedContinent[] {
	const evaluatedCandidates = consensusMemberSets(
		graph,
		partitionFamilies,
		consensusThreshold,
	)
		.filter(
			(members) =>
				members.length >= options.strongRegionMinimum,
		)
		.map((members) => {
			const memberNodeIds = members
				.map((index) => graph.nodes[index]?.id)
				.filter((id): id is string => id !== undefined)
				.sort();
			return {
				id: continentId(memberNodeIds),
				memberIndices: members,
				memberNodeIds,
				...candidateMetrics(
					graph,
					members,
					partitionFamilies,
				),
			} satisfies EvaluatedCandidate;
		})
		.filter((candidate) => {
			const standardContinent =
				candidate.memberIndices.length >= options.minimum &&
				candidate.conductance <= options.maximumConductance &&
				candidate.stability >= 0.5 &&
				candidate.cohesion >= MINIMUM_TOPOLOGICAL_COHESION;
			const exceptionallyClearRegion =
				options.explicitMinimum === undefined &&
				candidate.memberIndices.length >=
					options.strongRegionMinimum &&
				candidate.conductance <=
					Math.min(
						options.maximumConductance,
						STRONG_REGION_MAXIMUM_CONDUCTANCE,
					) &&
				candidate.stability >=
					STRONG_REGION_MINIMUM_STABILITY &&
				candidate.cohesion >= MINIMUM_TOPOLOGICAL_COHESION;
			return standardContinent || exceptionallyClearRegion;
		});
	const hierarchyPruned =
		removeSplittableParents(evaluatedCandidates);
	const completeVariants = removeIncompleteVariants(hierarchyPruned);
	const selected = selectDisjointCandidates(
		completeVariants,
		options.maxContinents,
	);
	return [
		...completeCandidateMembership(
			graph,
			selected,
			partitionFamilies,
		),
	].sort(
		(left, right) =>
			right.memberIndices.length - left.memberIndices.length ||
			left.id.localeCompare(right.id),
	);
}
