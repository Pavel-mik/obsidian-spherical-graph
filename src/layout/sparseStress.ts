import {
	hashNumbers,
	hashToUnitFloat,
} from '../geometry/deterministicHash';

const DEFAULT_MAX_LANDMARKS_PER_GROUP = 8;
const DEFAULT_PAIRS_PER_NODE = 3;
const DEFAULT_MINIMUM_GRAPH_DISTANCE = 2;
const DEFAULT_MINIMUM_TARGET_ANGLE = 0.055;
const DEFAULT_MAXIMUM_TARGET_ANGLE = 1.35;
const DEFAULT_STRESS_WEIGHT_SCALE = 0.22;

export interface SparseStressOptions {
	/** A constant upper bound keeps landmark BFS work linear in the graph size. */
	readonly maxLandmarksPerGroup?: number;
	/** Maximum number of new constraints initiated by one node. */
	readonly pairsPerNode?: number;
	readonly minimumGraphDistance?: number;
	readonly minimumTargetAngle?: number;
	readonly maximumTargetAngle?: number;
	/** Multiplier relative to the mean weight of the original graph. */
	readonly stressWeightScale?: number;
}

export interface SparseStressInput {
	readonly nodeCount: number;
	readonly edgeEndpoints: Uint32Array;
	readonly edgeWeights: Float32Array;
	readonly positions: Float32Array;
	readonly folderIndexByNode?: Int32Array;
	readonly regionIndexByNode?: Int32Array;
	readonly seed: number;
	readonly options?: SparseStressOptions;
}

export interface SparseStressResult {
	/** Original edges first, followed by deterministic sparse-stress pairs. */
	readonly edgeEndpoints: Uint32Array;
	readonly edgeWeights: Float32Array;
	/**
	 * Explicit geodesic target per edge. Zero is the sentinel for an original
	 * edge whose ordinary spring target should be used by the solver.
	 */
	readonly targetAngles: Float32Array;
	readonly addedPairCount: number;
	readonly landmarkCount: number;
}

interface ResolvedOptions {
	readonly maxLandmarksPerGroup: number;
	readonly pairsPerNode: number;
	readonly minimumGraphDistance: number;
	readonly minimumTargetAngle: number;
	readonly maximumTargetAngle: number;
	readonly stressWeightScale: number;
}

interface SparseConstraint {
	readonly source: number;
	readonly target: number;
	readonly weight: number;
	readonly targetAngle: number;
}

interface LandmarkDistance {
	readonly landmark: number;
	readonly distances: Int32Array;
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.max(minimum, Math.min(maximum, value));
}

function resolveOptions(
	options: SparseStressOptions | undefined,
): ResolvedOptions {
	const resolved: ResolvedOptions = {
		maxLandmarksPerGroup:
			options?.maxLandmarksPerGroup ??
			DEFAULT_MAX_LANDMARKS_PER_GROUP,
		pairsPerNode:
			options?.pairsPerNode ?? DEFAULT_PAIRS_PER_NODE,
		minimumGraphDistance:
			options?.minimumGraphDistance ??
			DEFAULT_MINIMUM_GRAPH_DISTANCE,
		minimumTargetAngle:
			options?.minimumTargetAngle ??
			DEFAULT_MINIMUM_TARGET_ANGLE,
		maximumTargetAngle:
			options?.maximumTargetAngle ??
			DEFAULT_MAXIMUM_TARGET_ANGLE,
		stressWeightScale:
			options?.stressWeightScale ??
			DEFAULT_STRESS_WEIGHT_SCALE,
	};
	for (const [key, value] of [
		['maxLandmarksPerGroup', resolved.maxLandmarksPerGroup],
		['pairsPerNode', resolved.pairsPerNode],
		['minimumGraphDistance', resolved.minimumGraphDistance],
	] as const) {
		if (!Number.isSafeInteger(value) || value < 0) {
			throw new RangeError(`${key} must be a non-negative integer.`);
		}
	}
	for (const [key, value] of [
		['minimumTargetAngle', resolved.minimumTargetAngle],
		['maximumTargetAngle', resolved.maximumTargetAngle],
		['stressWeightScale', resolved.stressWeightScale],
	] as const) {
		if (!Number.isFinite(value) || value < 0) {
			throw new RangeError(`${key} must be finite and non-negative.`);
		}
	}
	if (
		resolved.minimumTargetAngle <= 0 ||
		resolved.maximumTargetAngle > Math.PI ||
		resolved.minimumTargetAngle > resolved.maximumTargetAngle
	) {
		throw new RangeError(
			'Sparse-stress target angles must form a positive interval within π.',
		);
	}
	return resolved;
}

