import {
	deterministicPermutation,
	hashNumbers,
	hashToSignedUnitFloat,
	hashToUnitFloat,
} from '../geometry/deterministicHash';
import {
	directoryRegionKey,
	isContinentalNode,
	topLevelFolder,
} from '../geography/directorySemantics';
import {
	exponentialMap,
	geodesicDistance,
	sphericalWeightedMean,
} from '../geometry/sphericalGeometry';
import {
	crossVec3,
	normalizeVec3,
	orthogonalUnitVec3,
	readVec3,
	scaleVec3,
	writeVec3,
	type Vec3,
} from '../geometry/vector3';
import type { GraphData } from '../graph/graphTypes';
import { fibonacciSpherePoint } from './initialization';
import { randomOceanOrphanPoints } from './organicSampling';

const CONTINENTAL_LAND_FRACTION = 0.48;
const MIN_FOLDER_EXTENT = 0.2;
const MAX_FOLDER_EXTENT = 1.28;
const MIN_COHORT_SIZE = 18;
const MAX_COHORT_SIZE = 84;
const REGION_CENTER_ATTEMPTS = 24;
const MAX_NODE_PLACEMENT_ATTEMPTS = 18;

export interface DirectoryInitialization {
	readonly positions: Float32Array;
	/**
	 * Stable, lexicographically ordered top-level folder indexes. Root notes
	 * and every orphan note deliberately remain unassigned (`-1`).
	 */
	readonly folderIndexByNode: Int32Array;
	/**
	 * Deterministic subfolder/topology cohort indexes. These are initialization
	 * hints only; they do not constrain the solver or define land boundaries.
	 */
	readonly regionIndexByNode: Int32Array;
}

interface WeightedNeighbor {
	readonly index: number;
	readonly weight: number;
}

interface FolderGroup {
	readonly index: number;
	readonly name: string;
	readonly members: number[];
	readonly center: Vec3;
	readonly extent: number;
}

interface RegionGroup {
	readonly index: number;
	readonly key: string;
	readonly members: number[];
	center: Vec3;
}

interface FolderRegionPlan {
	readonly regionsByFolder: readonly RegionGroup[][];
	readonly regionIndexByNode: Int32Array;
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
		const weight =
			Number.isFinite(edge.weight) && edge.weight > 0
				? edge.weight
				: 1;
		adjacency[edge.source]?.push({
			index: edge.target,
			weight,
		});
		adjacency[edge.target]?.push({
			index: edge.source,
			weight,
		});
	}
	for (const neighbors of adjacency) {
		neighbors.sort(
			(left, right) =>
				right.weight - left.weight || left.index - right.index,
		);
	}
	return adjacency;
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
	const result = new Int32Array(graph.nodes.length);
	result.fill(-1);
	for (const node of graph.nodes) {
		if (!isContinentalNode(node)) {
			continue;
		}
		const folder = topLevelFolder(node.path);
		if (folder !== undefined) {
			result[node.index] = indexByFolder.get(folder) ?? -1;
		}
	}
	return result;
}

function folderGroups(
	graph: GraphData,
	folderIndexByNode: Int32Array,
	seed: number,
): FolderGroup[] {
	const names = [
		...new Set(
			graph.nodes
				.filter((node) => (folderIndexByNode[node.index] ?? -1) >= 0)
				.map((node) => topLevelFolder(node.path))
				.filter((folder): folder is string => folder !== undefined),
		),
	].sort((left, right) => left.localeCompare(right));
	const members = Array.from(
		{ length: names.length },
		(): number[] => [],
	);
	for (const node of graph.nodes) {
		const folderIndex = folderIndexByNode[node.index] ?? -1;
		if (folderIndex >= 0) {
			members[folderIndex]?.push(node.index);
		}
	}
	const permutation = deterministicPermutation(
		names.length,
		hashNumbers(seed, names.length, 0xd1ae),
	);
	const totalMembers = Math.max(
		1,
		members.reduce((sum, groupMembers) => sum + groupMembers.length, 0),
	);
	const provisional = names.map((name, index) => {
		const pointIndex = permutation[index] ?? index;
		const memberCount = members[index]?.length ?? 0;
		const areaFraction =
			CONTINENTAL_LAND_FRACTION * memberCount / totalMembers;
		return {
			index,
			name,
			members: members[index] ?? [],
			center: fibonacciSpherePoint(pointIndex, names.length),
			extent: Math.min(
				MAX_FOLDER_EXTENT,
				Math.max(
					MIN_FOLDER_EXTENT,
					Math.acos(
						Math.max(-1, Math.min(1, 1 - 2 * areaFraction)),
					),
				),
			),
		};
	});
	return provisional.map((group) => {
		let nearestCenter = Math.PI;
		for (const other of provisional) {
			if (other.index !== group.index) {
				nearestCenter = Math.min(
					nearestCenter,
					geodesicDistance(group.center, other.center),
				);
			}
		}
		return {
			...group,
			extent:
				provisional.length <= 1
					? group.extent
					: Math.min(group.extent, nearestCenter * 0.45),
		};
	});
}

