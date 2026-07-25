import {
	deterministicPermutation,
	hashNumbers,
	hashToUnitFloat,
} from '../geometry/deterministicHash';
import {
	exponentialMap,
	sphericalWeightedMean,
} from '../geometry/sphericalGeometry';
import {
	normalizeVec3,
	orthogonalUnitVec3,
	readVec3,
	scaleVec3,
	tryNormalizeVec3,
	writeVec3,
	type Vec3,
} from '../geometry/vector3';

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export interface FullInitializationOptions {
	readonly jitterScale?: number;
}

export function fibonacciSpherePoint(
	index: number,
	count: number,
): Vec3 {
	if (
		!Number.isSafeInteger(index) ||
		!Number.isSafeInteger(count) ||
		count <= 0 ||
		index < 0 ||
		index >= count
	) {
		throw new RangeError('Fibonacci point index must be within a non-empty set.');
	}
	if (count === 1) {
		return [1, 0, 0];
	}
	if (count === 2) {
		return index === 0 ? [1, 0, 0] : [-1, 0, 0];
	}

	const y = 1 - (2 * (index + 0.5)) / count;
	const radial = Math.sqrt(Math.max(0, 1 - y * y));
	const angle = index * GOLDEN_ANGLE;
	return [Math.cos(angle) * radial, y, Math.sin(angle) * radial];
}

export function initializeFullLayout(
	nodeCount: number,
	effectiveSeed: number,
	options: FullInitializationOptions = {},
): Float32Array {
	if (!Number.isSafeInteger(nodeCount) || nodeCount < 0) {
		throw new RangeError('nodeCount must be a non-negative integer.');
	}
	const positions = new Float32Array(nodeCount * 3);
	if (nodeCount === 0) {
		return positions;
	}

	const permutation = deterministicPermutation(
		nodeCount,
		hashNumbers(effectiveSeed, nodeCount, 0xf1b0),
	);
	const spacing = Math.sqrt((4 * Math.PI) / Math.max(1, nodeCount));
	const jitterScale = options.jitterScale ?? 0.055;
	if (!Number.isFinite(jitterScale) || jitterScale < 0) {
		throw new RangeError('jitterScale must be finite and non-negative.');
	}

	for (let nodeIndex = 0; nodeIndex < nodeCount; nodeIndex += 1) {
		const pointIndex = permutation[nodeIndex];
		if (pointIndex === undefined) {
			throw new RangeError('Initialization permutation is incomplete.');
		}
		const base = fibonacciSpherePoint(pointIndex, nodeCount);
		const jitterHash = hashNumbers(effectiveSeed, nodeIndex, pointIndex);
		const direction = orthogonalUnitVec3(base, jitterHash);
		const signedAmount =
			(hashToUnitFloat(jitterHash, 0x71) * 2 - 1) *
			spacing *
			jitterScale;
		writeVec3(
			positions,
			nodeIndex,
			exponentialMap(base, scaleVec3(direction, signedAmount)),
		);
	}
	return positions;
}

export interface RefreshInitializationInput {
	readonly nodeCount: number;
	readonly committedPositions: Float32Array;
	readonly existingNodeMask: Uint8Array;
	readonly edgeEndpoints: Uint32Array;
	readonly edgeWeights?: Float32Array;
	readonly effectiveSeed: number;
	readonly jitterScale?: number;
}

export interface RefreshInitializationResult {
	readonly positions: Float32Array;
	readonly existingNodeMask: Uint8Array;
	readonly newNodeMask: Uint8Array;
}

interface Neighbor {
	readonly index: number;
	readonly weight: number;
}

function buildAdjacency(
	nodeCount: number,
	edgeEndpoints: Uint32Array,
	edgeWeights: Float32Array | undefined,
): Neighbor[][] {
	if (edgeEndpoints.length % 2 !== 0) {
		throw new RangeError('edgeEndpoints length must be even.');
	}
	const edgeCount = edgeEndpoints.length / 2;
	if (edgeWeights !== undefined && edgeWeights.length !== edgeCount) {
		throw new RangeError('edgeWeights must contain one value per edge.');
	}
	const adjacency = Array.from(
		{ length: nodeCount },
		(): Neighbor[] => [],
	);
	for (let edgeIndex = 0; edgeIndex < edgeCount; edgeIndex += 1) {
		const source = edgeEndpoints[edgeIndex * 2];
		const target = edgeEndpoints[edgeIndex * 2 + 1];
		if (
			source === undefined ||
			target === undefined ||
			source >= nodeCount ||
			target >= nodeCount ||
			source === target
		) {
			continue;
		}
		const rawWeight = edgeWeights?.[edgeIndex] ?? 1;
		const weight =
			Number.isFinite(rawWeight) && rawWeight > 0 ? rawWeight : 1;
		adjacency[source]?.push({ index: target, weight });
		adjacency[target]?.push({ index: source, weight });
	}
	return adjacency;
}

