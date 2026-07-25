import { compareGraphIds } from "./graphFilters";
import { GraphDescriptor, GraphDescriptorEdge } from "./graphTypes";

export type RenameHintReliability = "reliable" | "heuristic";

export interface GraphRenameHint {
	readonly oldPath: string;
	readonly newPath: string;
	readonly reliability: RenameHintReliability;
	readonly source?: "vault-event" | "external";
}

export interface GraphRename {
	readonly oldPath: string;
	readonly newPath: string;
}

export interface GraphDiffEdge {
	readonly sourceId: string;
	readonly targetId: string;
	readonly weight: number;
	readonly forwardWeight: number;
	readonly backwardWeight: number;
}

export interface GraphEdgeWeightChange {
	readonly sourceId: string;
	readonly targetId: string;
	readonly previousWeight: number;
	readonly currentWeight: number;
	readonly previousForwardWeight: number;
	readonly currentForwardWeight: number;
	readonly previousBackwardWeight: number;
	readonly currentBackwardWeight: number;
}

export interface GraphDiffSummary {
	readonly addedNodeIds: readonly string[];
	readonly removedNodeIds: readonly string[];
	readonly renamedNodes: readonly GraphRename[];
	readonly addedEdgeCount: number;
	readonly removedEdgeCount: number;
	readonly changedEdgeWeightCount: number;
	readonly filterChanged: boolean;
}

export interface GraphDiff {
	readonly previousSignature?: string;
	readonly currentSignature: string;
	readonly addedNodeIds: readonly string[];
	readonly removedNodeIds: readonly string[];
	readonly renamedNodes: readonly GraphRename[];
	readonly rejectedRenameHints: readonly GraphRenameHint[];
	readonly addedEdges: readonly GraphDiffEdge[];
	readonly removedEdges: readonly GraphDiffEdge[];
	readonly changedEdgeWeights: readonly GraphEdgeWeightChange[];
	readonly filterChanged: boolean;
	readonly affectedNodeIds: readonly string[];
	readonly isEmpty: boolean;
	/**
	 * A reliable pure rename is a persisted-key migration, not a reason to run
	 * the spherical solver. `requiresLayout` captures that distinction.
	 */
	readonly requiresLayout: boolean;
	readonly linkChangeCount: number;
	readonly summary: GraphDiffSummary;
}

interface AcceptedRenames {
	readonly renames: readonly GraphRename[];
	readonly rejected: readonly GraphRenameHint[];
	readonly pathMap: ReadonlyMap<string, string>;
}

function edgeKey(sourceId: string, targetId: string): string {
	return `${sourceId.length}:${sourceId}${targetId}`;
}

function compareEdges(
	left: Pick<GraphDescriptorEdge, "sourceId" | "targetId">,
	right: Pick<GraphDescriptorEdge, "sourceId" | "targetId">,
): number {
	const sourceOrder = compareGraphIds(left.sourceId, right.sourceId);
	return sourceOrder === 0
		? compareGraphIds(left.targetId, right.targetId)
		: sourceOrder;
}

function acceptReliableRenames(
	previous: GraphDescriptor | undefined,
	current: GraphDescriptor,
	hints: readonly GraphRenameHint[],
): AcceptedRenames {
	if (previous === undefined) {
		return {
			renames: Object.freeze([]),
			rejected: Object.freeze([...hints]),
			pathMap: new Map(),
		};
	}

	const previousIds = new Set(previous.nodeIds);
	const currentIds = new Set(current.nodeIds);
	const claimedOldPaths = new Set<string>();
	const claimedNewPaths = new Set<string>();
	const accepted: GraphRename[] = [];
	const rejected: GraphRenameHint[] = [];
	const sortedHints = [...hints].sort((left, right) => {
		const oldOrder = compareGraphIds(left.oldPath, right.oldPath);
		return oldOrder === 0
			? compareGraphIds(left.newPath, right.newPath)
			: oldOrder;
	});

	for (const hint of sortedHints) {
		const isValid =
			hint.reliability === "reliable" &&
			hint.oldPath !== hint.newPath &&
			previousIds.has(hint.oldPath) &&
			!currentIds.has(hint.oldPath) &&
			currentIds.has(hint.newPath) &&
			!previousIds.has(hint.newPath) &&
			!claimedOldPaths.has(hint.oldPath) &&
			!claimedNewPaths.has(hint.newPath);
		if (!isValid) {
			rejected.push(hint);
			continue;
		}
		claimedOldPaths.add(hint.oldPath);
		claimedNewPaths.add(hint.newPath);
		accepted.push(
			Object.freeze({
				oldPath: hint.oldPath,
				newPath: hint.newPath,
			}),
		);
	}

	return {
		renames: Object.freeze(accepted),
		rejected: Object.freeze(rejected),
		pathMap: new Map(
			accepted.map((rename) => [rename.oldPath, rename.newPath] as const),
		),
	};
}