function connectedComponents(
	members: readonly number[],
	adjacency: readonly WeightedNeighbor[][],
): number[][] {
	const memberSet = new Set(members);
	const unvisited = new Set(members);
	const components: number[][] = [];
	for (const start of members) {
		if (!unvisited.delete(start)) {
			continue;
		}
		const component: number[] = [];
		const queue = [start];
		for (let cursor = 0; cursor < queue.length; cursor += 1) {
			const nodeIndex = queue[cursor];
			if (nodeIndex === undefined) {
				continue;
			}
			component.push(nodeIndex);
			for (const neighbor of adjacency[nodeIndex] ?? []) {
				if (
					memberSet.has(neighbor.index) &&
					unvisited.delete(neighbor.index)
				) {
					queue.push(neighbor.index);
				}
			}
		}
		component.sort((left, right) => left - right);
		components.push(component);
	}
	return components.sort(
		(left, right) =>
			right.length - left.length ||
			(left[0] ?? 0) - (right[0] ?? 0),
	);
}

/**
 * A weighted depth-first sweep keeps consecutive notes topologically local
 * without creating breadth-first distance shells. It is also O(V + E) in
 * memory and time: large folders never allocate one full distance buffer per
 * prospective cohort.
 */
function topologyTraversal(
	component: readonly number[],
	adjacency: readonly WeightedNeighbor[][],
): number[] {
	const memberSet = new Set(component);
	const first =
		component
			.map((nodeIndex) => ({
				nodeIndex,
				weight: (adjacency[nodeIndex] ?? []).reduce(
					(sum, neighbor) =>
						memberSet.has(neighbor.index)
							? sum + neighbor.weight
							: sum,
					0,
				),
			}))
			.sort(
				(left, right) =>
					right.weight - left.weight ||
					left.nodeIndex - right.nodeIndex,
			)[0]?.nodeIndex ?? component[0];
	if (first === undefined) {
		return [];
	}
	const visited = new Uint8Array(adjacency.length);
	const stack = [first];
	visited[first] = 1;
	const order: number[] = [];
	while (stack.length > 0) {
		const nodeIndex = stack.pop();
		if (nodeIndex === undefined) {
			continue;
		}
		order.push(nodeIndex);
		const neighbors = adjacency[nodeIndex] ?? [];
		// Neighbors are sorted strongest-first. Reverse insertion makes the
		// strongest available road the next DFS step.
		for (let offset = neighbors.length - 1; offset >= 0; offset -= 1) {
			const neighborIndex = neighbors[offset]?.index;
			if (
				neighborIndex !== undefined &&
				memberSet.has(neighborIndex) &&
				visited[neighborIndex] === 0
			) {
				visited[neighborIndex] = 1;
				stack.push(neighborIndex);
			}
		}
	}
	// connectedComponents normally guarantees full coverage. Keep this
	// deterministic fallback for defensive callers and malformed adjacency.
	for (const nodeIndex of component) {
		if (visited[nodeIndex] === 0) {
			order.push(nodeIndex);
		}
	}
	return order;
}

function splitTopologyComponent(
	component: readonly number[],
	targetSize: number,
	adjacency: readonly WeightedNeighbor[][],
): number[][] {
	const partCount = Math.max(1, Math.ceil(component.length / targetSize));
	if (partCount === 1) {
		return [[...component]];
	}
	const order = topologyTraversal(component, adjacency);
	const baseSize = Math.floor(order.length / partCount);
	const largerPartCount = order.length % partCount;
	const parts: number[][] = [];
	let cursor = 0;
	for (let index = 0; index < partCount; index += 1) {
		const size = baseSize + (index < largerPartCount ? 1 : 0);
		const part = order.slice(cursor, cursor + size);
		cursor += size;
		if (part.length > 0) {
			part.sort((left, right) => left - right);
			parts.push(part);
		}
	}
	return parts;
}