function validateInput(input: SparseStressInput): void {
	if (!Number.isSafeInteger(input.nodeCount) || input.nodeCount < 0) {
		throw new RangeError('nodeCount must be a non-negative integer.');
	}
	if (
		input.positions.length !== input.nodeCount * 3 ||
		input.edgeEndpoints.length !== input.edgeWeights.length * 2 ||
		(input.folderIndexByNode !== undefined &&
			input.folderIndexByNode.length !== input.nodeCount) ||
		(input.regionIndexByNode !== undefined &&
			input.regionIndexByNode.length !== input.nodeCount)
	) {
		throw new RangeError('Sparse-stress buffers have inconsistent lengths.');
	}
	if (!Number.isFinite(input.seed)) {
		throw new RangeError('seed must be finite.');
	}
	for (
		let componentIndex = 0;
		componentIndex < input.positions.length;
		componentIndex += 1
	) {
		if (!Number.isFinite(input.positions[componentIndex])) {
			throw new RangeError('positions must contain only finite values.');
		}
	}
	for (
		let edgeIndex = 0;
		edgeIndex < input.edgeWeights.length;
		edgeIndex += 1
	) {
		const source = input.edgeEndpoints[edgeIndex * 2];
		const target = input.edgeEndpoints[edgeIndex * 2 + 1];
		const weight = input.edgeWeights[edgeIndex];
		if (
			source === undefined ||
			target === undefined ||
			source >= input.nodeCount ||
			target >= input.nodeCount
		) {
			throw new RangeError('edgeEndpoints contains an invalid node index.');
		}
		if (weight === undefined || !Number.isFinite(weight) || weight <= 0) {
			throw new RangeError('edgeWeights must be finite and positive.');
		}
	}
}

function pairKey(first: number, second: number): string {
	return first < second
		? `${first}:${second}`
		: `${second}:${first}`;
}

function groupKey(
	nodeIndex: number,
	folderIndexByNode: Int32Array | undefined,
	regionIndexByNode: Int32Array | undefined,
): string {
	const folder = folderIndexByNode?.[nodeIndex];
	const region = regionIndexByNode?.[nodeIndex];
	if (region !== undefined && region >= 0) {
		return `f:${folder ?? '*'}:r:${region}`;
	}
	if (folder !== undefined) {
		return `f:${folder}`;
	}
	return 'all';
}

function createGroups(input: SparseStressInput): {
	readonly groups: readonly number[][];
	readonly groupIndexByNode: Int32Array;
} {
	const groups: number[][] = [];
	const groupByKey = new Map<string, number>();
	const groupIndexByNode = new Int32Array(input.nodeCount);
	for (let nodeIndex = 0; nodeIndex < input.nodeCount; nodeIndex += 1) {
		const key = groupKey(
			nodeIndex,
			input.folderIndexByNode,
			input.regionIndexByNode,
		);
		let groupIndex = groupByKey.get(key);
		if (groupIndex === undefined) {
			groupIndex = groups.length;
			groupByKey.set(key, groupIndex);
			groups.push([]);
		}
		groupIndexByNode[nodeIndex] = groupIndex;
		groups[groupIndex]?.push(nodeIndex);
	}
	return { groups, groupIndexByNode };
}

function buildAdjacency(input: SparseStressInput): {
	readonly adjacency: readonly number[][];
	readonly occupiedPairs: Set<string>;
	readonly meanEdgeWeight: number;
} {
	const adjacency = Array.from(
		{ length: input.nodeCount },
		(): number[] => [],
	);
	const occupiedPairs = new Set<string>();
	let totalWeight = 0;
	let positiveWeightCount = 0;
	for (
		let edgeIndex = 0;
		edgeIndex < input.edgeWeights.length;
		edgeIndex += 1
	) {
		const source = input.edgeEndpoints[edgeIndex * 2];
		const target = input.edgeEndpoints[edgeIndex * 2 + 1];
		const weight = input.edgeWeights[edgeIndex];
		if (
			source === undefined ||
			target === undefined ||
			weight === undefined
		) {
			continue;
		}
		totalWeight += weight;
		positiveWeightCount += 1;
		if (source === target) {
			continue;
		}
		adjacency[source]?.push(target);
		adjacency[target]?.push(source);
		occupiedPairs.add(pairKey(source, target));
	}
	for (const neighbors of adjacency) {
		neighbors.sort((first, second) => first - second);
	}
	return {
		adjacency,
		occupiedPairs,
		meanEdgeWeight:
			positiveWeightCount > 0
				? totalWeight / positiveWeightCount
				: 1,
	};
}