function remapEdge(
	edge: GraphDescriptorEdge,
	pathMap: ReadonlyMap<string, string>,
): GraphDescriptorEdge | undefined {
	const mappedSource = pathMap.get(edge.sourceId) ?? edge.sourceId;
	const mappedTarget = pathMap.get(edge.targetId) ?? edge.targetId;
	if (mappedSource === mappedTarget) {
		return undefined;
	}
	if (compareGraphIds(mappedSource, mappedTarget) < 0) {
		return {
			sourceId: mappedSource,
			targetId: mappedTarget,
			weight: edge.weight,
			forwardWeight: edge.forwardWeight,
			backwardWeight: edge.backwardWeight,
		};
	}
	return {
		sourceId: mappedTarget,
		targetId: mappedSource,
		weight: edge.weight,
		forwardWeight: edge.backwardWeight,
		backwardWeight: edge.forwardWeight,
	};
}

function mergeDescriptorEdges(
	edges: readonly GraphDescriptorEdge[],
	pathMap: ReadonlyMap<string, string>,
): readonly GraphDescriptorEdge[] {
	const merged = new Map<string, GraphDescriptorEdge>();
	for (const edge of edges) {
		const remapped = remapEdge(edge, pathMap);
		if (remapped === undefined) {
			continue;
		}
		const key = edgeKey(remapped.sourceId, remapped.targetId);
		const existing = merged.get(key);
		merged.set(
			key,
			existing === undefined
				? remapped
				: {
						sourceId: remapped.sourceId,
						targetId: remapped.targetId,
						weight: existing.weight + remapped.weight,
						forwardWeight:
							existing.forwardWeight + remapped.forwardWeight,
						backwardWeight:
							existing.backwardWeight + remapped.backwardWeight,
					},
		);
	}
	return [...merged.values()].sort(compareEdges);
}

export function applyRenameMapToDescriptor(
	descriptor: GraphDescriptor,
	pathMap: ReadonlyMap<string, string>,
): GraphDescriptor {
	const nodeIds = [...descriptor.nodeIds]
		.map((id) => pathMap.get(id) ?? id)
		.sort(compareGraphIds);
	return {
		nodeIds: Object.freeze([...new Set(nodeIds)]),
		edges: Object.freeze(
			mergeDescriptorEdges(descriptor.edges, pathMap).map((edge) =>
				Object.freeze({ ...edge }),
			),
		),
		filterSignature: descriptor.filterSignature,
	};
}

function edgeMap(
	edges: readonly GraphDescriptorEdge[],
): ReadonlyMap<string, GraphDescriptorEdge> {
	return new Map(
		edges.map((edge) => [edgeKey(edge.sourceId, edge.targetId), edge]),
	);
}

function toDiffEdge(edge: GraphDescriptorEdge): GraphDiffEdge {
	return Object.freeze({
		sourceId: edge.sourceId,
		targetId: edge.targetId,
		weight: edge.weight,
		forwardWeight: edge.forwardWeight,
		backwardWeight: edge.backwardWeight,
	});
}