function cohortTargetSize(folderSize: number): number {
	return Math.min(
		MAX_COHORT_SIZE,
		Math.max(
			MIN_COHORT_SIZE,
			Math.round(Math.sqrt(Math.max(1, folderSize)) * 2.6),
		),
	);
}

function folderRegions(
	graph: GraphData,
	group: FolderGroup,
	adjacency: readonly WeightedNeighbor[][],
	firstRegionIndex: number,
): RegionGroup[] {
	const membersBySemanticRegion = new Map<string, number[]>();
	for (const nodeIndex of group.members) {
		const path = graph.nodes[nodeIndex]?.path ?? `${nodeIndex}`;
		const key = directoryRegionKey(path) ?? group.name;
		const members = membersBySemanticRegion.get(key);
		if (members === undefined) {
			membersBySemanticRegion.set(key, [nodeIndex]);
		} else {
			members.push(nodeIndex);
		}
	}
	const targetSize = cohortTargetSize(group.members.length);
	const smallLimit = Math.max(3, Math.floor(targetSize / 4));
	const cohorts: Array<{ key: string; members: number[] }> = [];
	for (const [key, members] of [...membersBySemanticRegion.entries()].sort(
		([left], [right]) => left.localeCompare(right),
	)) {
		const small: number[][] = [];
		for (const component of connectedComponents(members, adjacency)) {
			if (component.length <= smallLimit) {
				small.push(component);
				continue;
			}
			for (const part of splitTopologyComponent(
				component,
				targetSize,
				adjacency,
			)) {
				cohorts.push({ key, members: part });
			}
		}
		const bins: number[][] = [];
		for (const component of small) {
			let bin = bins.find(
				(candidate) =>
					candidate.length + component.length <= targetSize,
			);
			if (bin === undefined) {
				bin = [];
				bins.push(bin);
			}
			bin.push(...component);
		}
		for (const bin of bins) {
			bin.sort((left, right) => left - right);
			cohorts.push({ key, members: bin });
		}
	}
	cohorts.sort(
		(left, right) =>
			left.key.localeCompare(right.key) ||
			(left.members[0] ?? 0) - (right.members[0] ?? 0),
	);
	return cohorts.map((cohort, offset) => ({
		index: firstRegionIndex + offset,
		key: cohort.key,
		members: cohort.members,
		center: group.center,
	}));
}

function buildFolderRegionPlan(
	graph: GraphData,
	groups: readonly FolderGroup[],
	adjacency: readonly WeightedNeighbor[][],
): FolderRegionPlan {
	const regionIndexByNode = new Int32Array(graph.nodes.length);
	regionIndexByNode.fill(-1);
	const regionsByFolder: RegionGroup[][] = [];
	let nextRegionIndex = 0;
	for (const group of groups) {
		const regions = folderRegions(
			graph,
			group,
			adjacency,
			nextRegionIndex,
		);
		nextRegionIndex += regions.length;
		for (const region of regions) {
			for (const nodeIndex of region.members) {
				regionIndexByNode[nodeIndex] = region.index;
			}
		}
		regionsByFolder[group.index] = regions;
	}
	return { regionsByFolder, regionIndexByNode };
}

/**
 * Returns deterministic subfolder/topology cohort indexes without generating
 * positions. Refresh can therefore recover the same hierarchy metadata
 * directly from the current graph.
 */
export function directoryRegionIndexByNode(graph: GraphData): Int32Array {
	const folderIndexByNode = directoryFolderIndexByNode(graph);
	const adjacency = buildAdjacency(graph);
	const groups = folderGroups(graph, folderIndexByNode, 0);
	return buildFolderRegionPlan(graph, groups, adjacency).regionIndexByNode;
}