function graphDistances(
	landmark: number,
	members: readonly number[],
	localIndexByNode: Int32Array,
	groupIndex: number,
	groupIndexByNode: Int32Array,
	adjacency: readonly number[][],
): Int32Array {
	const distances = new Int32Array(members.length);
	distances.fill(-1);
	const landmarkLocalIndex = localIndexByNode[landmark];
	if (landmarkLocalIndex === undefined || landmarkLocalIndex < 0) {
		return distances;
	}
	distances[landmarkLocalIndex] = 0;
	const queue = new Uint32Array(members.length);
	let readIndex = 0;
	let writeIndex = 1;
	queue[0] = landmark;
	while (readIndex < writeIndex) {
		const current = queue[readIndex];
		readIndex += 1;
		if (current === undefined) {
			continue;
		}
		const currentLocalIndex = localIndexByNode[current];
		const currentDistance =
			currentLocalIndex === undefined || currentLocalIndex < 0
				? -1
				: (distances[currentLocalIndex] ?? -1);
		for (const neighbor of adjacency[current] ?? []) {
			if (groupIndexByNode[neighbor] !== groupIndex) {
				continue;
			}
			const neighborLocalIndex = localIndexByNode[neighbor];
			if (
				neighborLocalIndex === undefined ||
				neighborLocalIndex < 0 ||
				distances[neighborLocalIndex] !== -1
			) {
				continue;
			}
			distances[neighborLocalIndex] = currentDistance + 1;
			queue[writeIndex] = neighbor;
			writeIndex += 1;
		}
	}
	return distances;
}

function angularDistance(
	positions: Float32Array,
	first: number,
	second: number,
): number {
	const firstOffset = first * 3;
	const secondOffset = second * 3;
	const ax = positions[firstOffset] ?? 0;
	const ay = positions[firstOffset + 1] ?? 0;
	const az = positions[firstOffset + 2] ?? 0;
	const bx = positions[secondOffset] ?? 0;
	const by = positions[secondOffset + 1] ?? 0;
	const bz = positions[secondOffset + 2] ?? 0;
	const firstLength = Math.hypot(ax, ay, az);
	const secondLength = Math.hypot(bx, by, bz);
	if (firstLength <= 1e-12 || secondLength <= 1e-12) {
		return 0;
	}
	const dot = clamp(
		(ax * bx + ay * by + az * bz) /
			(firstLength * secondLength),
		-1,
		1,
	);
	return Math.acos(dot);
}

