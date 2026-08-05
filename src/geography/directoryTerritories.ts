import {
	hashNumbers,
	hashToSignedUnitFloat,
} from '../geometry/deterministicHash';
import {
	geodesicDistance,
	sphericalWeightedMean,
} from '../geometry/sphericalGeometry';
import {
	dotVec3,
	normalizeVec3,
	orthogonalUnitVec3,
	readVec3,
	writeVec3,
	type Vec3,
} from '../geometry/vector3';
import type { GraphData } from '../graph/graphTypes';
import type { PersistedDirectoryTerritory } from './geographyTypes';
import {
	isContinentalNode,
	topLevelFolder,
} from './directorySemantics';
import {
	createIntrinsicSphericalGrid,
	type IntrinsicSphericalGrid,
} from './sphericalGrid';

export const DIRECTORY_TERRITORY_LAND_FRACTION = 0.48;
export const DIRECTORY_TERRITORY_MIN_SUBDIVISION = 4;
export const DIRECTORY_TERRITORY_MAX_SUBDIVISION = 5;

export interface DirectoryTerritoryPlan {
	readonly subdivision: number;
	readonly folderKeys: readonly string[];
	readonly ownerByCell: Int32Array;
	readonly targetCellCounts: Int32Array;
}

export interface DirectoryTerritoryDiagnostics {
	readonly landFraction: number;
	readonly componentCounts: readonly number[];
	readonly thinCellFractions: readonly number[];
	readonly actualCellCounts: readonly number[];
	readonly targetCellCounts: readonly number[];
}

interface GrowthEntry {
	readonly owner: number;
	readonly cell: number;
	readonly priority: number;
}

interface OwnerShape {
	readonly center: Vec3;
	readonly tangentX: Vec3;
	readonly tangentY: Vec3;
	readonly xScale: number;
	readonly yScale: number;
	readonly phase: number;
}

function folderKeys(graph: GraphData): string[] {
	return [
		...new Set(
			graph.nodes
				.filter(isContinentalNode)
				.map((node) => topLevelFolder(node.path))
				.filter((value): value is string => value !== undefined),
		),
	].sort((left, right) => left.localeCompare(right));
}

export function directoryTerritoryFolderKeys(
	graph: GraphData,
): readonly string[] {
	return Object.freeze(folderKeys(graph));
}

function ownerCenters(
	positions: ArrayLike<number>,
	folderIndexByNode: Int32Array,
	ownerCount: number,
): Vec3[] {
	const members = Array.from({ length: ownerCount }, () => [] as Vec3[]);
	for (let nodeIndex = 0; nodeIndex < folderIndexByNode.length; nodeIndex += 1) {
		const owner = folderIndexByNode[nodeIndex] ?? -1;
		if (owner >= 0 && owner < ownerCount) {
			members[owner]?.push(readVec3(positions, nodeIndex));
		}
	}
	return members.map(
		(group, owner) =>
			sphericalWeightedMean(group) ??
			orthogonalUnitVec3([0, 0, 1], hashNumbers(owner, 0x7e22)),
	);
}

function targetCounts(
	memberCounts: readonly number[],
	cellCount: number,
): Int32Array {
	const ownerCount = memberCounts.length;
	const result = new Int32Array(ownerCount);
	if (ownerCount === 0) {
		return result;
	}
	const totalLand = Math.max(
		ownerCount,
		Math.min(
			cellCount - ownerCount,
			Math.round(cellCount * DIRECTORY_TERRITORY_LAND_FRACTION),
		),
	);
	const base = Math.max(
		2,
		Math.min(12, Math.floor((totalLand * 0.12) / ownerCount)),
	);
	const baseTotal = Math.min(totalLand, base * ownerCount);
	for (let owner = 0; owner < ownerCount; owner += 1) {
		result[owner] = Math.floor(baseTotal / ownerCount);
	}
	for (let owner = 0; owner < baseTotal % ownerCount; owner += 1) {
		result[owner] = (result[owner] ?? 0) + 1;
	}
	const remaining = totalLand - baseTotal;
	const smoothed = memberCounts.map((count) => Math.max(1, count) ** 0.88);
	const weightSum = smoothed.reduce((sum, value) => sum + value, 0);
	const remainders: Array<{ owner: number; fraction: number }> = [];
	let assigned = baseTotal;
	for (let owner = 0; owner < ownerCount; owner += 1) {
		const exact = remaining * (smoothed[owner] ?? 0) / Math.max(1, weightSum);
		const whole = Math.floor(exact);
		result[owner] = (result[owner] ?? 0) + whole;
		assigned += whole;
		remainders.push({ owner, fraction: exact - whole });
	}
	remainders.sort(
		(left, right) => right.fraction - left.fraction || left.owner - right.owner,
	);
	for (let index = 0; assigned < totalLand; index += 1, assigned += 1) {
		const owner = remainders[index % remainders.length]?.owner ?? 0;
		result[owner] = (result[owner] ?? 0) + 1;
	}
	return result;
}