function tangentDirectionFromHash(position: Vec3, seed: number): Vec3 {
	const tangentX = orthogonalUnitVec3(position, seed);
	const tangentY = normalizeVec3(crossVec3(position, tangentX));
	const phase = hashToUnitFloat(seed, 0x91a5) * Math.PI * 2;
	return normalizeVec3([
		tangentX[0] * Math.cos(phase) +
			tangentY[0] * Math.sin(phase),
		tangentX[1] * Math.cos(phase) +
			tangentY[1] * Math.sin(phase),
		tangentX[2] * Math.cos(phase) +
			tangentY[2] * Math.sin(phase),
	]);
}

function nearestDistance(
	position: Vec3,
	placed: readonly Vec3[],
	seed: number,
	recentLimit = 96,
	sampleLimit = 32,
): number {
	if (placed.length === 0) {
		return Math.PI;
	}
	let maximumDot = -1;
	const include = (other: Vec3): void => {
		maximumDot = Math.max(
			maximumDot,
			position[0] * other[0] +
				position[1] * other[1] +
				position[2] * other[2],
		);
	};
	const recentStart = Math.max(0, placed.length - recentLimit);
	for (let index = recentStart; index < placed.length; index += 1) {
		const other = placed[index];
		if (other !== undefined) {
			include(other);
		}
	}
	if (recentStart > 0 && sampleLimit > 0) {
		const sampleCount = Math.min(sampleLimit, recentStart);
		const start = hashNumbers(seed, placed.length, 0x51a) % recentStart;
		const stride =
			(hashNumbers(seed, placed.length, 0x51b) %
				Math.max(1, recentStart - 1)) +
			1;
		for (let sample = 0; sample < sampleCount; sample += 1) {
			const other = placed[(start + sample * stride) % recentStart];
			if (other !== undefined) {
				include(other);
			}
		}
	}
	return Math.acos(Math.max(-1, Math.min(1, maximumDot)));
}

function nodePlacementBudget(folderSize: number): {
	readonly attempts: number;
	readonly recentLimit: number;
	readonly sampleLimit: number;
} {
	if (folderSize > 8_192) {
		return { attempts: 6, recentLimit: 32, sampleLimit: 8 };
	}
	if (folderSize > 2_048) {
		return { attempts: 8, recentLimit: 48, sampleLimit: 12 };
	}
	if (folderSize > 512) {
		return { attempts: 12, recentLimit: 72, sampleLimit: 20 };
	}
	return {
		attempts: MAX_NODE_PLACEMENT_ATTEMPTS,
		recentLimit: 96,
		sampleLimit: 32,
	};
}

function rootIslandPlacementBudget(rootIslandCount: number): {
	readonly attempts: number;
	readonly recentLimit: number;
	readonly sampleLimit: number;
} {
	if (rootIslandCount > 8_192) {
		return { attempts: 6, recentLimit: 32, sampleLimit: 8 };
	}
	if (rootIslandCount > 2_048) {
		return { attempts: 10, recentLimit: 48, sampleLimit: 12 };
	}
	if (rootIslandCount > 512) {
		return { attempts: 18, recentLimit: 72, sampleLimit: 20 };
	}
	if (rootIslandCount > 128) {
		return { attempts: 36, recentLimit: 96, sampleLimit: 32 };
	}
	return { attempts: 72, recentLimit: 96, sampleLimit: 32 };
}