export function diffGraphDescriptors(
	previous: GraphDescriptor | undefined,
	current: GraphDescriptor,
	currentSignature: string,
	renameHints: readonly GraphRenameHint[] = [],
	previousSignature?: string,
): GraphDiff {
	const accepted = acceptReliableRenames(previous, current, renameHints);
	const remappedPrevious =
		previous === undefined
			? undefined
			: applyRenameMapToDescriptor(previous, accepted.pathMap);
	const previousNodes = new Set(remappedPrevious?.nodeIds ?? []);
	const currentNodes = new Set(current.nodeIds);
	const addedNodeIds = current.nodeIds
		.filter((id) => !previousNodes.has(id))
		.sort(compareGraphIds);
	const removedNodeIds = [...previousNodes]
		.filter((id) => !currentNodes.has(id))
		.sort(compareGraphIds);

	const oldEdges = edgeMap(remappedPrevious?.edges ?? []);
	const newEdges = edgeMap(current.edges);
	const addedEdges: GraphDiffEdge[] = [];
	const removedEdges: GraphDiffEdge[] = [];
	const changedEdgeWeights: GraphEdgeWeightChange[] = [];

	for (const [key, edge] of newEdges) {
		const prior = oldEdges.get(key);
		if (prior === undefined) {
			addedEdges.push(toDiffEdge(edge));
			continue;
		}
		if (
			prior.weight !== edge.weight ||
			prior.forwardWeight !== edge.forwardWeight ||
			prior.backwardWeight !== edge.backwardWeight
		) {
			changedEdgeWeights.push(
				Object.freeze({
					sourceId: edge.sourceId,
					targetId: edge.targetId,
					previousWeight: prior.weight,
					currentWeight: edge.weight,
					previousForwardWeight: prior.forwardWeight,
					currentForwardWeight: edge.forwardWeight,
					previousBackwardWeight: prior.backwardWeight,
					currentBackwardWeight: edge.backwardWeight,
				}),
			);
		}
	}
	for (const [key, edge] of oldEdges) {
		if (!newEdges.has(key)) {
			removedEdges.push(toDiffEdge(edge));
		}
	}
	addedEdges.sort(compareEdges);
	removedEdges.sort(compareEdges);
	changedEdgeWeights.sort(compareEdges);

	const filterChanged =
		previous !== undefined &&
		previous.filterSignature !== current.filterSignature;
	const requiresLayout =
		addedNodeIds.length > 0 ||
		removedNodeIds.length > 0 ||
		addedEdges.length > 0 ||
		removedEdges.length > 0 ||
		changedEdgeWeights.length > 0 ||
		filterChanged;
	const isEmpty =
		!requiresLayout && accepted.renames.length === 0;
	const affected = new Set<string>([
		...addedNodeIds,
		...removedNodeIds,
	]);
	for (const edge of [...addedEdges, ...removedEdges]) {
		affected.add(edge.sourceId);
		affected.add(edge.targetId);
	}
	for (const edge of changedEdgeWeights) {
		affected.add(edge.sourceId);
		affected.add(edge.targetId);
	}
	const summary: GraphDiffSummary = Object.freeze({
		addedNodeIds: Object.freeze([...addedNodeIds]),
		removedNodeIds: Object.freeze([...removedNodeIds]),
		renamedNodes: Object.freeze([...accepted.renames]),
		addedEdgeCount: addedEdges.length,
		removedEdgeCount: removedEdges.length,
		changedEdgeWeightCount: changedEdgeWeights.length,
		filterChanged,
	});

	return Object.freeze({
		previousSignature,
		currentSignature,
		addedNodeIds: Object.freeze(addedNodeIds),
		removedNodeIds: Object.freeze(removedNodeIds),
		renamedNodes: accepted.renames,
		rejectedRenameHints: accepted.rejected,
		addedEdges: Object.freeze(addedEdges),
		removedEdges: Object.freeze(removedEdges),
		changedEdgeWeights: Object.freeze(changedEdgeWeights),
		filterChanged,
		affectedNodeIds: Object.freeze([...affected].sort(compareGraphIds)),
		isEmpty,
		requiresLayout,
		linkChangeCount:
			addedEdges.length +
			removedEdges.length +
			changedEdgeWeights.length,
		summary,
	});
}

export function graphChangeRatio(
	diff: GraphDiff,
	previous: GraphDescriptor | undefined,
	current: GraphDescriptor,
): number {
	const nodeDenominator = Math.max(
		1,
		previous?.nodeIds.length ?? 0,
		current.nodeIds.length,
	);
	const edgeDenominator = Math.max(
		1,
		previous?.edges.length ?? 0,
		current.edges.length,
	);
	const nodeRatio =
		(diff.addedNodeIds.length + diff.removedNodeIds.length) /
		nodeDenominator;
	const edgeRatio = diff.linkChangeCount / edgeDenominator;
	return Math.max(nodeRatio, edgeRatio);
}