function chooseLandmarks(
	input: SparseStressInput,
	members: readonly number[],
	groupIndex: number,
	groupIndexByNode: Int32Array,
	adjacency: readonly number[][],
	localIndexByNode: Int32Array,
	maximumCount: number,
): LandmarkDistance[] {
	if (members.length === 0 || maximumCount === 0) {
		return [];
	}
	const desiredCount = Math.min(
		maximumCount,
		members.length,
		Math.max(2, Math.ceil(Math.sqrt(members.length))),
	);
	let firstLandmark = members[0] ?? 0;
	let firstDegree = -1;
	let firstTieBreak = -1;
	for (const nodeIndex of members) {
		let degree = 0;
		for (const neighbor of adjacency[nodeIndex] ?? []) {
			if (groupIndexByNode[neighbor] === groupIndex) {
				degree += 1;
			}
		}
		const tieBreak = hashNumbers(input.seed, groupIndex, nodeIndex, 0x51e);
		if (
			degree > firstDegree ||
			(degree === firstDegree && tieBreak > firstTieBreak)
		) {
			firstLandmark = nodeIndex;
			firstDegree = degree;
			firstTieBreak = tieBreak;
		}
	}

	const selected = new Set<number>([firstLandmark]);
	const landmarks: LandmarkDistance[] = [
		{
			landmark: firstLandmark,
			distances: graphDistances(
				firstLandmark,
				members,
				localIndexByNode,
				groupIndex,
				groupIndexByNode,
				adjacency,
			),
		},
	];
	while (landmarks.length < desiredCount) {
		let bestNode = -1;
		let bestGraphSeparation = -1;
		let bestSpatialSeparation = -1;
		let bestTieBreak = -1;
		for (const nodeIndex of members) {
			if (selected.has(nodeIndex)) {
				continue;
			}
			const localIndex = localIndexByNode[nodeIndex];
			if (localIndex === undefined || localIndex < 0) {
				continue;
			}
			let minimumGraphDistance = Number.POSITIVE_INFINITY;
			let minimumSpatialDistance = Number.POSITIVE_INFINITY;
			for (const landmark of landmarks) {
				const distance = landmark.distances[localIndex] ?? -1;
				minimumGraphDistance = Math.min(
					minimumGraphDistance,
					distance < 0 ? 1_000_000 : distance,
				);
				minimumSpatialDistance = Math.min(
					minimumSpatialDistance,
					angularDistance(
						input.positions,
						nodeIndex,
						landmark.landmark,
					),
				);
			}
			const tieBreak = hashNumbers(
				input.seed,
				groupIndex,
				nodeIndex,
				landmarks.length,
				0xfa4,
			);
			if (
				minimumGraphDistance > bestGraphSeparation ||
				(minimumGraphDistance === bestGraphSeparation &&
					minimumSpatialDistance > bestSpatialSeparation) ||
				(minimumGraphDistance === bestGraphSeparation &&
					minimumSpatialDistance === bestSpatialSeparation &&
					tieBreak > bestTieBreak)
			) {
				bestNode = nodeIndex;
				bestGraphSeparation = minimumGraphDistance;
				bestSpatialSeparation = minimumSpatialDistance;
				bestTieBreak = tieBreak;
			}
		}
		if (bestNode < 0) {
			break;
		}
		selected.add(bestNode);
		landmarks.push({
			landmark: bestNode,
			distances: graphDistances(
				bestNode,
				members,
				localIndexByNode,
				groupIndex,
				groupIndexByNode,
				adjacency,
			),
		});
	}
	return landmarks;
}

function sparseTargetAngle(
	input: SparseStressInput,
	options: ResolvedOptions,
	source: number,
	target: number,
	graphDistance: number,
): number {
	const nominalSpacing = clamp(
		0.82 * Math.sqrt((4 * Math.PI) / Math.max(1, input.nodeCount)),
		options.minimumTargetAngle,
		0.55,
	);
	const topologicalTarget =
		nominalSpacing *
		(1 + 0.78 * Math.sqrt(Math.max(0, graphDistance - 1)));
	const currentDistance = angularDistance(input.positions, source, target);
	const positionReference =
		currentDistance > 0
			? clamp(
					currentDistance,
					options.minimumTargetAngle,
					options.maximumTargetAngle,
				)
			: topologicalTarget;
	const organicScale =
		0.84 +
		0.32 *
			hashToUnitFloat(
				input.seed,
				Math.min(source, target),
				Math.max(source, target),
				graphDistance,
				0x57e,
			);
	return clamp(
		(0.82 * topologicalTarget + 0.18 * positionReference) *
			organicScale,
		options.minimumTargetAngle,
		options.maximumTargetAngle,
	);
}

