import {
	scoreCoastalPortCandidates,
	selectSeparatedCoastalPorts,
	type CoastalPortCandidateInput,
	type CoastalPortCandidateScore,
} from '../geography/coastalPorts';
import {
	exponentialMap,
	geodesicDistance,
	sphericalWeightedMean,
	tangentDirection,
} from '../geometry/sphericalGeometry';
import {
	clamp,
	dotVec3,
	normalizeVec3,
	projectTangentVec3,
	readVec3,
	scaleVec3,
	tryNormalizeVec3,
	writeVec3,
	type Vec3,
} from '../geometry/vector3';
import type { GraphData } from '../graph/graphTypes';

const DEFAULT_NODES_PER_PORT = 16;
const DEFAULT_MAXIMUM_PORTS_PER_FOLDER = 8;
const DEFAULT_MINIMUM_PORT_SCORE = 0.35;
const DEFAULT_MINIMUM_BEARING_SEPARATION = 0.42;
const DEFAULT_SUPPORT_QUANTILE = 0.88;
const DEFAULT_MAXIMUM_PORT_SHIFT = 0.22;

export interface CoastalPortLayoutOptions {
	/**
	 * Port capacity grows sub-linearly with folder size. With the default, a
	 * folder reaches one slot at 16 notes and later slots need progressively
	 * more inferred coastline.
	 */
	readonly nodesPerPort?: number;
	readonly maximumPortsPerFolder?: number;
	readonly minimumPortScore?: number;
	readonly minimumBearingSeparation?: number;
}

/**
 * Dense worker-friendly buffers. A positive score marks a selected port;
 * every other score and direction triplet is zero. Directions are unit
 * tangents at the corresponding current note position.
 */
export interface CoastalPortLayout {
	readonly portScores: Float32Array;
	readonly portDirections: Float32Array;
}

export interface CoastalPortBiasOptions {
	/**
	 * Percentile of the folder's directional support that acts as the coast.
	 * This follows the observed shape instead of imposing a circular radius.
	 */
	readonly supportQuantile?: number;
	/**
	 * Hard angular bound in radians for one post-layout port adjustment.
	 */
	readonly maximumAngularShift?: number;
}

interface FolderGeometry {
	readonly index: number;
	readonly members: readonly number[];
	readonly center: Vec3;
}

function compareNodeIndices(graph: GraphData, left: number, right: number): number {
	const leftId = graph.nodes[left]?.id ?? `${left}`;
	const rightId = graph.nodes[right]?.id ?? `${right}`;
	return leftId < rightId ? -1 : leftId > rightId ? 1 : left - right;
}

function validateInputs(
	graph: GraphData,
	positions: ArrayLike<number>,
	folderIndexByNode: ArrayLike<number>,
): void {
	if (positions.length !== graph.nodes.length * 3) {
		throw new RangeError('Port-layout positions must contain one vec3 per node.');
	}
	if (folderIndexByNode.length !== graph.nodes.length) {
		throw new RangeError(
			'Port-layout folder ownership must contain one entry per node.',
		);
	}
	for (let index = 0; index < graph.nodes.length; index += 1) {
		const owner = folderIndexByNode[index];
		if (
			owner === undefined ||
			!Number.isSafeInteger(owner) ||
			owner < -1
		) {
			throw new RangeError('Folder indexes must be integers greater than or equal to -1.');
		}
		normalizeVec3(readVec3(positions, index));
	}
}

function robustFolderCenter(
	graph: GraphData,
	positions: ArrayLike<number>,
	members: readonly number[],
): Vec3 {
	const points = members.map((nodeIndex) =>
		normalizeVec3(readVec3(positions, nodeIndex)),
	);
	const mean = sphericalWeightedMean(points);
	if (mean !== null) {
		return mean;
	}

	// A symmetric folder can have a zero vector mean. Its intrinsic medoid is
	// a deterministic, rotation-independent fallback and avoids a global axis.
	let best = members[0];
	let bestDistance = Number.POSITIVE_INFINITY;
	for (const candidate of members) {
		const candidatePosition = readVec3(positions, candidate);
		let totalDistance = 0;
		for (const other of members) {
			totalDistance += geodesicDistance(
				candidatePosition,
				readVec3(positions, other),
			);
		}
		if (
			totalDistance < bestDistance - 1e-12 ||
			(Math.abs(totalDistance - bestDistance) <= 1e-12 &&
				best !== undefined &&
				compareNodeIndices(graph, candidate, best) < 0)
		) {
			best = candidate;
			bestDistance = totalDistance;
		}
	}
	if (best === undefined) {
		throw new RangeError('A folder geometry requires at least one member.');
	}
	return normalizeVec3(readVec3(positions, best));
}