function leastOccupiedCandidate(
	occupied: readonly Vec3[],
	nodeIndex: number,
	nodeCount: number,
	seed: number,
): Vec3 {
	const candidateCount = Math.max(64, Math.min(1024, nodeCount * 2));
	const sampleCount = Math.min(96, candidateCount);
	let best = fibonacciSpherePoint(0, candidateCount);
	let bestMaximumDot = Number.POSITIVE_INFINITY;
	for (let sample = 0; sample < sampleCount; sample += 1) {
		const candidateIndex =
			hashNumbers(seed, nodeIndex, sample, 0xcad) % candidateCount;
		const candidate = fibonacciSpherePoint(
			candidateIndex,
			candidateCount,
		);
		let maximumDot = -1;
		for (const position of occupied) {
			const dot =
				candidate[0] * position[0] +
				candidate[1] * position[1] +
				candidate[2] * position[2];
			maximumDot = Math.max(maximumDot, dot);
			if (maximumDot >= bestMaximumDot) {
				break;
			}
		}
		if (maximumDot < bestMaximumDot) {
			bestMaximumDot = maximumDot;
			best = candidate;
		}
	}
	return best;
}

export function initializeRefreshLayout(
	input: RefreshInitializationInput,
): RefreshInitializationResult {
	const {
		nodeCount,
		committedPositions,
		edgeEndpoints,
		edgeWeights,
		existingNodeMask,
		effectiveSeed,
	} = input;
	if (!Number.isSafeInteger(nodeCount) || nodeCount < 0) {
		throw new RangeError('nodeCount must be a non-negative integer.');
	}
	if (
		committedPositions.length !== nodeCount * 3 ||
		existingNodeMask.length !== nodeCount
	) {
		throw new RangeError('Refresh buffers do not match nodeCount.');
	}

	const positions = new Float32Array(nodeCount * 3);
	const validExistingMask = new Uint8Array(nodeCount);
	const newNodeMask = new Uint8Array(nodeCount);
	const occupied: Vec3[] = [];

	for (let nodeIndex = 0; nodeIndex < nodeCount; nodeIndex += 1) {
		const normalized =
			existingNodeMask[nodeIndex] === 1
				? tryNormalizeVec3(readVec3(committedPositions, nodeIndex))
				: null;
		if (normalized !== null) {
			validExistingMask[nodeIndex] = 1;
			writeVec3(positions, nodeIndex, normalized);
			occupied.push(normalized);
		} else {
			newNodeMask[nodeIndex] = 1;
		}
	}

	const adjacency = buildAdjacency(
		nodeCount,
		edgeEndpoints,
		edgeWeights,
	);
	const spacing = Math.sqrt((4 * Math.PI) / Math.max(1, nodeCount));
	const jitterScale = input.jitterScale ?? 0.085;
	if (!Number.isFinite(jitterScale) || jitterScale < 0) {
		throw new RangeError('jitterScale must be finite and non-negative.');
	}

	for (let nodeIndex = 0; nodeIndex < nodeCount; nodeIndex += 1) {
		if (newNodeMask[nodeIndex] !== 1) {
			continue;
		}
		const neighborPositions: Vec3[] = [];
		const neighborWeights: number[] = [];
		for (const neighbor of adjacency[nodeIndex] ?? []) {
			if (validExistingMask[neighbor.index] !== 1) {
				continue;
			}
			neighborPositions.push(readVec3(positions, neighbor.index));
			neighborWeights.push(neighbor.weight);
		}
		const center =
			sphericalWeightedMean(neighborPositions, neighborWeights) ??
			leastOccupiedCandidate(
				occupied,
				nodeIndex,
				nodeCount,
				effectiveSeed,
			);
		const salt = hashNumbers(effectiveSeed, nodeIndex, 0x4a17);
		const jitterDirection = orthogonalUnitVec3(center, salt);
		const jitterAmount =
			spacing *
			jitterScale *
			(0.35 + 0.65 * hashToUnitFloat(salt, 0x93));
		const position = normalizeVec3(
			exponentialMap(
				center,
				scaleVec3(jitterDirection, jitterAmount),
			),
		);
		writeVec3(positions, nodeIndex, position);
		occupied.push(position);
	}

	return {
		positions,
		existingNodeMask: validExistingMask,
		newNodeMask,
	};
}
