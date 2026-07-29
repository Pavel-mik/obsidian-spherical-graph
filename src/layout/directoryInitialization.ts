import {
	deterministicPermutation,
	hashNumbers,
} from '../geometry/deterministicHash';
import {
	exponentialMap,
	geodesicDistance,
	sphericalWeightedMean,
} from '../geometry/sphericalGeometry';
import {
	crossVec3,
	normalizeVec3,
	orthogonalUnitVec3,
	scaleVec3,
	writeVec3,
	type Vec3,
} from '../geometry/vector3';
import {
	isContinentalNode,
	topLevelFolder,
} from '../geography/directorySemantics';
import type { GraphData } from '../graph/graphTypes';
import { fibonacciSpherePoint } from './initialization';
import type { LayoutTerritoryConstraints } from './layoutTypes';

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const CONTINENTAL_LAND_FRACTION = 0.48;
const MIN_TERRITORY_RADIUS = 0.18;
const MAX_TERRITORY_RADIUS = 1.48;

export interface DirectoryInitialization {
	readonly positions: Float32Array;
	readonly territory: LayoutTerritoryConstraints;
	readonly folderIndexByNode: Int32Array;
}

interface FolderGroup {
	readonly name: string;
	readonly members: number[];
	readonly weight: number;
	center: Vec3;
	radius: number;
}

interface FolderTerritory {
	readonly center: Vec3;
	readonly radius: number;
}

function separateTerritories(groups: FolderGroup[]): void {
	const seaGap = 0.08;
	for (let pass = 0; pass < 4; pass += 1) {
		for (let leftIndex = 0; leftIndex < groups.length; leftIndex += 1) {
			for (
				let rightIndex = leftIndex + 1;
				rightIndex < groups.length;
				rightIndex += 1
			) {
				const left = groups[leftIndex];
				const right = groups[rightIndex];
				if (left === undefined || right === undefined) {
					continue;
				}
				const available = Math.max(
					0.12,
					geodesicDistance(left.center, right.center) - seaGap,
				);
				const total = left.radius + right.radius;
				if (total <= available) {
					continue;
				}
				const scale = available / total;
				left.radius = Math.max(0.06, left.radius * scale);
				right.radius = Math.max(0.06, right.radius * scale);
			}
		}
	}
}

function folderGroups(graph: GraphData, seed: number): FolderGroup[] {
	const membersByFolder = new Map<string, number[]>();
	for (const node of graph.nodes) {
		if (!isContinentalNode(node)) {
			continue;
		}
		const folder = topLevelFolder(node.path);
		if (folder === undefined) {
			continue;
		}
		const members = membersByFolder.get(folder);
		if (members === undefined) {
			membersByFolder.set(folder, [node.index]);
		} else {
			members.push(node.index);
		}
	}
	const groups = [...membersByFolder.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([name, members]) => ({
			name,
			members,
			weight: Math.max(1, members.length) ** 0.8,
			center: [1, 0, 0] as Vec3,
			radius: MIN_TERRITORY_RADIUS,
		}));
	const permutation = deterministicPermutation(
		groups.length,
		hashNumbers(seed, groups.length, 0xd1ae),
	);
	const totalWeight = groups.reduce((sum, group) => sum + group.weight, 0);
	for (let index = 0; index < groups.length; index += 1) {
		const group = groups[index];
		const pointIndex = permutation[index];
		if (group === undefined || pointIndex === undefined) {
			continue;
		}
		group.center = fibonacciSpherePoint(pointIndex, groups.length);
		const areaFraction =
			CONTINENTAL_LAND_FRACTION *
			group.weight /
			Math.max(1, totalWeight);
		group.radius = Math.min(
			MAX_TERRITORY_RADIUS,
			Math.max(
				MIN_TERRITORY_RADIUS,
				Math.acos(Math.max(-1, Math.min(1, 1 - 2 * areaFraction))),
			),
		);
	}
	separateTerritories(groups);
	return groups;
}

export function directoryFolderIndexByNode(graph: GraphData): Int32Array {
	const folders = [
		...new Set(
			graph.nodes
				.filter(isContinentalNode)
				.map((node) => topLevelFolder(node.path))
				.filter((folder): folder is string => folder !== undefined),
		),
	].sort((left, right) => left.localeCompare(right));
	const indexByFolder = new Map(
		folders.map((folder, index) => [folder, index] as const),
	);
	return Int32Array.from(graph.nodes, (node) => {
		if (!isContinentalNode(node)) {
			return -1;
		}
		const folder = topLevelFolder(node.path);
		return folder === undefined ? -1 : (indexByFolder.get(folder) ?? -1);
	});
}

function capPoint(
	center: Vec3,
	index: number,
	count: number,
	radius: number,
	seed: number,
): Vec3 {
	const radialFraction = Math.sqrt((index + 0.45) / Math.max(1, count));
	const angularRadius = radius * radialFraction * 0.86;
	const phase =
		index * GOLDEN_ANGLE +
		(hashNumbers(seed, index, 0xc4f) / 0x1_0000_0000) * Math.PI * 2;
	const tangentX = orthogonalUnitVec3(center, seed);
	const tangentY = normalizeVec3(crossVec3(center, tangentX));
	const direction = normalizeVec3([
		tangentX[0] * Math.cos(phase) + tangentY[0] * Math.sin(phase),
		tangentX[1] * Math.cos(phase) + tangentY[1] * Math.sin(phase),
		tangentX[2] * Math.cos(phase) + tangentY[2] * Math.sin(phase),
	]);
	return exponentialMap(center, scaleVec3(direction, angularRadius));
}