function folderGeometries(
	graph: GraphData,
	positions: ArrayLike<number>,
	folderIndexByNode: ArrayLike<number>,
): ReadonlyMap<number, FolderGeometry> {
	const membersByFolder = new Map<number, number[]>();
	for (const node of graph.nodes) {
		const owner = folderIndexByNode[node.index] ?? -1;
		if (owner < 0) {
			continue;
		}
		const members = membersByFolder.get(owner);
		if (members === undefined) {
			membersByFolder.set(owner, [node.index]);
		} else {
			members.push(node.index);
		}
	}

	const result = new Map<number, FolderGeometry>();
	for (const [index, unsortedMembers] of [...membersByFolder.entries()].sort(
		(left, right) => left[0] - right[0],
	)) {
		const members = [...unsortedMembers].sort((left, right) =>
			compareNodeIndices(graph, left, right),
		);
		result.set(index, {
			index,
			members,
			center: robustFolderCenter(graph, positions, members),
		});
	}
	return result;
}

function validateDerivationOptions(options: CoastalPortLayoutOptions): Required<CoastalPortLayoutOptions> {
	const nodesPerPort = options.nodesPerPort ?? DEFAULT_NODES_PER_PORT;
	const maximumPortsPerFolder =
		options.maximumPortsPerFolder ?? DEFAULT_MAXIMUM_PORTS_PER_FOLDER;
	const minimumPortScore =
		options.minimumPortScore ?? DEFAULT_MINIMUM_PORT_SCORE;
	const minimumBearingSeparation =
		options.minimumBearingSeparation ??
		DEFAULT_MINIMUM_BEARING_SEPARATION;
	if (!Number.isFinite(nodesPerPort) || nodesPerPort <= 0) {
		throw new RangeError('Nodes per port must be finite and positive.');
	}
	if (
		!Number.isSafeInteger(maximumPortsPerFolder) ||
		maximumPortsPerFolder < 0
	) {
		throw new RangeError('Maximum ports per folder must be a non-negative integer.');
	}
	if (
		!Number.isFinite(minimumPortScore) ||
		minimumPortScore < 0 ||
		minimumPortScore > 1
	) {
		throw new RangeError('Minimum port score must be within [0, 1].');
	}
	if (
		!Number.isFinite(minimumBearingSeparation) ||
		minimumBearingSeparation < 0 ||
		minimumBearingSeparation > Math.PI
	) {
		throw new RangeError(
			'Minimum port bearing separation must be within [0, pi].',
		);
	}
	return {
		nodesPerPort,
		maximumPortsPerFolder,
		minimumPortScore,
		minimumBearingSeparation,
	};
}

function folderCapacity(
	memberCount: number,
	options: Required<CoastalPortLayoutOptions>,
): number {
	return Math.min(
		options.maximumPortsPerFolder,
		Math.max(1, Math.ceil(Math.sqrt(memberCount / options.nodesPerPort))),
	);
}

function selectionOptions(
	memberCount: number,
	options: Required<CoastalPortLayoutOptions>,
): {
	readonly capacity: number;
	readonly minimumAngularSeparation: number;
	readonly minimumScore: number;
} {
	return {
		capacity: folderCapacity(memberCount, options),
		minimumAngularSeparation: options.minimumBearingSeparation,
		minimumScore: options.minimumPortScore,
	};
}

/**
 * Shared NMS policy for both post-layout port placement and coastline water
 * seeds. Keeping one policy prevents a city from moving to the coast while
 * the renderer independently rejects it as a port.
 */
export function coastalPortSelectionOptions(
	memberCount: number,
	options: CoastalPortLayoutOptions = {},
): {
	readonly capacity: number;
	readonly minimumAngularSeparation: number;
	readonly minimumScore: number;
} {
	if (!Number.isSafeInteger(memberCount) || memberCount < 0) {
		throw new RangeError(
			'Coastal-port member count must be a non-negative integer.',
		);
	}
	return selectionOptions(
		memberCount,
		validateDerivationOptions(options),
	);
}

