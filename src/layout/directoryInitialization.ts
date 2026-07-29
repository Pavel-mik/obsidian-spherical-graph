import {
	deterministicPermutation,
	hashNumbers,
	hashString,
	hashToSignedUnitFloat,
	hashToUnitFloat,
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
const MIN_LOBE_COUNT = 1;
const MAX_LOBE_COUNT = 7;

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

interface FolderLobe {
	readonly center: Vec3;
	readonly radius: number;
	readonly members: readonly number[];
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

function lobeCount(memberCount: number): number {
	return Math.min(
		MAX_LOBE_COUNT,
		Math.max(
			MIN_LOBE_COUNT,
			Math.round(Math.sqrt(Math.max(1, memberCount)) / 3),
		),
	);
}

function regionKey(path: string): string {
	const parts = path.replaceAll('\\', '/').split('/');
	return parts.length >= 3
		? `${parts[0] ?? ''}/${parts[1] ?? ''}`
		: (parts[0] ?? path);
}

function assignMembersToLobes(
	graph: GraphData,
	group: FolderGroup,
	count: number,
	seed: number,
): number[][] {
	const membersByRegion = new Map<string, number[]>();
	for (const nodeIndex of group.members) {
		const path = graph.nodes[nodeIndex]?.path ?? `${nodeIndex}`;
		const key = regionKey(path);
		const members = membersByRegion.get(key);
		if (members === undefined) {
			membersByRegion.set(key, [nodeIndex]);
		} else {
			members.push(nodeIndex);
		}
	}
	const targetSize = Math.max(1, group.members.length / count);
	const lobes = Array.from({ length: count }, () => [] as number[]);
	const cohorts = [...membersByRegion.entries()].sort(
		([leftKey, left], [rightKey, right]) =>
			right.length - left.length || leftKey.localeCompare(rightKey),
	);
	for (const [key, members] of cohorts) {
		const span = Math.min(
			count,
			Math.max(1, Math.ceil(members.length / (targetSize * 1.2))),
		);
		const first = hashString(key, seed) % count;
		const permutation = deterministicPermutation(
			members.length,
			hashString(key, hashNumbers(seed, members.length)),
		);
		for (let offset = 0; offset < permutation.length; offset += 1) {
			const member = members[permutation[offset] ?? offset];
			if (member !== undefined) {
				lobes[(first + (offset % span)) % count]?.push(member);
			}
		}
	}
	for (let emptyIndex = 0; emptyIndex < lobes.length; emptyIndex += 1) {
		const empty = lobes[emptyIndex];
		if (empty === undefined || empty.length > 0) {
			continue;
		}
		const donor = lobes
			.map((members, index) => ({ members, index }))
			.filter(({ index }) => index !== emptyIndex)
			.sort(
				(left, right) =>
					right.members.length - left.members.length ||
					left.index - right.index,
			)[0]?.members;
		if (donor === undefined || donor.length <= 1) {
			continue;
		}
		const transferCount = Math.max(
			1,
			Math.floor(donor.length / (count + 1)),
		);
		empty.push(...donor.splice(-transferCount));
	}
	return lobes;
}

function folderLobes(
	graph: GraphData,
	group: FolderGroup,
	folderIndex: number,
	seed: number,
): readonly FolderLobe[] {
	const count = lobeCount(group.members.length);
	const membersByLobe = assignMembersToLobes(
		graph,
		group,
		count,
		hashNumbers(seed, folderIndex, 0x10be),
	);
	const tangentX = orthogonalUnitVec3(group.center, seed);
	const tangentY = normalizeVec3(crossVec3(group.center, tangentX));
	return membersByLobe.flatMap((members, index) => {
		if (members.length === 0) {
			return [];
		}
		const lobeSeed = hashNumbers(seed, folderIndex, index, 0x10be);
		const phase =
			index * GOLDEN_ANGLE +
			hashToUnitFloat(lobeSeed, 0x91a5) * Math.PI * 2;
		const centerOffset =
			count === 1
				? group.radius * 0.08
				: group.radius *
					(0.12 + hashToUnitFloat(lobeSeed, 0x0ff5) * 0.2);
		const direction = normalizeVec3([
			tangentX[0] * Math.cos(phase) +
				tangentY[0] * Math.sin(phase),
			tangentX[1] * Math.cos(phase) +
				tangentY[1] * Math.sin(phase),
			tangentX[2] * Math.cos(phase) +
				tangentY[2] * Math.sin(phase),
		]);
		return [
			{
				center: exponentialMap(
					group.center,
					scaleVec3(direction, centerOffset),
				),
				radius:
					group.radius *
					(count === 1
						? 0.72
						: 0.43 +
							hashToUnitFloat(lobeSeed, 0x6ad1) * 0.07),
				members,
			},
		];
	});
}

function organicBoundaryScale(phase: number, seed: number): number {
	const firstPhase =
		hashToSignedUnitFloat(seed, 0xb01) * Math.PI;
	const secondPhase =
		hashToSignedUnitFloat(seed, 0xb02) * Math.PI;
	const detailPhase =
		hashToSignedUnitFloat(seed, 0xb03) * Math.PI;
	return Math.max(
		0.52,
		Math.min(
			0.96,
			0.77 +
				Math.sin(phase * 2 + firstPhase) * 0.1 +
				Math.sin(phase * 3 + secondPhase) * 0.075 +
				Math.sin(phase * 7 + detailPhase) * 0.045,
		),
	);
}

function organicCapPlacement(
	center: Vec3,
	index: number,
	count: number,
	radius: number,
	seed: number,
): {
	readonly position: Vec3;
	readonly maximumDistance: number;
} {
	const radialFraction = Math.sqrt((index + 0.45) / Math.max(1, count));
	const phase =
		index * GOLDEN_ANGLE +
		(hashNumbers(seed, index, 0xc4f) / 0x1_0000_0000) * Math.PI * 2;
	const maximumDistance = radius * organicBoundaryScale(phase, seed);
	const angularRadius = maximumDistance * radialFraction * 0.88;
	const tangentX = orthogonalUnitVec3(center, seed);
	const tangentY = normalizeVec3(crossVec3(center, tangentX));
	const direction = normalizeVec3([
		tangentX[0] * Math.cos(phase) + tangentY[0] * Math.sin(phase),
		tangentX[1] * Math.cos(phase) + tangentY[1] * Math.sin(phase),
		tangentX[2] * Math.cos(phase) + tangentY[2] * Math.sin(phase),
	]);
	return {
		position: exponentialMap(
			center,
			scaleVec3(direction, angularRadius),
		),
		maximumDistance,
	};
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
		const lobes = folderLobes(
			graph,
			group,
			folderIndex,
			effectiveSeed,
		);
		for (let lobeIndex = 0; lobeIndex < lobes.length; lobeIndex += 1) {
			const lobe = lobes[lobeIndex];
			if (lobe === undefined) {
				continue;
			}
			const permutation = deterministicPermutation(
				lobe.members.length,
				hashNumbers(effectiveSeed, folderIndex, lobeIndex, 0x6d1),
			);
			for (
				let memberOffset = 0;
				memberOffset < lobe.members.length;
				memberOffset += 1
			) {
				const nodeIndex = lobe.members[memberOffset];
				const pointIndex = permutation[memberOffset];
				if (nodeIndex === undefined || pointIndex === undefined) {
					continue;
				}
				const placement = organicCapPlacement(
					lobe.center,
					pointIndex,
					lobe.members.length,
					lobe.radius,
					hashNumbers(
						effectiveSeed,
						folderIndex,
						lobeIndex,
						nodeIndex,
					),
				);
				writeVec3(positions, nodeIndex, placement.position);
				writeVec3(centers, nodeIndex, lobe.center);
				maximumDistances[nodeIndex] =
					placement.maximumDistance;
				folderIndexByNode[nodeIndex] = folderIndex;
			}
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