function push(queue: GrowthEntry[], entry: GrowthEntry): void {
	queue.push(entry);
	let index = queue.length - 1;
	while (index > 0) {
		const parentIndex = Math.floor((index - 1) / 2);
		const parent = queue[parentIndex];
		if (
			parent !== undefined &&
			(parent.priority < entry.priority ||
				(parent.priority === entry.priority &&
					(parent.owner < entry.owner ||
						(parent.owner === entry.owner && parent.cell <= entry.cell))))
		) {
			break;
		}
		queue[index] = parent ?? entry;
		index = parentIndex;
	}
	queue[index] = entry;
}

function pop(queue: GrowthEntry[]): GrowthEntry | undefined {
	const first = queue[0];
	const tail = queue.pop();
	if (first === undefined || tail === undefined || queue.length === 0) {
		return first;
	}
	let index = 0;
	while (true) {
		const leftIndex = index * 2 + 1;
		const rightIndex = leftIndex + 1;
		const left = queue[leftIndex];
		const right = queue[rightIndex];
		if (left === undefined) {
			break;
		}
		const childIndex =
			right !== undefined &&
			(right.priority < left.priority ||
				(right.priority === left.priority &&
					(right.owner < left.owner ||
						(right.owner === left.owner && right.cell < left.cell))))
				? rightIndex
				: leftIndex;
		const child = queue[childIndex];
		if (
			child === undefined ||
			tail.priority < child.priority ||
			(tail.priority === child.priority &&
				(tail.owner < child.owner ||
					(tail.owner === child.owner && tail.cell <= child.cell)))
		) {
			break;
		}
		queue[index] = child;
		index = childIndex;
	}
	queue[index] = tail;
	return first;
}

function shapeForOwner(center: Vec3, seed: number, owner: number): OwnerShape {
	const tangentX = orthogonalUnitVec3(center, hashNumbers(seed, owner, 0xa715));
	const tangentY = normalizeVec3([
		center[1] * tangentX[2] - center[2] * tangentX[1],
		center[2] * tangentX[0] - center[0] * tangentX[2],
		center[0] * tangentX[1] - center[1] * tangentX[0],
	]);
	const stretch = hashToSignedUnitFloat(seed, owner, 0xe11a) * 0.18;
	return {
		center,
		tangentX,
		tangentY,
		xScale: 1 + stretch,
		yScale: 1 - stretch,
		phase: hashToSignedUnitFloat(seed, owner, 0xfa5e) * Math.PI,
	};
}

function growthPriority(
	grid: IntrinsicSphericalGrid,
	shape: OwnerShape,
	owners: Int32Array,
	owner: number,
	cell: number,
	seed: number,
): number {
	const point = grid.vertices[cell] ?? shape.center;
	const x = dotVec3(point, shape.tangentX) / shape.xScale;
	const y = dotVec3(point, shape.tangentY) / shape.yScale;
	const radial = Math.hypot(x, y);
	const angle = Math.atan2(y, x);
	const relief =
		Math.sin(angle * 3 + shape.phase) * 0.018 +
		Math.sin(angle * 7 - shape.phase * 0.63) * 0.012 +
		Math.sin(angle * 13 + shape.phase * 1.37) * 0.007 +
		hashToSignedUnitFloat(seed, owner, cell, 0xc0457) * 0.006;
	let support = 0;
	for (const neighbor of grid.neighbors[cell] ?? []) {
		support += (owners[neighbor] ?? -1) === owner ? 1 : 0;
	}
	return radial + relief - Math.min(4, support) * 0.013;
}

function hasForeignNeighbor(
	grid: IntrinsicSphericalGrid,
	owners: Int32Array,
	cell: number,
	owner: number,
): boolean {
	return (grid.neighbors[cell] ?? []).some((neighbor) => {
		const value = owners[neighbor] ?? -1;
		return value >= 0 && value !== owner;
	});
}