function candidatesByFolder(
	graph: GraphData,
	positions: ArrayLike<number>,
	folderIndexByNode: ArrayLike<number>,
	folders: ReadonlyMap<number, FolderGeometry>,
): ReadonlyMap<number, readonly CoastalPortCandidateScore[]> {
	const totalIncidentWeights = new Float64Array(graph.nodes.length);
	const externalTargets = Array.from(
		{ length: graph.nodes.length },
		() => [] as CoastalPortCandidateInput['externalTargets'][number][],
	);
	for (const edge of graph.edges) {
		if (!Number.isFinite(edge.weight) || edge.weight < 0) {
			throw new RangeError('Graph edge weights must be finite and non-negative.');
		}
		totalIncidentWeights[edge.source] =
			(totalIncidentWeights[edge.source] ?? 0) + edge.weight;
		totalIncidentWeights[edge.target] =
			(totalIncidentWeights[edge.target] ?? 0) + edge.weight;
		const sourceFolder = folderIndexByNode[edge.source] ?? -1;
		const targetFolder = folderIndexByNode[edge.target] ?? -1;
		if (
			sourceFolder < 0 ||
			targetFolder < 0 ||
			sourceFolder === targetFolder
		) {
			continue;
		}
		const sourceGeometry = folders.get(sourceFolder);
		const targetGeometry = folders.get(targetFolder);
		if (sourceGeometry === undefined || targetGeometry === undefined) {
			continue;
		}
		externalTargets[edge.source]?.push({
			destinationContinentId: `${targetFolder}`,
			weight: edge.weight,
			direction: targetGeometry.center,
		});
		externalTargets[edge.target]?.push({
			destinationContinentId: `${sourceFolder}`,
			weight: edge.weight,
			direction: sourceGeometry.center,
		});
	}

	const inputs: CoastalPortCandidateInput[] = [];
	for (const folder of folders.values()) {
		for (const nodeIndex of folder.members) {
			const node = graph.nodes[nodeIndex];
			if (node === undefined) {
				continue;
			}
			inputs.push({
				nodeId: node.id,
				continentId: `${folder.index}`,
				position: readVec3(positions, nodeIndex),
				continentCenter: folder.center,
				totalIncidentWeight: totalIncidentWeights[nodeIndex] ?? 0,
				externalTargets: externalTargets[nodeIndex] ?? [],
			});
		}
	}

	const byFolder = new Map<number, CoastalPortCandidateScore[]>();
	for (const candidate of scoreCoastalPortCandidates(inputs)) {
		const owner = Number(candidate.continentId);
		const candidates = byFolder.get(owner);
		if (candidates === undefined) {
			byFolder.set(owner, [candidate]);
		} else {
			candidates.push(candidate);
		}
	}
	return byFolder;
}

/**
 * Converts inter-folder roads into a small, relatively scored set of coastal
 * cities. Root notes and orphans have owner -1 and never enter candidacy.
 */
export function deriveCoastalPortLayout(
	graph: GraphData,
	positions: ArrayLike<number>,
	folderIndexByNode: ArrayLike<number>,
	options: CoastalPortLayoutOptions = {},
): CoastalPortLayout {
	validateInputs(graph, positions, folderIndexByNode);
	const resolvedOptions = validateDerivationOptions(options);
	const folders = folderGeometries(graph, positions, folderIndexByNode);
	const scoredByFolder = candidatesByFolder(
		graph,
		positions,
		folderIndexByNode,
		folders,
	);
	const nodeIndexById = new Map(
		graph.nodes.map((node) => [node.id, node.index] as const),
	);
	const portScores = new Float32Array(graph.nodes.length);
	const portDirections = new Float32Array(graph.nodes.length * 3);

	for (const folder of folders.values()) {
		const selected = selectSeparatedCoastalPorts(
			scoredByFolder.get(folder.index) ?? [],
			selectionOptions(folder.members.length, resolvedOptions),
		);
		for (const port of selected) {
			const nodeIndex = nodeIndexById.get(port.nodeId);
			if (
				nodeIndex === undefined ||
				port.preferredTangentDirection === null
			) {
				continue;
			}
			const position = normalizeVec3(readVec3(positions, nodeIndex));
			const direction = tryNormalizeVec3(
				projectTangentVec3(
					position,
					port.preferredTangentDirection,
				),
			);
			if (direction === null) {
				continue;
			}
			portScores[nodeIndex] = port.score;
			writeVec3(portDirections, nodeIndex, direction);
		}
	}
	return { portScores, portDirections };
}

