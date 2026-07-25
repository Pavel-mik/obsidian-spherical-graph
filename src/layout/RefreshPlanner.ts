export interface RefreshPlanSettings {
	readonly affectedNeighborhoodHops: number;
	readonly anchorStrength: number;
	readonly directlyAffectedAnchorMultiplier: number;
	readonly maximumOldNodeDisplacementRadians: number;
	readonly largeChangeWarningRatio: number;
}

export const DEFAULT_REFRESH_PLAN_SETTINGS: RefreshPlanSettings = {
	affectedNeighborhoodHops: 2,
	anchorStrength: 0.16,
	directlyAffectedAnchorMultiplier: 0.45,
	maximumOldNodeDisplacementRadians: (12 * Math.PI) / 180,
	largeChangeWarningRatio: 0.2,
};

export interface RefreshPlanInput {
	readonly nodeIds: readonly string[];
	readonly edgeEndpoints: Uint32Array;
	readonly existingNodeMask: Uint8Array;
	readonly directlyAffectedNodeIds: ReadonlySet<string>;
	readonly filterChanged?: boolean;
	readonly settings?: Partial<RefreshPlanSettings>;
}

export interface RefreshPlan {
	readonly noOp: boolean;
	readonly warnLargeChange: boolean;
	readonly affectedNodeCount: number;
	readonly newNodeMask: Uint8Array;
	readonly warmupMovableMask: Uint8Array;
	readonly relaxationMovableMask: Uint8Array;
	readonly hardFixedMask: Uint8Array;
	readonly anchorStrengths: Float32Array;
	readonly maxAnchorDistances: Float32Array;
	readonly hopDistances: Int32Array;
}

function resolveSettings(
	partial: Partial<RefreshPlanSettings> | undefined,
): RefreshPlanSettings {
	const settings = {
		...DEFAULT_REFRESH_PLAN_SETTINGS,
		...partial,
	};
	if (
		!Number.isSafeInteger(settings.affectedNeighborhoodHops) ||
		settings.affectedNeighborhoodHops < 0
	) {
		throw new RangeError(
			'affectedNeighborhoodHops must be a non-negative integer.',
		);
	}
	for (const key of [
		'anchorStrength',
		'directlyAffectedAnchorMultiplier',
		'maximumOldNodeDisplacementRadians',
		'largeChangeWarningRatio',
	] as const) {
		if (!Number.isFinite(settings[key]) || settings[key] < 0) {
			throw new RangeError(`${key} must be finite and non-negative.`);
		}
	}
	return settings;
}

function buildIndexAdjacency(
	nodeCount: number,
	edgeEndpoints: Uint32Array,
): number[][] {
	if (edgeEndpoints.length % 2 !== 0) {
		throw new RangeError('edgeEndpoints length must be even.');
	}
	const adjacency = Array.from(
		{ length: nodeCount },
		(): number[] => [],
	);
	for (let offset = 0; offset < edgeEndpoints.length; offset += 2) {
		const source = edgeEndpoints[offset];
		const target = edgeEndpoints[offset + 1];
		if (
			source === undefined ||
			target === undefined ||
			source >= nodeCount ||
			target >= nodeCount ||
			source === target
		) {
			continue;
		}
		adjacency[source]?.push(target);
		adjacency[target]?.push(source);
	}
	return adjacency;
}