function appendGroupConstraints(
	input: SparseStressInput,
	options: ResolvedOptions,
	members: readonly number[],
	groupIndex: number,
	groupIndexByNode: Int32Array,
	adjacency: readonly number[][],
	occupiedPairs: Set<string>,
	meanEdgeWeight: number,
	localIndexByNode: Int32Array,
	constraints: SparseConstraint[],
): number {
	if (
		members.length < 3 ||
		options.maxLandmarksPerGroup === 0 ||
		options.pairsPerNode === 0
	) {
		return 0;
	}
	for (let localIndex = 0; localIndex < members.length; localIndex += 1) {
		const nodeIndex = members[localIndex];
		if (nodeIndex !== undefined) {
			localIndexByNode[nodeIndex] = localIndex;
		}
	}
	const landmarks = chooseLandmarks(
		input,
		members,
		groupIndex,
		groupIndexByNode,
		adjacency,
		localIndexByNode,
		options.maxLandmarksPerGroup,
	);
	for (const source of members) {
		const sourceLocalIndex = localIndexByNode[source];
		if (sourceLocalIndex === undefined || sourceLocalIndex < 0) {
			continue;
		}
		const candidates = landmarks
			.filter((entry) => {
				const distance = entry.distances[sourceLocalIndex] ?? -1;
				return (
					entry.landmark !== source &&
					distance >= options.minimumGraphDistance &&
					!occupiedPairs.has(pairKey(source, entry.landmark))
				);
			})
			.map((entry) => ({
				landmark: entry.landmark,
				distance: entry.distances[sourceLocalIndex] ?? -1,
				tieBreak: hashNumbers(
					input.seed,
					source,
					entry.landmark,
					0x1ad,
				),
			}))
			.sort(
				(first, second) =>
					second.distance - first.distance ||
					second.tieBreak - first.tieBreak ||
					first.landmark - second.landmark,
			);
		let addedForNode = 0;
		for (const candidate of candidates) {
			if (addedForNode >= options.pairsPerNode) {
				break;
			}
			const key = pairKey(source, candidate.landmark);
			if (occupiedPairs.has(key)) {
				continue;
			}
			occupiedPairs.add(key);
			const low = Math.min(source, candidate.landmark);
			const high = Math.max(source, candidate.landmark);
			const weightVariation =
				0.82 +
				0.36 *
					hashToUnitFloat(
						input.seed,
						low,
						high,
						candidate.distance,
						0x8e1,
					);
			const weight =
				(meanEdgeWeight *
					options.stressWeightScale *
					weightVariation) /
				Math.sqrt(candidate.distance);
			constraints.push({
				source: low,
				target: high,
				weight,
				targetAngle: sparseTargetAngle(
					input,
					options,
					low,
					high,
					candidate.distance,
				),
			});
			addedForNode += 1;
		}
	}
	for (const nodeIndex of members) {
		localIndexByNode[nodeIndex] = -1;
	}
	return landmarks.length;
}

/**
 * Adds a bounded set of landmark-to-node graph-distance constraints.
 *
 * The routine performs only a constant number of BFS traversals per group and
 * adds at most `nodeCount * pairsPerNode` constraints. It never introduces a
 * pair across top-level folders, and it prefers the finer region grouping when
 * a region index is available.
 */
export function buildSparseStressConstraints(
	input: SparseStressInput,
): SparseStressResult {
	validateInput(input);
	const options = resolveOptions(input.options);
	const { adjacency, occupiedPairs, meanEdgeWeight } =
		buildAdjacency(input);
	const { groups, groupIndexByNode } = createGroups(input);
	const constraints: SparseConstraint[] = [];
	const localIndexByNode = new Int32Array(input.nodeCount);
	localIndexByNode.fill(-1);
	let landmarkCount = 0;
	for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
		const members = groups[groupIndex];
		if (members === undefined) {
			continue;
		}
		landmarkCount += appendGroupConstraints(
			input,
			options,
			members,
			groupIndex,
			groupIndexByNode,
			adjacency,
			occupiedPairs,
			meanEdgeWeight,
			localIndexByNode,
			constraints,
		);
	}
	constraints.sort(
		(first, second) =>
			first.source - second.source ||
			first.target - second.target ||
			first.targetAngle - second.targetAngle,
	);

	const originalEdgeCount = input.edgeWeights.length;
	const outputEdgeCount = originalEdgeCount + constraints.length;
	const edgeEndpoints = new Uint32Array(outputEdgeCount * 2);
	const edgeWeights = new Float32Array(outputEdgeCount);
	const targetAngles = new Float32Array(outputEdgeCount);
	edgeEndpoints.set(input.edgeEndpoints);
	edgeWeights.set(input.edgeWeights);
	for (
		let constraintIndex = 0;
		constraintIndex < constraints.length;
		constraintIndex += 1
	) {
		const constraint = constraints[constraintIndex];
		if (constraint === undefined) {
			continue;
		}
		const outputIndex = originalEdgeCount + constraintIndex;
		edgeEndpoints[outputIndex * 2] = constraint.source;
		edgeEndpoints[outputIndex * 2 + 1] = constraint.target;
		edgeWeights[outputIndex] = constraint.weight;
		targetAngles[outputIndex] = constraint.targetAngle;
	}
	return {
		edgeEndpoints,
		edgeWeights,
		targetAngles,
		addedPairCount: constraints.length,
		landmarkCount,
	};
}