function placeRegionCenters(
	group: FolderGroup,
	regions: RegionGroup[],
	seed: number,
): void {
	if (regions.length === 0) {
		return;
	}
	const ordered = [...regions].sort(
		(left, right) =>
			right.members.length - left.members.length ||
			left.key.localeCompare(right.key) ||
			left.index - right.index,
	);
	const targetSpacing =
		group.extent *
		Math.min(0.64, 0.82 / Math.sqrt(Math.max(1, regions.length)));
	const first = ordered[0];
	if (first !== undefined) {
		const firstSeed = hashNumbers(seed, group.index, first.index, 0x3e7);
		first.center = exponentialMap(
			group.center,
			scaleVec3(
				tangentDirectionFromHash(group.center, firstSeed),
				group.extent *
					(0.035 +
						hashToUnitFloat(firstSeed, 0x31) * 0.1),
			),
		);
	}
	const placed = first === undefined ? [] : [first.center];
	for (let index = 1; index < ordered.length; index += 1) {
		const region = ordered[index];
		if (region === undefined) {
			continue;
		}
		let best = group.center;
		let bestScore = Number.NEGATIVE_INFINITY;
		for (
			let attempt = 0;
			attempt < REGION_CENTER_ATTEMPTS;
			attempt += 1
		) {
			const candidateSeed = hashNumbers(
				seed,
				group.index,
				region.index,
				attempt,
				0xc37,
			);
			const parent =
				placed[
					hashNumbers(candidateSeed, 0x4a7) % placed.length
				] ?? group.center;
			const desiredSpacing =
				targetSpacing *
				(0.72 + hashToUnitFloat(candidateSeed, 0x5a1) * 0.78);
			const candidate = exponentialMap(
				parent,
				scaleVec3(
					tangentDirectionFromHash(parent, candidateSeed),
					desiredSpacing,
				),
			);
			const nearest = nearestDistance(
				candidate,
				placed,
				candidateSeed,
			);
			const radialDistance = geodesicDistance(
				group.center,
				candidate,
			);
			const softLimit =
				group.extent *
				(0.66 +
					hashToUnitFloat(candidateSeed, 0x61f) * 0.18);
			const overflow = Math.max(0, radialDistance - softLimit);
			const score =
				-Math.abs(nearest - desiredSpacing) -
				overflow * 4.5 +
				hashToSignedUnitFloat(candidateSeed, 0x82f) *
					targetSpacing *
					0.08;
			if (score > bestScore) {
				bestScore = score;
				best = candidate;
			}
		}
		region.center = best;
		placed.push(best);
	}
}

function graphTraversalOrder(
	region: RegionGroup,
	adjacency: readonly WeightedNeighbor[][],
): number[] {
	const memberSet = new Set(region.members);
	const seed =
		region.members
			.map((nodeIndex) => ({
				nodeIndex,
				weight: (adjacency[nodeIndex] ?? []).reduce(
					(sum, neighbor) =>
						memberSet.has(neighbor.index)
							? sum + neighbor.weight
							: sum,
					0,
				),
			}))
			.sort(
				(left, right) =>
					right.weight - left.weight ||
					left.nodeIndex - right.nodeIndex,
			)[0]?.nodeIndex;
	if (seed === undefined) {
		return [];
	}
	const order: number[] = [];
	const visited = new Set<number>([seed]);
	const queue = [seed];
	for (let cursor = 0; cursor < queue.length; cursor += 1) {
		const nodeIndex = queue[cursor];
		if (nodeIndex === undefined) {
			continue;
		}
		order.push(nodeIndex);
		for (const neighbor of adjacency[nodeIndex] ?? []) {
			if (
				memberSet.has(neighbor.index) &&
				!visited.has(neighbor.index)
			) {
				visited.add(neighbor.index);
				queue.push(neighbor.index);
			}
		}
	}
	for (const nodeIndex of region.members) {
		if (!visited.has(nodeIndex)) {
			order.push(nodeIndex);
		}
	}
	return order;
}

function preferredPlacedParent(
	nodeIndex: number,
	placedMask: Uint8Array,
	adjacency: readonly WeightedNeighbor[][],
	fallback: number,
): number {
	for (const neighbor of adjacency[nodeIndex] ?? []) {
		if (placedMask[neighbor.index] === 1) {
			return neighbor.index;
		}
	}
	return fallback;
}