function folderTerritoriesByNode(
	graph: GraphData,
	groups: readonly FolderGroup[],
): readonly (FolderTerritory | undefined)[] {
	const territoryByFolder = new Map(
		groups.map((group) => [
			group.name,
			{ center: group.center, radius: group.radius },
		] as const),
	);
	return graph.nodes.map((node) => {
		const folder = topLevelFolder(node.path);
		return folder === undefined
			? undefined
			: territoryByFolder.get(folder);
	});
}

function rootIslandPoint(
	graph: GraphData,
	nodeIndex: number,
	territoryByNode: readonly (FolderTerritory | undefined)[],
	groups: readonly FolderGroup[],
	seed: number,
): Vec3 {
	const centers: Vec3[] = [];
	const weights: number[] = [];
	for (const edge of graph.edges) {
		const other =
			edge.source === nodeIndex
				? edge.target
				: edge.target === nodeIndex
					? edge.source
					: undefined;
		const territory =
			other === undefined ? undefined : territoryByNode[other];
		if (territory !== undefined) {
			centers.push(territory.center);
			weights.push(Math.max(1, edge.weight));
		}
	}
	const anchor =
		sphericalWeightedMean(centers, weights) ??
		centers[0] ??
		fibonacciSpherePoint(
			hashNumbers(seed, nodeIndex, 0x151a) % 96,
			96,
		);
	let best = fibonacciSpherePoint(
		hashNumbers(seed, nodeIndex, 0x151a) % 96,
		96,
	);
	let bestScore = Number.NEGATIVE_INFINITY;
	for (let sample = 0; sample < 96; sample += 1) {
		const candidate = fibonacciSpherePoint(
			(hashNumbers(seed, nodeIndex, 0x151a) + sample) % 96,
			96,
		);
		let seaClearance = Math.PI;
		for (const group of groups) {
			seaClearance = Math.min(
				seaClearance,
				geodesicDistance(candidate, group.center) - group.radius,
			);
		}
		const score =
			seaClearance -
			geodesicDistance(anchor, candidate) * 0.28 +
			(seaClearance > 0.08 ? 10 : 0);
		if (score > bestScore) {
			bestScore = score;
			best = candidate;
		}
	}
	return best;
}

/**
 * Creates a deterministic intrinsic S² initialization where vault-root
 * folders own disjoint spherical territories. The solver may rearrange notes
 * inside their territory, but never moves a continental note across its hard
 * boundary.
 */
export function initializeDirectoryLayout(
	graph: GraphData,
	effectiveSeed: number,
): DirectoryInitialization {
	const positions = new Float32Array(graph.nodes.length * 3);
	const centers = new Float32Array(graph.nodes.length * 3);
	const maximumDistances = new Float32Array(graph.nodes.length);
	maximumDistances.fill(Math.PI);
	const folderIndexByNode = new Int32Array(graph.nodes.length);
	folderIndexByNode.set(directoryFolderIndexByNode(graph));
	const groups = folderGroups(graph, effectiveSeed);
	const territoryByNode = folderTerritoriesByNode(graph, groups);

	for (let folderIndex = 0; folderIndex < groups.length; folderIndex += 1) {
		const group = groups[folderIndex];
		if (group === undefined) {
			continue;
		}
		const permutation = deterministicPermutation(
			group.members.length,
			hashNumbers(effectiveSeed, folderIndex, 0x6d1),
		);
		for (let memberOffset = 0; memberOffset < group.members.length; memberOffset += 1) {
			const nodeIndex = group.members[memberOffset];
			const pointIndex = permutation[memberOffset];
			if (nodeIndex === undefined || pointIndex === undefined) {
				continue;
			}
			writeVec3(
				positions,
				nodeIndex,
				capPoint(
					group.center,
					pointIndex,
					group.members.length,
					group.radius,
					hashNumbers(effectiveSeed, folderIndex, nodeIndex),
				),
			);
			writeVec3(centers, nodeIndex, group.center);
			maximumDistances[nodeIndex] = group.radius;
			folderIndexByNode[nodeIndex] = folderIndex;
		}
	}

	const unconstrained = graph.nodes.filter(
		(node) => (folderIndexByNode[node.index] ?? -1) < 0,
	);
	const freePermutation = deterministicPermutation(
		unconstrained.length,
		hashNumbers(effectiveSeed, unconstrained.length, 0x0cea),
	);
	for (let offset = 0; offset < unconstrained.length; offset += 1) {
		const node = unconstrained[offset];
		if (node === undefined) {
			continue;
		}
		const position =
			node.degree > 0 && topLevelFolder(node.path) === undefined
				? rootIslandPoint(
						graph,
						node.index,
						territoryByNode,
						groups,
						effectiveSeed,
					)
				: fibonacciSpherePoint(
						freePermutation[offset] ?? offset,
						Math.max(1, unconstrained.length),
					);
		writeVec3(positions, node.index, position);
		writeVec3(centers, node.index, position);
	}

	return {
		positions,
		territory: {
			centers,
			maximumDistances,
			assignedNodeMask: Uint8Array.from(folderIndexByNode, (owner) =>
				owner >= 0 ? 1 : 0,
			),
		},
		folderIndexByNode,
	};
}

export function directoryAwareEdgeWeights(
	graph: GraphData,
	folderIndexByNode: ArrayLike<number>,
): Float32Array {
	return Float32Array.from(graph.edges, (edge) => {
		const sourceOwner = folderIndexByNode[edge.source] ?? -1;
		const targetOwner = folderIndexByNode[edge.target] ?? -1;
		const factor =
			sourceOwner >= 0 && sourceOwner === targetOwner
				? 1
				: sourceOwner < 0 || targetOwner < 0
					? 0.35
					: 0.14;
		return Math.max(0.05, edge.weight * factor);
	});
}