function interpolatedQuantile(
	sortedValues: readonly number[],
	quantile: number,
): number {
	if (sortedValues.length === 0) {
		return 0;
	}
	const rank = quantile * (sortedValues.length - 1);
	const lowerIndex = Math.floor(rank);
	const upperIndex = Math.ceil(rank);
	const lower = sortedValues[lowerIndex] ?? 0;
	const upper = sortedValues[upperIndex] ?? lower;
	return lower + (upper - lower) * (rank - lowerIndex);
}

/**
 * Moves selected ports toward the observed directional edge of their folder.
 *
 * The target comes from a robust quantile of signed intrinsic projections of
 * actual folder notes onto the outgoing bearing. Consequently an elongated
 * or ragged continent keeps its own silhouette; no common radial boundary is
 * introduced. The score blends the move and a hard angular cap bounds it.
 */
export function applyCoastalPortBias(
	positions: ArrayLike<number>,
	folderIndexByNode: ArrayLike<number>,
	ports: CoastalPortLayout,
	options: CoastalPortBiasOptions = {},
): Float32Array {
	if (positions.length % 3 !== 0) {
		throw new RangeError('Port-bias positions must contain complete vec3 values.');
	}
	const nodeCount = positions.length / 3;
	if (
		folderIndexByNode.length !== nodeCount ||
		ports.portScores.length !== nodeCount ||
		ports.portDirections.length !== positions.length
	) {
		throw new RangeError('Port-bias buffers must agree on node count.');
	}
	const supportQuantile =
		options.supportQuantile ?? DEFAULT_SUPPORT_QUANTILE;
	const maximumAngularShift =
		options.maximumAngularShift ?? DEFAULT_MAXIMUM_PORT_SHIFT;
	if (
		!Number.isFinite(supportQuantile) ||
		supportQuantile < 0 ||
		supportQuantile > 1
	) {
		throw new RangeError('Port support quantile must be within [0, 1].');
	}
	if (!Number.isFinite(maximumAngularShift) || maximumAngularShift < 0) {
		throw new RangeError(
			'Maximum port angular shift must be finite and non-negative.',
		);
	}

	const result = new Float32Array(positions.length);
	const membersByFolder = new Map<number, number[]>();
	for (let nodeIndex = 0; nodeIndex < nodeCount; nodeIndex += 1) {
		const position = normalizeVec3(readVec3(positions, nodeIndex));
		writeVec3(result, nodeIndex, position);
		const owner = folderIndexByNode[nodeIndex] ?? -1;
		if (owner >= 0) {
			const members = membersByFolder.get(owner);
			if (members === undefined) {
				membersByFolder.set(owner, [nodeIndex]);
			} else {
				members.push(nodeIndex);
			}
		}
	}
	const sourcePositions = result.slice();

	for (let nodeIndex = 0; nodeIndex < nodeCount; nodeIndex += 1) {
		const score = ports.portScores[nodeIndex] ?? 0;
		const owner = folderIndexByNode[nodeIndex] ?? -1;
		if (!(score > 0) || owner < 0 || maximumAngularShift === 0) {
			continue;
		}
		const position = normalizeVec3(readVec3(sourcePositions, nodeIndex));
		const direction = tryNormalizeVec3(
			projectTangentVec3(
				position,
				readVec3(ports.portDirections, nodeIndex),
			),
		);
		if (direction === null) {
			continue;
		}
		const support = (membersByFolder.get(owner) ?? [])
			.map((otherIndex) => {
				if (otherIndex === nodeIndex) {
					return 0;
				}
				const other = normalizeVec3(
					readVec3(sourcePositions, otherIndex),
				);
				const distance = geodesicDistance(position, other);
				const towardOther = tangentDirection(
					position,
					other,
					otherIndex,
				);
				return distance * dotVec3(towardOther, direction);
			})
			.sort((left, right) => left - right);
		const directionalExtent = Math.max(
			0,
			interpolatedQuantile(support, supportQuantile),
		);
		const blend = 0.35 + 0.65 * Math.sqrt(clamp(score, 0, 1));
		const angularShift = Math.min(
			maximumAngularShift,
			directionalExtent * blend,
		);
		if (angularShift > 0) {
			writeVec3(
				result,
				nodeIndex,
				exponentialMap(
					position,
					scaleVec3(direction, angularShift),
				),
			);
		}
	}
	return result;
}