function nearestAvailableSeed(
	grid: IntrinsicSphericalGrid,
	owners: Int32Array,
	center: Vec3,
): number {
	const existingSeeds: Vec3[] = [];
	for (let cell = 0; cell < owners.length; cell += 1) {
		if ((owners[cell] ?? -1) >= 0) {
			const point = grid.vertices[cell];
			if (point !== undefined) {
				existingSeeds.push(point);
			}
		}
	}
	const candidates = grid.vertices
		.map((point, cell) => {
			const separation = existingSeeds.length === 0
				? 0
				: Math.min(
						...existingSeeds.map((seed) => geodesicDistance(seed, point)),
					);
			return {
				cell,
				similarity: dotVec3(center, point),
				priority: dotVec3(center, point) + separation * 0.72,
			};
		})
		.sort(
			(left, right) =>
				right.priority - left.priority ||
				right.similarity - left.similarity ||
				left.cell - right.cell,
		);
	for (const candidate of candidates) {
		if (
			(owners[candidate.cell] ?? -1) < 0 &&
			!hasForeignNeighbor(grid, owners, candidate.cell, -2)
		) {
			return candidate.cell;
		}
	}
	return candidates.find((candidate) => (owners[candidate.cell] ?? -1) < 0)?.cell ?? 0;
}

export function createDirectoryTerritoryPlan(
	graph: GraphData,
	positions: ArrayLike<number>,
	folderIndexByNode: Int32Array,
	seed: number,
): DirectoryTerritoryPlan {
	if (
		positions.length !== graph.nodes.length * 3 ||
		folderIndexByNode.length !== graph.nodes.length
	) {
		throw new RangeError('Territory planning buffers must align with graph nodes.');
	}
	const keys = folderKeys(graph);
	const subdivision =
		graph.nodes.length > 900 || keys.length > 64
			? DIRECTORY_TERRITORY_MAX_SUBDIVISION
			: DIRECTORY_TERRITORY_MIN_SUBDIVISION;
	const grid = createIntrinsicSphericalGrid(subdivision);
	const counts = Array.from({ length: keys.length }, () => 0);
	for (const owner of folderIndexByNode) {
		if (owner >= 0 && owner < counts.length) {
			counts[owner] = (counts[owner] ?? 0) + 1;
		}
	}
	const targets = targetCounts(counts, grid.vertices.length);
	const centers = ownerCenters(positions, folderIndexByNode, keys.length);
	const shapes = centers.map((center, owner) => shapeForOwner(center, seed, owner));
	const owners = new Int32Array(grid.vertices.length);
	owners.fill(-1);
	const actual = new Int32Array(keys.length);
	const queues = Array.from(
		{ length: keys.length },
		() => [] as GrowthEntry[],
	);
	const seedOrder = [...keys.keys()].sort(
		(left, right) =>
			(targets[right] ?? 0) - (targets[left] ?? 0) || left - right,
	);
	for (const owner of seedOrder) {
		const cell = nearestAvailableSeed(grid, owners, centers[owner] ?? [0, 0, 1]);
		owners[cell] = owner;
		actual[owner] = 1;
	}
	const enqueueNeighbors = (owner: number, cell: number): void => {
		const shape = shapes[owner];
		if (shape === undefined) {
			return;
		}
		for (const neighbor of grid.neighbors[cell] ?? []) {
			if ((owners[neighbor] ?? -1) < 0) {
				push(queues[owner] ?? [], {
					owner,
					cell: neighbor,
					priority: growthPriority(
						grid,
						shape,
						owners,
						owner,
						neighbor,
						seed,
					),
				});
			}
		}
	};
	for (let owner = 0; owner < keys.length; owner += 1) {
		const seedCell = owners.findIndex((value) => value === owner);
		if (seedCell >= 0) {
			enqueueNeighbors(owner, seedCell);
		}
	}
	while (true) {
		let selectedOwner = -1;
		let selectedRatio = Number.POSITIVE_INFINITY;
		for (let owner = 0; owner < queues.length; owner += 1) {
			if (
				(actual[owner] ?? 0) >= (targets[owner] ?? 0) ||
				(queues[owner]?.length ?? 0) === 0
			) {
				continue;
			}
			const ratio = (actual[owner] ?? 0) / Math.max(1, targets[owner] ?? 1);
			if (
				ratio < selectedRatio - 1e-12 ||
				(Math.abs(ratio - selectedRatio) <= 1e-12 && owner < selectedOwner)
			) {
				selectedRatio = ratio;
				selectedOwner = owner;
			}
		}
		if (selectedOwner < 0) {
			break;
		}
		const ownerQueue = queues[selectedOwner];
		let entry: GrowthEntry | undefined;
		while (ownerQueue !== undefined && ownerQueue.length > 0) {
			const candidate = pop(ownerQueue);
			if (
				candidate !== undefined &&
				(owners[candidate.cell] ?? -1) < 0 &&
				(grid.neighbors[candidate.cell] ?? []).some(
					(neighbor) => (owners[neighbor] ?? -1) === selectedOwner,
				) &&
				!hasForeignNeighbor(grid, owners, candidate.cell, selectedOwner)
			) {
				entry = candidate;
				break;
			}
		}
		if (entry === undefined) {
			continue;
		}
		owners[entry.cell] = selectedOwner;
		actual[selectedOwner] = (actual[selectedOwner] ?? 0) + 1;
		enqueueNeighbors(selectedOwner, entry.cell);
	}
	return {
		subdivision,
		folderKeys: Object.freeze([...keys]),
		ownerByCell: owners,
		targetCellCounts: targets,
	};
}