function placeRegionNodes(
	positions: Float32Array,
	region: RegionGroup,
	group: FolderGroup,
	adjacency: readonly WeightedNeighbor[][],
	folderPositions: Vec3[],
	placedMask: Uint8Array,
	seed: number,
): void {
	const order = graphTraversalOrder(region, adjacency);
	if (order.length === 0) {
		return;
	}
	const regionShare =
		region.members.length / Math.max(1, group.members.length);
	const regionExtent =
		group.extent *
		Math.min(0.74, 0.24 + Math.sqrt(regionShare) * 0.48);
	const capArea =
		2 * Math.PI * (1 - Math.cos(Math.max(0.03, regionExtent)));
	const spacing = Math.max(
		0.012,
		Math.sqrt(capArea / Math.max(1, region.members.length)) * 0.68,
	);
	const placementBudget = nodePlacementBudget(group.members.length);
	for (let offset = 0; offset < order.length; offset += 1) {
		const nodeIndex = order[offset];
		if (nodeIndex === undefined) {
			continue;
		}
		const fallback = order[Math.max(0, offset - 1)] ?? nodeIndex;
		const parentIndex = preferredPlacedParent(
			nodeIndex,
			placedMask,
			adjacency,
			fallback,
		);
		const parent =
			placedMask[parentIndex] === 1
				? readVec3(positions, parentIndex)
				: region.center;
		let best = region.center;
		let bestScore = Number.NEGATIVE_INFINITY;
		for (
			let attempt = 0;
			attempt < placementBudget.attempts;
			attempt += 1
		) {
			const candidateSeed = hashNumbers(
				seed,
				group.index,
				region.index,
				nodeIndex,
				attempt,
				0x6d1,
			);
			const step =
				spacing *
				(0.62 +
					hashToUnitFloat(candidateSeed, 0x7b1) * 1.52);
			const candidate = exponentialMap(
				parent,
				scaleVec3(
					tangentDirectionFromHash(parent, candidateSeed),
					step,
				),
			);
			const nearest = nearestDistance(
				candidate,
				folderPositions,
				candidateSeed,
				placementBudget.recentLimit,
				placementBudget.sampleLimit,
			);
			const regionDistance = geodesicDistance(
				region.center,
				candidate,
			);
			const organicLimit =
				regionExtent *
				(0.62 +
					hashToUnitFloat(candidateSeed, 0x8b1) * 0.31);
			const regionOverflow = Math.max(
				0,
				regionDistance - organicLimit,
			);
			const folderOverflow = Math.max(
				0,
				geodesicDistance(group.center, candidate) -
					group.extent * 0.92,
			);
			const desiredClearance =
				spacing *
				(0.84 +
					hashToUnitFloat(candidateSeed, 0x9b1) * 0.38);
			const score =
				-Math.abs(nearest - desiredClearance) -
				regionOverflow * 2.8 -
				folderOverflow * 4.5 +
				hashToSignedUnitFloat(candidateSeed, 0xab1) *
					spacing *
					0.08;
			if (score > bestScore) {
				bestScore = score;
				best = candidate;
			}
		}
		writeVec3(positions, nodeIndex, best);
		folderPositions.push(best);
		placedMask[nodeIndex] = 1;
	}
}

function randomSpherePoint(seed: number, salt: number): Vec3 {
	const y = hashToSignedUnitFloat(seed, salt, 0x0a91);
	const phase =
		hashToUnitFloat(seed, salt, 0x0a92) * Math.PI * 2;
	const radial = Math.sqrt(Math.max(0, 1 - y * y));
	return [
		radial * Math.cos(phase),
		y,
		radial * Math.sin(phase),
	];
}

function rootIslandPoint(
	nodeIndex: number,
	adjacency: readonly WeightedNeighbor[][],
	folderByIndex: readonly (FolderGroup | undefined)[],
	groups: readonly FolderGroup[],
	occupied: readonly Vec3[],
	seed: number,
	attemptCount: number,
	recentLimit: number,
	sampleLimit: number,
): Vec3 {
	// A flat vault has no coastline to optimize against. A seeded spherical
	// point is both more honest and linear-time; the final collision pass
	// handles the rare close pair without an expensive candidate search.
	if (groups.length === 0) {
		return randomSpherePoint(seed, nodeIndex);
	}
	const linkedCenters: Vec3[] = [];
	const linkedWeights: number[] = [];
	for (const neighbor of adjacency[nodeIndex] ?? []) {
		const group = folderByIndex[neighbor.index];
		if (group !== undefined) {
			linkedCenters.push(group.center);
			linkedWeights.push(Math.max(1, neighbor.weight));
		}
	}
	const anchor =
		sphericalWeightedMean(linkedCenters, linkedWeights) ??
		randomSpherePoint(seed, nodeIndex);
	let best = randomSpherePoint(seed, nodeIndex);
	let bestScore = Number.NEGATIVE_INFINITY;
	for (let attempt = 0; attempt < attemptCount; attempt += 1) {
		const candidateSeed = hashNumbers(seed, nodeIndex, attempt, 0x151a);
		const candidate = randomSpherePoint(candidateSeed, attempt);
		let seaClearance = Math.PI;
		for (const group of groups) {
			seaClearance = Math.min(
				seaClearance,
				geodesicDistance(candidate, group.center) -
					group.extent,
			);
		}
		const clearance = nearestDistance(
			candidate,
			occupied,
			candidateSeed,
			recentLimit,
			sampleLimit,
		);
		const score =
			Math.min(0.35, seaClearance) -
			geodesicDistance(anchor, candidate) * 0.24 +
			Math.min(0.2, clearance) * 0.4;
		if (score > bestScore) {
			bestScore = score;
			best = candidate;
		}
	}
	return best;
}