export function createRefreshPlan(input: RefreshPlanInput): RefreshPlan {
	const nodeCount = input.nodeIds.length;
	if (input.existingNodeMask.length !== nodeCount) {
		throw new RangeError('existingNodeMask must have one value per node.');
	}
	const settings = resolveSettings(input.settings);
	const indexById = new Map<string, number>();
	for (let index = 0; index < nodeCount; index += 1) {
		const id = input.nodeIds[index];
		if (id !== undefined) {
			indexById.set(id, index);
		}
	}

	const newNodeMask = new Uint8Array(nodeCount);
	const warmupMovableMask = new Uint8Array(nodeCount);
	const relaxationMovableMask = new Uint8Array(nodeCount);
	const hardFixedMask = new Uint8Array(nodeCount);
	const anchorStrengths = new Float32Array(nodeCount);
	const maxAnchorDistances = new Float32Array(nodeCount);
	const hopDistances = new Int32Array(nodeCount);
	hopDistances.fill(-1);
	const queue: number[] = [];

	for (let index = 0; index < nodeCount; index += 1) {
		if (input.existingNodeMask[index] !== 1) {
			newNodeMask[index] = 1;
			warmupMovableMask[index] = 1;
			relaxationMovableMask[index] = 1;
			hopDistances[index] = 0;
			queue.push(index);
		}
	}
	if (input.filterChanged === true) {
		for (let index = 0; index < nodeCount; index += 1) {
			if (hopDistances[index] === -1) {
				hopDistances[index] = 0;
				queue.push(index);
			}
		}
	} else {
		for (const id of input.directlyAffectedNodeIds) {
			const index = indexById.get(id);
			if (index !== undefined && hopDistances[index] === -1) {
				hopDistances[index] = 0;
				queue.push(index);
			}
		}
	}

	const adjacency = buildIndexAdjacency(
		nodeCount,
		input.edgeEndpoints,
	);
	let cursor = 0;
	while (cursor < queue.length) {
		const index = queue[cursor];
		cursor += 1;
		if (index === undefined) {
			continue;
		}
		const distance = hopDistances[index] ?? -1;
		if (distance >= settings.affectedNeighborhoodHops) {
			continue;
		}
		for (const neighbor of adjacency[index] ?? []) {
			if (hopDistances[neighbor] !== -1) {
				continue;
			}
			hopDistances[neighbor] = distance + 1;
			queue.push(neighbor);
		}
	}

	let affectedNodeCount = 0;
	for (let index = 0; index < nodeCount; index += 1) {
		const distance = hopDistances[index] ?? -1;
		const existing = input.existingNodeMask[index] === 1;
		if (distance >= 0) {
			relaxationMovableMask[index] = 1;
			affectedNodeCount += 1;
			if (existing) {
				const boundaryFraction =
					settings.affectedNeighborhoodHops === 0
						? 0
						: distance / settings.affectedNeighborhoodHops;
				const multiplier =
					settings.directlyAffectedAnchorMultiplier +
					(1 - settings.directlyAffectedAnchorMultiplier) *
						boundaryFraction;
				anchorStrengths[index] =
					settings.anchorStrength * multiplier;
				maxAnchorDistances[index] =
					settings.maximumOldNodeDisplacementRadians;
			}
		} else if (existing) {
			hardFixedMask[index] = 1;
			maxAnchorDistances[index] = 0;
		}
	}

	const changeRatio =
		nodeCount === 0 ? 0 : affectedNodeCount / nodeCount;
	const noOp =
		affectedNodeCount === 0 &&
		input.filterChanged !== true &&
		input.directlyAffectedNodeIds.size === 0;
	return {
		noOp,
		warnLargeChange:
			!noOp && changeRatio >= settings.largeChangeWarningRatio,
		affectedNodeCount,
		newNodeMask,
		warmupMovableMask,
		relaxationMovableMask,
		hardFixedMask,
		anchorStrengths,
		maxAnchorDistances,
		hopDistances,
	};
}

export interface AffectedEdgeRecord {
	readonly sourceId: string;
	readonly targetId: string;
}

export interface RefreshDiffLike {
	readonly addedNodeIds: readonly string[];
	readonly affectedNodeIds?: readonly string[];
	readonly addedEdges?: readonly AffectedEdgeRecord[];
	readonly removedEdges?: readonly AffectedEdgeRecord[];
	readonly changedWeightEdges?: readonly AffectedEdgeRecord[];
	readonly filterChanged: boolean;
}

export function directlyAffectedIdsFromDiff(
	diff: RefreshDiffLike,
): ReadonlySet<string> {
	const result = new Set<string>(diff.addedNodeIds);
	for (const id of diff.affectedNodeIds ?? []) {
		result.add(id);
	}
	for (const edge of [
		...(diff.addedEdges ?? []),
		...(diff.removedEdges ?? []),
		...(diff.changedWeightEdges ?? []),
	]) {
		result.add(edge.sourceId);
		result.add(edge.targetId);
	}
	return result;
}