export function restoreDirectoryTerritoryPlan(
	graph: GraphData,
	value: PersistedDirectoryTerritory | undefined,
): DirectoryTerritoryPlan | undefined {
	if (value === undefined) {
		return undefined;
	}
	const keys = folderKeys(graph);
	if (
		keys.length !== value.folderKeys.length ||
		keys.some((key, index) => key !== value.folderKeys[index]) ||
		!Number.isSafeInteger(value.subdivision) ||
		value.subdivision < DIRECTORY_TERRITORY_MIN_SUBDIVISION ||
		value.subdivision > DIRECTORY_TERRITORY_MAX_SUBDIVISION
	) {
		return undefined;
	}
	const grid = createIntrinsicSphericalGrid(value.subdivision);
	if (value.ownerByCell.length !== grid.vertices.length) {
		return undefined;
	}
	const owners = Int32Array.from(value.ownerByCell);
	const counts = new Int32Array(keys.length);
	for (const owner of owners) {
		if (owner < -1 || owner >= keys.length) {
			return undefined;
		}
		if (owner >= 0) {
			counts[owner] = (counts[owner] ?? 0) + 1;
		}
	}
	return {
		subdivision: value.subdivision,
		folderKeys: Object.freeze(keys),
		ownerByCell: owners,
		targetCellCounts: counts.slice(),
	};
}

function planGrid(plan: DirectoryTerritoryPlan): IntrinsicSphericalGrid {
	const grid = createIntrinsicSphericalGrid(plan.subdivision);
	if (grid.vertices.length !== plan.ownerByCell.length) {
		throw new RangeError('Territory raster length does not match its subdivision.');
	}
	return grid;
}