function orphanPositionMap(
	graph: GraphData,
	folderIndexByNode: ArrayLike<number>,
	groups: readonly FolderGroup[],
	effectiveSeed: number,
): ReadonlyMap<number, Vec3> {
	const unconstrained = graph.nodes.filter(
		(node) => (folderIndexByNode[node.index] ?? -1) < 0,
	);
	return randomOceanOrphanPoints(
		unconstrained
			.filter((node) => node.degree === 0)
			.map((node) => node.index),
		groups.map((group) => ({
			center: group.center,
			radius: group.extent,
		})),
		hashNumbers(effectiveSeed, unconstrained.length, 0x0cea),
	);
}

/**
 * Computes only the deterministic ocean positions needed when Refresh adds
 * orphan notes. It deliberately skips adjacency, topology cohorts, and all
 * continental node placement.
 */
export function initializeDirectoryOrphanPositions(
	graph: GraphData,
	effectiveSeed: number,
): ReadonlyMap<number, Vec3> {
	const folderIndexByNode = directoryFolderIndexByNode(graph);
	const groups = folderGroups(
		graph,
		folderIndexByNode,
		effectiveSeed,
	);
	return orphanPositionMap(
		graph,
		folderIndexByNode,
		groups,
		effectiveSeed,
	);
}

/**
 * Creates a deterministic intrinsic S² starting state. Folder and region
 * membership shape only this initial state; the returned result contains no
 * territory caps, so subsequent solver passes remain free to find a better
 * geographic arrangement.
 */
export function initializeDirectoryLayout(
	graph: GraphData,
	effectiveSeed: number,
): DirectoryInitialization {
	const positions = new Float32Array(graph.nodes.length * 3);
	const folderIndexByNode = directoryFolderIndexByNode(graph);
	const adjacency = buildAdjacency(graph);
	const groups = folderGroups(
		graph,
		folderIndexByNode,
		effectiveSeed,
	);
	const regionPlan = buildFolderRegionPlan(graph, groups, adjacency);
	const { regionIndexByNode } = regionPlan;
	const placedMask = new Uint8Array(graph.nodes.length);
	for (const group of groups) {
		const regions = regionPlan.regionsByFolder[group.index] ?? [];
		placeRegionCenters(
			group,
			regions,
			hashNumbers(effectiveSeed, group.index, 0xc37),
		);
		const folderPositions: Vec3[] = [];
		for (const region of regions) {
			placeRegionNodes(
				positions,
				region,
				group,
				adjacency,
				folderPositions,
				placedMask,
				effectiveSeed,
			);
		}
	}

	const folderByIndex: Array<FolderGroup | undefined> = Array.from({
		length: graph.nodes.length,
	});
	for (const group of groups) {
		for (const nodeIndex of group.members) {
			folderByIndex[nodeIndex] = group;
		}
	}
	const unconstrained = graph.nodes.filter(
		(node) => (folderIndexByNode[node.index] ?? -1) < 0,
	);
	const orphanPositions = orphanPositionMap(
		graph,
		folderIndexByNode,
		groups,
		effectiveSeed,
	);
	const rootIslandCount = unconstrained.filter(
		(node) =>
			node.degree > 0 &&
			topLevelFolder(node.path) === undefined,
	).length;
	const rootIslandBudget =
		rootIslandPlacementBudget(rootIslandCount);
	const occupied = groups.flatMap((group) =>
		group.members.map((nodeIndex) => readVec3(positions, nodeIndex))
	);
	for (const node of unconstrained) {
		const position =
			node.degree > 0 && topLevelFolder(node.path) === undefined
				? rootIslandPoint(
						node.index,
						adjacency,
						folderByIndex,
						groups,
						occupied,
						effectiveSeed,
						rootIslandBudget.attempts,
						rootIslandBudget.recentLimit,
						rootIslandBudget.sampleLimit,
					)
				: (orphanPositions.get(node.index) ??
					randomSpherePoint(effectiveSeed, node.index));
		writeVec3(positions, node.index, position);
		occupied.push(position);
	}

	return {
		positions,
		folderIndexByNode,
		regionIndexByNode,
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