export function seedDirectoryNodesInTerritories(
	graph: GraphData,
	positions: Float32Array,
	folderIndexByNode: Int32Array,
	plan: DirectoryTerritoryPlan,
	seed: number,
): Float32Array {
	const grid = planGrid(plan);
	const result = positions.slice();
	const cellsByOwner = Array.from(
		{ length: plan.folderKeys.length },
		() => [] as number[],
	);
	for (let cell = 0; cell < plan.ownerByCell.length; cell += 1) {
		const owner = plan.ownerByCell[cell] ?? -1;
		if (owner >= 0 && owner < cellsByOwner.length) {
			cellsByOwner[owner]?.push(cell);
		}
	}
	const nodesByOwner = Array.from(
		{ length: plan.folderKeys.length },
		() => [] as number[],
	);
	for (const node of graph.nodes) {
		const owner = folderIndexByNode[node.index] ?? -1;
		if (owner >= 0 && owner < nodesByOwner.length) {
			nodesByOwner[owner]?.push(node.index);
		}
	}
	for (let owner = 0; owner < nodesByOwner.length; owner += 1) {
		const candidates = cellsByOwner[owner] ?? [];
		const nodes = (nodesByOwner[owner] ?? []).sort((left, right) => {
			const leftNode = graph.nodes[left];
			const rightNode = graph.nodes[right];
			return (
				(rightNode?.weightedDegree ?? 0) - (leftNode?.weightedDegree ?? 0) ||
				hashNumbers(seed, left, owner) - hashNumbers(seed, right, owner) ||
				left - right
			);
		});
		if (candidates.length === 0) {
			continue;
		}
		const used = new Uint8Array(candidates.length);
		const nearestSelectedDistance = new Float64Array(candidates.length);
		nearestSelectedDistance.fill(Math.PI);
		for (let ordinal = 0; ordinal < nodes.length; ordinal += 1) {
			const nodeIndex = nodes[ordinal];
			if (nodeIndex === undefined) {
				continue;
			}
			const original = normalizeVec3(readVec3(positions, nodeIndex));
			let bestCandidateIndex = -1;
			let bestScore = Number.NEGATIVE_INFINITY;
			for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
				if (used[candidateIndex] === 1 && ordinal < candidates.length) {
					continue;
				}
				const cell = candidates[candidateIndex] ?? -1;
				const point = grid.vertices[cell];
				if (point === undefined) {
					continue;
				}
				const affinity = dotVec3(original, point);
				const separation = nearestSelectedDistance[candidateIndex] ?? Math.PI;
				const noise = hashToSignedUnitFloat(seed, owner, nodeIndex, cell) * 0.012;
				const score = (ordinal === 0 ? 0 : separation) + affinity * 0.16 + noise;
				if (score > bestScore) {
					bestScore = score;
					bestCandidateIndex = candidateIndex;
				}
			}
			if (bestCandidateIndex < 0) {
				bestCandidateIndex = hashNumbers(seed, owner, nodeIndex) % candidates.length;
			}
			used[bestCandidateIndex] = 1;
			const selectedCell = candidates[bestCandidateIndex] ?? candidates[0] ?? 0;
			const selected = grid.vertices[selectedCell] ?? original;
			const blended = normalizeVec3([
				selected[0] * 0.96 + original[0] * 0.04,
				selected[1] * 0.96 + original[1] * 0.04,
				selected[2] * 0.96 + original[2] * 0.04,
			]);
			writeVec3(result, nodeIndex, blended);
			for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
				const cell = candidates[candidateIndex] ?? -1;
				const point = grid.vertices[cell];
				if (point !== undefined) {
					nearestSelectedDistance[candidateIndex] = Math.min(
						nearestSelectedDistance[candidateIndex] ?? Math.PI,
						geodesicDistance(selected, point),
					);
				}
			}
		}
	}
	return result;
}

export function directoryTerritoryDiagnostics(
	plan: DirectoryTerritoryPlan,
): DirectoryTerritoryDiagnostics {
	const grid = planGrid(plan);
	const ownerCount = plan.folderKeys.length;
	const actual = Array.from({ length: ownerCount }, () => 0);
	const thin = Array.from({ length: ownerCount }, () => 0);
	const components = Array.from({ length: ownerCount }, () => 0);
	let landCount = 0;
	for (let cell = 0; cell < plan.ownerByCell.length; cell += 1) {
		const owner = plan.ownerByCell[cell] ?? -1;
		if (owner < 0 || owner >= ownerCount) {
			continue;
		}
		landCount += 1;
		actual[owner] = (actual[owner] ?? 0) + 1;
		let same = 0;
		for (const neighbor of grid.neighbors[cell] ?? []) {
			same += (plan.ownerByCell[neighbor] ?? -1) === owner ? 1 : 0;
		}
		if (same <= 2) {
			thin[owner] = (thin[owner] ?? 0) + 1;
		}
	}
	const seen = new Uint8Array(plan.ownerByCell.length);
	for (let start = 0; start < plan.ownerByCell.length; start += 1) {
		const owner = plan.ownerByCell[start] ?? -1;
		if (owner < 0 || seen[start] === 1) {
			continue;
		}
		components[owner] = (components[owner] ?? 0) + 1;
		seen[start] = 1;
		const queue = [start];
		for (let cursor = 0; cursor < queue.length; cursor += 1) {
			for (const neighbor of grid.neighbors[queue[cursor] ?? -1] ?? []) {
				if (seen[neighbor] === 0 && (plan.ownerByCell[neighbor] ?? -1) === owner) {
					seen[neighbor] = 1;
					queue.push(neighbor);
				}
			}
		}
	}
	return {
		landFraction: landCount / Math.max(1, plan.ownerByCell.length),
		componentCounts: Object.freeze(components),
		thinCellFractions: Object.freeze(
			actual.map((count, owner) => count === 0 ? 0 : (thin[owner] ?? 0) / count),
		),
		actualCellCounts: Object.freeze(actual),
		targetCellCounts: Object.freeze([...plan.targetCellCounts]),
	};
}
