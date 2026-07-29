import {
	hashNumbers,
	hashToSignedUnitFloat,
} from '../geometry/deterministicHash';
import { sampleGeodesicArc } from '../geometry/geodesicArc';
import { geodesicDistance } from '../geometry/sphericalGeometry';
import {
	dotVec3,
	normalizeVec3,
	readVec3,
	type Vec3,
} from '../geometry/vector3';
import {
	createIntrinsicSphericalGrid,
	gridSubdivisionForSpacing,
	mapPositionsToGrid,
	type IntrinsicSphericalGrid,
} from '../geography/sphericalGrid';
import type {
	RenderEdge,
	RenderGeography,
} from './renderTypes';

const DENSITY_BUCKET_CELL_SIZE = 0.12;
const RASTER_BUCKET_CELL_SIZE = 0.08;
const BOUNDARY_BUCKET_CELL_SIZE = 0.09;
const MIN_NODE_BANDWIDTH = 0.052;
const MAX_NODE_BANDWIDTH = 0.118;
const SINGLE_NODE_BANDWIDTH = 0.08;
const MIN_EDGE_SUPPORT = 0.042;
const MAX_EDGE_SUPPORT = 0.072;
const MAX_TRUSTED_EDGE_ANGLE = 0.36;
const SUSPICIOUS_BRIDGE_ANGLE = 0.22;
const LOW_LAND_DENSITY = 0.34;
const HIGH_LAND_DENSITY = 0.62;
const OWNER_DOMINANCE_FLOOR = 0.045;
const OWNER_DOMINANCE_RATIO = 0.08;
const WATER_SEED_RADIUS = 0.052;
const MEMBER_GUARANTEE_MAX_RADIUS = 0.024;
const BOUNDARY_NOISE_BAND = 0.052;
const BOUNDARY_SEARCH_RADIUS = 0.14;
const SUPPORT_DISTANCE_CAP = 0.2;
const TARGET_VISIBLE_OCEAN_FRACTION = 0.52;
const APPROXIMATE_ROOT_ISLAND_AREA_FRACTION = 0.0008;
const MAXIMUM_ISLAND_OCEAN_COMPENSATION = 0.12;
const ORGANIC_COAST_BIAS_WEIGHT = 0.16;

interface DensityAnchor {
	readonly direction: Vec3;
	readonly owner: number;
	readonly fineSupport: number;
	readonly coarseSupport: number;
	readonly fineWeight: number;
	readonly coarseWeight: number;
}

interface MemberNode {
	readonly direction: Vec3;
	readonly owner: number;
	readonly nodeIndex: number;
	readonly bandwidth: number;
	readonly guaranteeRadius: number;
}

interface WaterSeed {
	readonly direction: Vec3;
}

interface RasterPoint {
	readonly direction: Vec3;
	readonly index: number;
}

interface BoundarySample {
	readonly direction: Vec3;
	readonly owner: number;
}

interface SpatialBuckets<T> {
	readonly cellSize: number;
	readonly cells: ReadonlyMap<string, readonly T[]>;
}

interface MutableBuckets<T> {
	readonly cellSize: number;
	readonly cells: Map<string, T[]>;
}

interface LandRaster {
	readonly grid: IntrinsicSphericalGrid;
	readonly ownerByCell: Int32Array;
	readonly connectedOcean: Uint8Array;
	readonly boundaryBand: Uint8Array;
	readonly bestDensity: Float32Array;
	readonly rasterPoints: SpatialBuckets<RasterPoint>;
	readonly boundaries: readonly BoundarySample[];
	readonly boundaryBuckets: SpatialBuckets<BoundarySample>;
}

export interface LandSupportModel {
	readonly raster: LandRaster;
	readonly anchors: SpatialBuckets<DensityAnchor>;
	readonly members: SpatialBuckets<MemberNode>;
	readonly maximumSupportRadius: number;
	readonly seed: number;
}

export interface ContinentSupportSample {
	readonly normalizedScore: number;
	/**
	 * Signed geodesic distance to the connected external ocean. Positive
	 * values are land, zero is the coast, and negative values are water.
	 */
	readonly margin: number;
}

export interface LandSupportDiagnostics {
	readonly rasterCellCount: number;
	readonly densityAnchorCount: number;
	readonly boundarySampleCount: number;
	readonly connectedOceanCellCount: number;
	readonly connectedOceanFraction: number;
	readonly landCellCount: number;
}

interface SeaComponent {
	readonly cells: number[];
	readonly boundaryOwners: Set<number>;
	readonly containsWaterSeed: boolean;
}

interface QuerySample {
	readonly owner: number;
	readonly margin: number;
	readonly boundaryOwner: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.min(maximum, Math.max(minimum, value));
}

function coordinate(value: number, cellSize: number): number {
	return Math.floor((value + 1) / cellSize);
}

function cellKey(x: number, y: number, z: number): string {
	return `${x}|${y}|${z}`;
}

function createBuckets<T>(cellSize: number): MutableBuckets<T> {
	return { cellSize, cells: new Map<string, T[]>() };
}

function addToBuckets<T extends { readonly direction: Vec3 }>(
	buckets: MutableBuckets<T>,
	value: T,
): void {
	const key = cellKey(
		coordinate(value.direction[0], buckets.cellSize),
		coordinate(value.direction[1], buckets.cellSize),
		coordinate(value.direction[2], buckets.cellSize),
	);
	const cell = buckets.cells.get(key);
	if (cell === undefined) {
		buckets.cells.set(key, [value]);
	} else {
		cell.push(value);
	}
}

function bucketValueCount<T>(buckets: SpatialBuckets<T>): number {
	let count = 0;
	for (const values of buckets.cells.values()) {
		count += values.length;
	}
	return count;
}

function forEachNearby<T>(
	buckets: SpatialBuckets<T>,
	point: Vec3,
	maximumAngle: number,
	visitor: (value: T) => void,
): void {
	const chordDistance =
		2 * Math.sin(Math.min(Math.PI, maximumAngle) / 2);
	const range = Math.max(
		1,
		Math.ceil(chordDistance / buckets.cellSize),
	);
	const x = coordinate(point[0], buckets.cellSize);
	const y = coordinate(point[1], buckets.cellSize);
	const z = coordinate(point[2], buckets.cellSize);
	for (let dx = -range; dx <= range; dx += 1) {
		for (let dy = -range; dy <= range; dy += 1) {
			for (let dz = -range; dz <= range; dz += 1) {
				for (
					const value of
					buckets.cells.get(
						cellKey(x + dx, y + dy, z + dz),
					) ?? []
				) {
					visitor(value);
				}
			}
		}
	}
}

export function eligibleIslandNodeIndices(
	geography: RenderGeography,
	nodeCount: number,
	nodeDegrees?: ArrayLike<number>,
): readonly number[] {
	const indices = new Set<number>();
	for (const nodeIndex of geography.islandNodeIndices) {
		const degree = nodeDegrees?.[nodeIndex];
		if (
			Number.isSafeInteger(nodeIndex) &&
			nodeIndex >= 0 &&
			nodeIndex < nodeCount &&
			(degree === undefined || degree > 0)
		) {
			indices.add(nodeIndex);
		}
	}
	return [...indices].sort((left, right) => left - right);
}

function semanticAssignments(
	geography: RenderGeography,
	nodeCount: number,
	nodeDegrees?: ArrayLike<number>,
): Int32Array {
	const assignments = new Int32Array(nodeCount);
	assignments.fill(-2);
	for (
		let owner = 0;
		owner < geography.continents.length;
		owner += 1
	) {
		for (const nodeIndex of geography.continents[owner]?.nodeIndices ?? []) {
			const degree = nodeDegrees?.[nodeIndex];
			if (
				Number.isSafeInteger(nodeIndex) &&
				nodeIndex >= 0 &&
				nodeIndex < nodeCount &&
				(degree === undefined || degree > 0) &&
				assignments[nodeIndex] === -2
			) {
				assignments[nodeIndex] = owner;
			}
		}
	}
	for (const nodeIndex of eligibleIslandNodeIndices(
		geography,
		nodeCount,
		nodeDegrees,
	)) {
		if (
			assignments[nodeIndex] === -2
		) {
			assignments[nodeIndex] = -1;
		}
	}
	return assignments;
}

function median(values: readonly number[]): number {
	if (values.length === 0) {
		return 0;
	}
	const sorted = [...values].sort((left, right) => left - right);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0
		? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
		: (sorted[middle] ?? 0);
}

function ownerMemberDirections(
	geography: RenderGeography,
	positions: Float32Array,
	assignments: Int32Array,
): readonly (readonly {
	readonly nodeIndex: number;
	readonly direction: Vec3;
}[])[] {
	return geography.continents.map((continent, owner) =>
		continent.nodeIndices
			.filter(
				(nodeIndex) =>
					Number.isSafeInteger(nodeIndex) &&
					nodeIndex >= 0 &&
					nodeIndex * 3 + 2 < positions.length &&
					(assignments[nodeIndex] ?? -2) === owner,
			)
			.map((nodeIndex) => ({
				nodeIndex,
				direction: normalizeVec3(readVec3(positions, nodeIndex)),
			})),
	);
}

function adaptiveBandwidth(
	direction: Vec3,
	ownerMembers: readonly { readonly direction: Vec3 }[],
): number {
	if (ownerMembers.length <= 1) {
		return SINGLE_NODE_BANDWIDTH;
	}
	const distances = ownerMembers
		.map((member) => geodesicDistance(direction, member.direction))
		.filter((distance) => distance > 1e-7)
		.sort((left, right) => left - right);
	if (distances.length === 0) {
		return SINGLE_NODE_BANDWIDTH;
	}
	if (ownerMembers.length === 2) {
		return clamp(
			(distances[0] ?? 0.35) * 0.22,
			0.068,
			0.085,
		);
	}
	const retained = distances.slice(0, Math.min(4, distances.length));
	return clamp(
		median(retained) * 0.62,
		MIN_NODE_BANDWIDTH,
		MAX_NODE_BANDWIDTH,
	);
}

function createMemberAnchors(
	geography: RenderGeography,
	positions: Float32Array,
	assignments: Int32Array,
	seed: number,
): {
	readonly members: MutableBuckets<MemberNode>;
	readonly anchors: MutableBuckets<DensityAnchor>;
	readonly bandwidthByNode: Float64Array;
} {
	const ownerMembers = ownerMemberDirections(
		geography,
		positions,
		assignments,
	);
	const members = createBuckets<MemberNode>(DENSITY_BUCKET_CELL_SIZE);
	const anchors = createBuckets<DensityAnchor>(DENSITY_BUCKET_CELL_SIZE);
	const bandwidthByNode = new Float64Array(positions.length / 3);
	for (let owner = 0; owner < ownerMembers.length; owner += 1) {
		const entries = ownerMembers[owner] ?? [];
		for (const entry of entries) {
			const baseBandwidth = adaptiveBandwidth(entry.direction, entries);
			const variation =
				0.99 +
				hashToSignedUnitFloat(seed, owner, entry.nodeIndex, 0xb4ad) *
					0.11;
			const bandwidth = clamp(
				baseBandwidth * variation,
				MIN_NODE_BANDWIDTH,
				MAX_NODE_BANDWIDTH,
			);
			bandwidthByNode[entry.nodeIndex] = bandwidth;
			const guaranteeRadius = Math.min(
				MEMBER_GUARANTEE_MAX_RADIUS,
				bandwidth * 0.3,
			);
			addToBuckets(members, {
				direction: entry.direction,
				owner,
				nodeIndex: entry.nodeIndex,
				bandwidth,
				guaranteeRadius,
			});
			addToBuckets(anchors, {
				direction: entry.direction,
				owner,
				fineSupport: bandwidth * 2.2,
				coarseSupport: bandwidth * 4.15,
				fineWeight:
					1 +
					hashToSignedUnitFloat(
						seed,
						owner,
						entry.nodeIndex,
						0xf17e,
					) *
						0.08,
				coarseWeight: entries.length >= 5 ? 0.04 : 0,
			});
		}
	}
	return { members, anchors, bandwidthByNode };
}

function sameOwnerNeighborSets(
	nodeCount: number,
	assignments: Int32Array,
	edges: readonly RenderEdge[],
): readonly ReadonlySet<number>[] {
	const neighbors = Array.from(
		{ length: nodeCount },
		() => new Set<number>(),
	);
	for (const edge of edges) {
		const owner = assignments[edge.source] ?? -2;
		if (
			owner < 0 ||
			edge.source < 0 ||
			edge.target < 0 ||
			edge.source >= nodeCount ||
			edge.target >= nodeCount ||
			(assignments[edge.target] ?? -2) !== owner
		) {
			continue;
		}
		neighbors[edge.source]?.add(edge.target);
		neighbors[edge.target]?.add(edge.source);
	}
	return neighbors;
}

function commonNeighborCount(
	left: ReadonlySet<number>,
	right: ReadonlySet<number>,
): number {
	const smaller = left.size <= right.size ? left : right;
	const larger = left.size <= right.size ? right : left;
	let count = 0;
	for (const value of smaller) {
		if (larger.has(value)) {
			count += 1;
		}
	}
	return count;
}

function addTrustedEdgeAnchors(
	anchors: MutableBuckets<DensityAnchor>,
	positions: Float32Array,
	edges: readonly RenderEdge[],
	assignments: Int32Array,
	bandwidthByNode: Float64Array,
	seed: number,
): void {
	const nodeCount = positions.length / 3;
	const neighbors = sameOwnerNeighborSets(nodeCount, assignments, edges);
	const deduplicated = new Set<string>();
	for (const edge of edges) {
		const owner = assignments[edge.source] ?? -2;
		if (
			owner < 0 ||
			edge.source < 0 ||
			edge.target < 0 ||
			edge.source >= nodeCount ||
			edge.target >= nodeCount ||
			(assignments[edge.target] ?? -2) !== owner
		) {
			continue;
		}
		const start = normalizeVec3(readVec3(positions, edge.source));
		const end = normalizeVec3(readVec3(positions, edge.target));
		const angle = geodesicDistance(start, end);
		if (angle <= 1e-7 || angle > MAX_TRUSTED_EDGE_ANGLE) {
			continue;
		}
		const sourceNeighbors = neighbors[edge.source] ?? new Set<number>();
		const targetNeighbors = neighbors[edge.target] ?? new Set<number>();
		if (
			angle > SUSPICIOUS_BRIDGE_ANGLE &&
			sourceNeighbors.size > 1 &&
			targetNeighbors.size > 1 &&
			commonNeighborCount(sourceNeighbors, targetNeighbors) === 0
		) {
			continue;
		}
		const sourceBandwidth =
			bandwidthByNode[edge.source] || MIN_NODE_BANDWIDTH;
		const targetBandwidth =
			bandwidthByNode[edge.target] || MIN_NODE_BANDWIDTH;
		const support = clamp(
			Math.min(sourceBandwidth, targetBandwidth) * 0.82,
			MIN_EDGE_SUPPORT,
			MAX_EDGE_SUPPORT,
		);
		const segmentCount = Math.max(
			2,
			Math.ceil(angle / Math.max(0.018, support * 0.45)),
		);
		const samples = sampleGeodesicArc(
			start,
			end,
			segmentCount,
			1,
			String(edge.source),
			String(edge.target),
		);
		for (let sampleIndex = 1; sampleIndex + 1 < samples.length; sampleIndex += 1) {
			const direction = samples[sampleIndex];
			if (direction === undefined) {
				continue;
			}
			const key = `${owner}|${Math.round(direction[0] / 0.035)}|${Math.round(direction[1] / 0.035)}|${Math.round(direction[2] / 0.035)}`;
			if (deduplicated.has(key)) {
				continue;
			}
			deduplicated.add(key);
			addToBuckets(anchors, {
				direction,
				owner,
				fineSupport: support,
				coarseSupport: support,
				fineWeight: clamp(
					0.82 + Math.log1p(Math.max(0, edge.weight)) * 0.08,
					0.82,
					1.05,
				),
				coarseWeight: 0,
			});
		}
	}
	void seed;
}

function createWaterSeeds(
	positions: Float32Array,
	edges: readonly RenderEdge[],
	assignments: Int32Array,
): MutableBuckets<WaterSeed> {
	const nodeCount = positions.length / 3;
	const freeNeighborCounts = new Uint16Array(nodeCount);
	const freeWeights = new Float64Array(nodeCount);
	const continentWeights = new Float64Array(nodeCount);
	for (const edge of edges) {
		if (
			edge.source < 0 ||
			edge.target < 0 ||
			edge.source >= nodeCount ||
			edge.target >= nodeCount
		) {
			continue;
		}
		const sourceOwner = assignments[edge.source] ?? -2;
		const targetOwner = assignments[edge.target] ?? -2;
		const weight = Math.min(
			4,
			0.75 + Math.log1p(Math.max(0, edge.weight)),
		);
		if (sourceOwner === -1 && targetOwner === -1) {
			const angle = geodesicDistance(
				normalizeVec3(readVec3(positions, edge.source)),
				normalizeVec3(readVec3(positions, edge.target)),
			);
			if (angle > MAX_TRUSTED_EDGE_ANGLE) {
				continue;
			}
			freeNeighborCounts[edge.source] =
				(freeNeighborCounts[edge.source] ?? 0) + 1;
			freeNeighborCounts[edge.target] =
				(freeNeighborCounts[edge.target] ?? 0) + 1;
			freeWeights[edge.source] =
				(freeWeights[edge.source] ?? 0) + weight;
			freeWeights[edge.target] =
				(freeWeights[edge.target] ?? 0) + weight;
		} else if (sourceOwner === -1 && targetOwner >= 0) {
			continentWeights[edge.source] =
				(continentWeights[edge.source] ?? 0) + weight;
		} else if (targetOwner === -1 && sourceOwner >= 0) {
			continentWeights[edge.target] =
				(continentWeights[edge.target] ?? 0) + weight;
		}
	}
	const seeds = createBuckets<WaterSeed>(DENSITY_BUCKET_CELL_SIZE);
	for (let nodeIndex = 0; nodeIndex < nodeCount; nodeIndex += 1) {
		if (
			(assignments[nodeIndex] ?? -2) === -1 &&
			(freeNeighborCounts[nodeIndex] ?? 0) >= 2 &&
			(freeWeights[nodeIndex] ?? 0) >=
				(continentWeights[nodeIndex] ?? 0)
		) {
			addToBuckets(seeds, {
				direction: normalizeVec3(readVec3(positions, nodeIndex)),
			});
		}
	}
	return seeds;
}

function compactKernelFromChordSquared(
	chordSquared: number,
	supportChordSquared: number,
): number {
	if (
		supportChordSquared <= 0 ||
		chordSquared >= supportChordSquared
	) {
		return 0;
	}
	const ratio = chordSquared / supportChordSquared;
	return (1 - ratio) ** 3;
}

function supportChordSquared(supportAngle: number): number {
	const chord = 2 * Math.sin(Math.min(Math.PI, supportAngle) / 2);
	return chord * chord;
}

function maximumAnchorSupport(
	anchors: SpatialBuckets<DensityAnchor>,
): number {
	let maximum = MIN_NODE_BANDWIDTH * 2.2;
	for (const values of anchors.cells.values()) {
		for (const anchor of values) {
			maximum = Math.max(
				maximum,
				anchor.fineSupport,
				anchor.coarseSupport,
			);
		}
	}
	return maximum;
}

function densityFields(
	grid: IntrinsicSphericalGrid,
	ownerCount: number,
	anchors: SpatialBuckets<DensityAnchor>,
	maximumSupport: number,
): {
	readonly byOwner: readonly Float32Array[];
	readonly best: Float32Array;
	readonly second: Float32Array;
	readonly bestOwner: Int32Array;
	readonly rasterPoints: SpatialBuckets<RasterPoint>;
} {
	const byOwner = Array.from(
		{ length: ownerCount },
		() => new Float32Array(grid.vertices.length),
	);
	const best = new Float32Array(grid.vertices.length);
	const second = new Float32Array(grid.vertices.length);
	const bestOwner = new Int32Array(grid.vertices.length);
	bestOwner.fill(-1);
	const rasterPoints = createRasterPointBuckets(grid);
	for (const values of anchors.cells.values()) {
		for (const anchor of values) {
			const field = byOwner[anchor.owner];
			if (field === undefined) {
				continue;
			}
			const fineChordSquared = supportChordSquared(
				anchor.fineSupport,
			);
			const coarseChordSquared = supportChordSquared(
				anchor.coarseSupport,
			);
			forEachNearby(
				rasterPoints,
				anchor.direction,
				Math.min(maximumSupport, anchor.coarseSupport),
				(candidate) => {
					const chordSquared = Math.max(
						0,
						2 *
							(1 -
								clamp(
									dotVec3(
										anchor.direction,
										candidate.direction,
									),
									-1,
									1,
								)),
					);
					const contribution =
						compactKernelFromChordSquared(
							chordSquared,
							fineChordSquared,
						) *
							anchor.fineWeight +
						compactKernelFromChordSquared(
							chordSquared,
							coarseChordSquared,
						) *
							anchor.coarseWeight;
					if (contribution > 0) {
						field[candidate.index] =
							(field[candidate.index] ?? 0) + contribution;
					}
				},
			);
		}
	}
	for (let cell = 0; cell < grid.vertices.length; cell += 1) {
		let winner = -1;
		let winnerDensity = 0;
		let runnerUp = 0;
		for (let owner = 0; owner < byOwner.length; owner += 1) {
			const value = byOwner[owner]?.[cell] ?? 0;
			if (value > winnerDensity) {
				runnerUp = winnerDensity;
				winnerDensity = value;
				winner = owner;
			} else if (value > runnerUp) {
				runnerUp = value;
			}
		}
		best[cell] = winnerDensity;
		second[cell] = runnerUp;
		bestOwner[cell] = winner;
	}
	return {
		byOwner,
		best,
		second,
		bestOwner,
		rasterPoints,
	};
}

function hasNearbyWaterSeed(
	point: Vec3,
	seeds: SpatialBuckets<WaterSeed>,
): boolean {
	let found = false;
	forEachNearby(seeds, point, WATER_SEED_RADIUS, (seed) => {
		if (
			!found &&
			geodesicDistance(point, seed.direction) <= WATER_SEED_RADIUS
		) {
			found = true;
		}
	});
	return found;
}

function forcedOwnersByCell(
	grid: IntrinsicSphericalGrid,
	positions: Float32Array,
	assignments: Int32Array,
	densities: readonly Float32Array[],
): Int32Array {
	const nodeCells = mapPositionsToGrid(grid, positions);
	const forced = new Int32Array(grid.vertices.length);
	forced.fill(-1);
	for (let nodeIndex = 0; nodeIndex < nodeCells.length; nodeIndex += 1) {
		const owner = assignments[nodeIndex] ?? -2;
		const cell = nodeCells[nodeIndex] ?? -1;
		if (owner < 0 || cell < 0) {
			continue;
		}
		const previous = forced[cell] ?? -1;
		if (
			previous < 0 ||
			(densities[owner]?.[cell] ?? 0) >
				(densities[previous]?.[cell] ?? 0)
		) {
			forced[cell] = owner;
		}
	}
	return forced;
}

function growLandOwners(
	grid: IntrinsicSphericalGrid,
	fields: ReturnType<typeof densityFields>,
	forced: Int32Array,
	waterSeeds: SpatialBuckets<WaterSeed>,
): {
	readonly owners: Int32Array;
	readonly waterLocks: Uint8Array;
} {
	const candidates = new Int32Array(grid.vertices.length);
	const owners = new Int32Array(grid.vertices.length);
	const waterLocks = new Uint8Array(grid.vertices.length);
	candidates.fill(-1);
	owners.fill(-1);
	const queue: number[] = [];
	for (let cell = 0; cell < grid.vertices.length; cell += 1) {
		const point = grid.vertices[cell];
		const forcedOwner = forced[cell] ?? -1;
		if (point === undefined) {
			continue;
		}
		const locked =
			forcedOwner < 0 && hasNearbyWaterSeed(point, waterSeeds);
		if (locked) {
			waterLocks[cell] = 1;
			continue;
		}
		const bestOwner = fields.bestOwner[cell] ?? -1;
		const best = fields.best[cell] ?? 0;
		const second = fields.second[cell] ?? 0;
		const dominance = Math.max(
			OWNER_DOMINANCE_FLOOR,
			best * OWNER_DOMINANCE_RATIO,
		);
		const candidate =
			forcedOwner >= 0
				? forcedOwner
				: bestOwner >= 0 &&
					  best >= LOW_LAND_DENSITY &&
					  best - second >= dominance
					? bestOwner
					: -1;
		candidates[cell] = candidate;
		if (
			candidate >= 0 &&
			(forcedOwner >= 0 || best >= HIGH_LAND_DENSITY)
		) {
			owners[cell] = candidate;
			queue.push(cell);
		}
	}
	for (let cursor = 0; cursor < queue.length; cursor += 1) {
		const cell = queue[cursor];
		if (cell === undefined) {
			continue;
		}
		const owner = owners[cell] ?? -1;
		for (const neighbor of grid.neighbors[cell] ?? []) {
			if (
				(owners[neighbor] ?? -1) < 0 &&
				(candidates[neighbor] ?? -1) === owner
			) {
				owners[neighbor] = owner;
				queue.push(neighbor);
			}
		}
	}
	const separated = owners.slice();
	for (let cell = 0; cell < owners.length; cell += 1) {
		const owner = owners[cell] ?? -1;
		if (owner < 0 || (forced[cell] ?? -1) >= 0) {
			continue;
		}
		if (
			(grid.neighbors[cell] ?? []).some((neighbor) => {
				const neighborOwner = owners[neighbor] ?? -1;
				return neighborOwner >= 0 && neighborOwner !== owner;
			})
		) {
			separated[cell] = -1;
		}
	}
	return { owners: separated, waterLocks };
}

function seaComponents(
	grid: IntrinsicSphericalGrid,
	owners: Int32Array,
	waterLocks: Uint8Array,
): SeaComponent[] {
	const seen = new Uint8Array(grid.vertices.length);
	const components: SeaComponent[] = [];
	for (let start = 0; start < owners.length; start += 1) {
		if (seen[start] === 1 || (owners[start] ?? -1) >= 0) {
			continue;
		}
		const cells: number[] = [];
		const boundaryOwners = new Set<number>();
		let containsWaterSeed = false;
		const queue = [start];
		seen[start] = 1;
		for (let cursor = 0; cursor < queue.length; cursor += 1) {
			const cell = queue[cursor];
			if (cell === undefined) {
				continue;
			}
			cells.push(cell);
			containsWaterSeed ||= waterLocks[cell] === 1;
			for (const neighbor of grid.neighbors[cell] ?? []) {
				const neighborOwner = owners[neighbor] ?? -1;
				if (neighborOwner < 0) {
					if (seen[neighbor] === 0) {
						seen[neighbor] = 1;
						queue.push(neighbor);
					}
				} else {
					boundaryOwners.add(neighborOwner);
				}
			}
		}
		components.push({ cells, boundaryOwners, containsWaterSeed });
	}
	return components;
}

function deepestSeaCell(
	components: readonly SeaComponent[],
	bestDensity: Float32Array,
): number {
	let bestCell = -1;
	let lowestDensity = Number.POSITIVE_INFINITY;
	for (const component of components) {
		for (const cell of component.cells) {
			const density = bestDensity[cell] ?? 0;
			if (
				density < lowestDensity - 1e-12 ||
				(Math.abs(density - lowestDensity) <= 1e-12 &&
					cell < bestCell)
			) {
				lowestDensity = density;
				bestCell = cell;
			}
		}
	}
	return bestCell;
}

function fillEnclosedHoles(
	grid: IntrinsicSphericalGrid,
	owners: Int32Array,
	waterLocks: Uint8Array,
	bestDensity: Float32Array,
): Uint8Array {
	let components = seaComponents(grid, owners, waterLocks);
	if (components.length === 0) {
		const deepest = [...bestDensity]
			.map((density, cell) => ({ density, cell }))
			.sort(
				(left, right) =>
					left.density - right.density || left.cell - right.cell,
			)[0]?.cell;
		if (deepest !== undefined) {
			owners[deepest] = -1;
		}
		components = seaComponents(grid, owners, waterLocks);
	}
	const deepest = deepestSeaCell(components, bestDensity);
	const global = components.find((component) =>
		component.cells.includes(deepest),
	);
	for (const component of components) {
		if (
			component === global ||
			component.containsWaterSeed ||
			component.boundaryOwners.size !== 1
		) {
			continue;
		}
		const owner = component.boundaryOwners.values().next().value;
		if (owner === undefined) {
			continue;
		}
		for (const cell of component.cells) {
			owners[cell] = owner;
		}
	}
	components = seaComponents(grid, owners, waterLocks);
	const connectedOcean = new Uint8Array(grid.vertices.length);
	const finalDeepest = deepestSeaCell(components, bestDensity);
	const finalGlobal =
		components.find((component) =>
			component.cells.includes(finalDeepest),
		) ??
		[...components].sort(
			(left, right) =>
				right.cells.length - left.cells.length ||
				(left.cells[0] ?? 0) - (right.cells[0] ?? 0),
		)[0];
	for (const cell of finalGlobal?.cells ?? []) {
		connectedOcean[cell] = 1;
	}
	return connectedOcean;
}

function connectedSeaFromExisting(
	grid: IntrinsicSphericalGrid,
	owners: Int32Array,
	existing: Uint8Array,
): Uint8Array {
	const connected = new Uint8Array(grid.vertices.length);
	const queue: number[] = [];
	for (let cell = 0; cell < existing.length; cell += 1) {
		if (existing[cell] === 1 && (owners[cell] ?? -1) < 0) {
			connected[cell] = 1;
			queue.push(cell);
		}
	}
	for (let cursor = 0; cursor < queue.length; cursor += 1) {
		const cell = queue[cursor];
		if (cell === undefined) {
			continue;
		}
		for (const neighbor of grid.neighbors[cell] ?? []) {
			if (
				connected[neighbor] === 0 &&
				(owners[neighbor] ?? -1) < 0
			) {
				connected[neighbor] = 1;
				queue.push(neighbor);
			}
		}
	}
	return connected;
}

function connectedOceanTargetFraction(islandCount: number): number {
	return clamp(
		TARGET_VISIBLE_OCEAN_FRACTION +
			Math.min(
				MAXIMUM_ISLAND_OCEAN_COMPENSATION,
				Math.max(0, islandCount) *
					APPROXIMATE_ROOT_ISLAND_AREA_FRACTION,
			),
		TARGET_VISIBLE_OCEAN_FRACTION,
		TARGET_VISIBLE_OCEAN_FRACTION +
			MAXIMUM_ISLAND_OCEAN_COMPENSATION,
	);
}

function organicCoastBias(point: Vec3, seed: number): number {
	const firstAxis = normalizeVec3([
		hashToSignedUnitFloat(seed, 0xc01, 0),
		hashToSignedUnitFloat(seed, 0xc01, 1),
		hashToSignedUnitFloat(seed, 0xc01, 2),
	]);
	const secondAxis = normalizeVec3([
		hashToSignedUnitFloat(seed, 0xc02, 0),
		hashToSignedUnitFloat(seed, 0xc02, 1),
		hashToSignedUnitFloat(seed, 0xc02, 2),
	]);
	const detailAxis = normalizeVec3([
		hashToSignedUnitFloat(seed, 0xc03, 0),
		hashToSignedUnitFloat(seed, 0xc03, 1),
		hashToSignedUnitFloat(seed, 0xc03, 2),
	]);
	const firstPhase =
		hashToSignedUnitFloat(seed, 0xc04) * Math.PI;
	const secondPhase =
		hashToSignedUnitFloat(seed, 0xc05) * Math.PI;
	const detailPhase =
		hashToSignedUnitFloat(seed, 0xc06) * Math.PI;
	return (
		Math.sin(dotVec3(point, firstAxis) * 3.4 + firstPhase) * 0.54 +
		Math.sin(dotVec3(point, secondAxis) * 7.1 + secondPhase) * 0.3 +
		Math.sin(dotVec3(point, detailAxis) * 15.7 + detailPhase) * 0.16
	);
}

/**
 * Expands only the already connected external ocean, one coastal raster ring
 * at a time. Member cells remain protected. A smooth multi-scale spherical
 * bias makes some coastal sectors erode more deeply than others, restoring
 * broad bays and peninsulas instead of reproducing a circular layout cap.
 */
function expandConnectedOcean(
	grid: IntrinsicSphericalGrid,
	owners: Int32Array,
	initialConnectedOcean: Uint8Array,
	forced: Int32Array,
	bestDensity: Float32Array,
	islandCount: number,
	seed: number,
): Uint8Array {
	let connectedOcean = connectedSeaFromExisting(
		grid,
		owners,
		initialConnectedOcean,
	);
	const coastBias = Float32Array.from(grid.vertices, (point) =>
		organicCoastBias(point, seed),
	);
	const targetCount = Math.ceil(
		grid.vertices.length * connectedOceanTargetFraction(islandCount),
	);
	let connectedCount = connectedOcean.reduce(
		(total, value) => total + value,
		0,
	);
	while (connectedCount < targetCount) {
		const frontier = new Set<number>();
		for (let cell = 0; cell < connectedOcean.length; cell += 1) {
			if (connectedOcean[cell] !== 1) {
				continue;
			}
			for (const neighbor of grid.neighbors[cell] ?? []) {
				if (
					(owners[neighbor] ?? -1) >= 0 &&
					(forced[neighbor] ?? -1) < 0
				) {
					frontier.add(neighbor);
				}
			}
		}
		if (frontier.size === 0) {
			break;
		}
		const ordered = [...frontier].sort(
			(left, right) =>
				Math.log1p(bestDensity[left] ?? 0) +
					(coastBias[left] ?? 0) *
						ORGANIC_COAST_BIAS_WEIGHT -
					(Math.log1p(bestDensity[right] ?? 0) +
						(coastBias[right] ?? 0) *
							ORGANIC_COAST_BIAS_WEIGHT) ||
				left - right,
		);
		const removeCount = Math.min(
			ordered.length,
			targetCount - connectedCount,
		);
		for (let index = 0; index < removeCount; index += 1) {
			const cell = ordered[index];
			if (cell !== undefined) {
				owners[cell] = -1;
			}
		}
		connectedOcean = connectedSeaFromExisting(
			grid,
			owners,
			connectedOcean,
		);
		const nextCount = connectedOcean.reduce(
			(total, value) => total + value,
			0,
		);
		if (nextCount <= connectedCount) {
			break;
		}
		connectedCount = nextCount;
	}
	return connectedOcean;
}

function createRasterPointBuckets(
	grid: IntrinsicSphericalGrid,
): MutableBuckets<RasterPoint> {
	const buckets = createBuckets<RasterPoint>(RASTER_BUCKET_CELL_SIZE);
	for (let index = 0; index < grid.vertices.length; index += 1) {
		const direction = grid.vertices[index];
		if (direction !== undefined) {
			addToBuckets(buckets, { direction, index });
		}
	}
	return buckets;
}

function boundarySamples(
	grid: IntrinsicSphericalGrid,
	owners: Int32Array,
	connectedOcean: Uint8Array,
): readonly BoundarySample[] {
	const samples = new Map<string, BoundarySample>();
	for (let cell = 0; cell < owners.length; cell += 1) {
		const owner = owners[cell] ?? -1;
		const direction = grid.vertices[cell];
		if (owner < 0 || direction === undefined) {
			continue;
		}
		for (const neighbor of grid.neighbors[cell] ?? []) {
			const other = grid.vertices[neighbor];
			if (connectedOcean[neighbor] !== 1 || other === undefined) {
				continue;
			}
			const midpoint = normalizeVec3([
				direction[0] + other[0],
				direction[1] + other[1],
				direction[2] + other[2],
			]);
			const key = `${owner}|${Math.round(midpoint[0] * 2000)}|${Math.round(midpoint[1] * 2000)}|${Math.round(midpoint[2] * 2000)}`;
			samples.set(key, { direction: midpoint, owner });
		}
	}
	return [...samples.values()].sort(
		(left, right) =>
			left.owner - right.owner ||
			left.direction[0] - right.direction[0] ||
			left.direction[1] - right.direction[1] ||
			left.direction[2] - right.direction[2],
	);
}

function connectedOceanBoundaryBand(
	grid: IntrinsicSphericalGrid,
	owners: Int32Array,
	connectedOcean: Uint8Array,
): Uint8Array {
	let band = new Uint8Array(grid.vertices.length);
	for (let cell = 0; cell < owners.length; cell += 1) {
		const owner = owners[cell] ?? -1;
		for (const neighbor of grid.neighbors[cell] ?? []) {
			const neighborOwner = owners[neighbor] ?? -1;
			if (
				(owner >= 0 && connectedOcean[neighbor] === 1) ||
				(connectedOcean[cell] === 1 && neighborOwner >= 0)
			) {
				band[cell] = 1;
				band[neighbor] = 1;
			}
		}
	}
	for (let expansion = 0; expansion < 2; expansion += 1) {
		const expanded = band.slice();
		for (let cell = 0; cell < band.length; cell += 1) {
			if (band[cell] !== 1) {
				continue;
			}
			for (const neighbor of grid.neighbors[cell] ?? []) {
				expanded[neighbor] = 1;
			}
		}
		band = expanded;
	}
	return band;
}

function buildLandRaster(
	geography: RenderGeography,
	positions: Float32Array,
	assignments: Int32Array,
	anchors: SpatialBuckets<DensityAnchor>,
	waterSeeds: SpatialBuckets<WaterSeed>,
	maximumSupport: number,
	seed: number,
): LandRaster {
	const memberCount = assignments.reduce(
		(total, owner) => total + (owner >= 0 ? 1 : 0),
		0,
	);
	const effectiveSamples = Math.max(64, memberCount * 4);
	const spacing = Math.sqrt((4 * Math.PI) / effectiveSamples);
	const subdivision = Math.max(
		4,
		gridSubdivisionForSpacing(spacing * 0.65),
	);
	const grid = createIntrinsicSphericalGrid(subdivision);
	const fields = densityFields(
		grid,
		geography.continents.length,
		anchors,
		maximumSupport,
	);
	const forced = forcedOwnersByCell(
		grid,
		positions,
		assignments,
		fields.byOwner,
	);
	const growth = growLandOwners(grid, fields, forced, waterSeeds);
	const initialConnectedOcean = fillEnclosedHoles(
		grid,
		growth.owners,
		growth.waterLocks,
		fields.best,
	);
	const connectedOcean = expandConnectedOcean(
		grid,
		growth.owners,
		initialConnectedOcean,
		forced,
		fields.best,
		geography.islandNodeIndices.length,
		seed,
	);
	const boundaries = boundarySamples(
		grid,
		growth.owners,
		connectedOcean,
	);
	const boundaryBand = connectedOceanBoundaryBand(
		grid,
		growth.owners,
		connectedOcean,
	);
	const boundaryBuckets = createBuckets<BoundarySample>(
		BOUNDARY_BUCKET_CELL_SIZE,
	);
	for (const boundary of boundaries) {
		addToBuckets(boundaryBuckets, boundary);
	}
	return {
		grid,
		ownerByCell: growth.owners,
		connectedOcean,
		boundaryBand,
		bestDensity: fields.best,
		rasterPoints: fields.rasterPoints,
		boundaries,
		boundaryBuckets,
	};
}

export function createLandSupportModel(
	geography: RenderGeography,
	positions: Float32Array,
	edges: readonly RenderEdge[],
	seed: number,
	nodeDegrees?: ArrayLike<number>,
): LandSupportModel {
	if (positions.length % 3 !== 0) {
		throw new RangeError(
			'Land support positions must contain complete vectors.',
		);
	}
	if (
		nodeDegrees !== undefined &&
		nodeDegrees.length !== positions.length / 3
	) {
		throw new RangeError('Land support degrees must align with positions.');
	}
	const modelSeed = hashNumbers(seed, 0x1a4d);
	const assignments = semanticAssignments(
		geography,
		positions.length / 3,
		nodeDegrees,
	);
	const created = createMemberAnchors(
		geography,
		positions,
		assignments,
		modelSeed,
	);
	addTrustedEdgeAnchors(
		created.anchors,
		positions,
		edges,
		assignments,
		created.bandwidthByNode,
		modelSeed,
	);
	const maximumSupportRadius = maximumAnchorSupport(created.anchors);
	const waterSeeds = createWaterSeeds(positions, edges, assignments);
	return {
		raster: buildLandRaster(
			geography,
			positions,
			assignments,
			created.anchors,
			waterSeeds,
			maximumSupportRadius,
			modelSeed,
		),
		anchors: created.anchors,
		members: created.members,
		maximumSupportRadius,
		seed: modelSeed,
	};
}

function nearestRasterCell(point: Vec3, raster: LandRaster): number {
	let bestIndex = -1;
	let bestDot = Number.NEGATIVE_INFINITY;
	forEachNearby(raster.rasterPoints, point, 0.075, (candidate) => {
		const similarity = dotVec3(point, candidate.direction);
		if (
			similarity > bestDot + 1e-12 ||
			(Math.abs(similarity - bestDot) <= 1e-12 &&
				candidate.index < bestIndex)
		) {
			bestDot = similarity;
			bestIndex = candidate.index;
		}
	});
	if (bestIndex >= 0) {
		return bestIndex;
	}
	for (let index = 0; index < raster.grid.vertices.length; index += 1) {
		const candidate = raster.grid.vertices[index];
		if (candidate === undefined) {
			continue;
		}
		const similarity = dotVec3(point, candidate);
		if (similarity > bestDot) {
			bestDot = similarity;
			bestIndex = index;
		}
	}
	return Math.max(0, bestIndex);
}

function nearestMember(
	point: Vec3,
	model: LandSupportModel,
	owner?: number,
): { readonly member: MemberNode; readonly distance: number } | undefined {
	let nearest: MemberNode | undefined;
	let nearestDistance = Number.POSITIVE_INFINITY;
	forEachNearby(
		model.members,
		point,
		MEMBER_GUARANTEE_MAX_RADIUS,
		(member) => {
			if (owner !== undefined && member.owner !== owner) {
				return;
			}
			const distance = geodesicDistance(point, member.direction);
			if (
				distance <= member.guaranteeRadius &&
				(distance < nearestDistance - 1e-12 ||
					(Math.abs(distance - nearestDistance) <= 1e-12 &&
						member.nodeIndex < (nearest?.nodeIndex ?? Infinity)))
			) {
				nearest = member;
				nearestDistance = distance;
			}
		},
	);
	return nearest === undefined
		? undefined
		: { member: nearest, distance: nearestDistance };
}

function nearestBoundary(
	point: Vec3,
	raster: LandRaster,
	owner?: number,
): { readonly boundary: BoundarySample; readonly distance: number } | undefined {
	let nearest: BoundarySample | undefined;
	let nearestDistance = Number.POSITIVE_INFINITY;
	forEachNearby(
		raster.boundaryBuckets,
		point,
		BOUNDARY_SEARCH_RADIUS,
		(boundary) => {
			if (owner !== undefined && boundary.owner !== owner) {
				return;
			}
			const distance = geodesicDistance(point, boundary.direction);
			if (distance < nearestDistance) {
				nearest = boundary;
				nearestDistance = distance;
			}
		},
	);
	return nearest === undefined
		? undefined
		: { boundary: nearest, distance: nearestDistance };
}

function boundaryDisplacement(
	point: Vec3,
	owner: number,
	seed: number,
): number {
	const phase = hashToSignedUnitFloat(seed, owner, 0xc0457) * Math.PI;
	return (
		Math.sin(
			point[0] * 8.7 +
				point[1] * 11.3 -
				point[2] * 7.9 +
				phase,
		) *
			0.011 +
		Math.sin(
			point[0] * 23.9 -
				point[1] * 19.7 +
				point[2] * 27.1 -
				phase * 0.73,
		) *
			0.006 +
		Math.sin(
			point[0] * 61.1 +
				point[1] * 53.3 -
				point[2] * 67.7 +
				phase * 1.31,
		) *
			0.003
	);
}

function displacedMargin(
	baseMargin: number,
	point: Vec3,
	owner: number,
	seed: number,
): number {
	const distance = Math.abs(baseMargin);
	if (distance >= BOUNDARY_NOISE_BAND) {
		return baseMargin;
	}
	const fade = 1 - distance / BOUNDARY_NOISE_BAND;
	return baseMargin + boundaryDisplacement(point, owner, seed) * fade;
}

function queryLand(pointValue: Vec3, model: LandSupportModel): QuerySample {
	const point = normalizeVec3(pointValue);
	const guaranteed = nearestMember(point, model);
	if (guaranteed !== undefined) {
		const margin =
			guaranteed.member.guaranteeRadius -
			guaranteed.distance +
			MIN_NODE_BANDWIDTH;
		return {
			owner: guaranteed.member.owner,
			margin,
			boundaryOwner: guaranteed.member.owner,
		};
	}
	const cell = nearestRasterCell(point, model.raster);
	const cellOwner = model.raster.ownerByCell[cell] ?? -1;
	if (cellOwner >= 0) {
		if (model.raster.boundaryBand[cell] !== 1) {
			return {
				owner: cellOwner,
				margin: SUPPORT_DISTANCE_CAP,
				boundaryOwner: cellOwner,
			};
		}
		const boundary = nearestBoundary(point, model.raster, cellOwner);
		const baseMargin = boundary?.distance ?? SUPPORT_DISTANCE_CAP;
		const margin = displacedMargin(
			baseMargin,
			point,
			cellOwner,
			model.seed,
		);
		return {
			owner: margin > 0 ? cellOwner : -1,
			margin,
			boundaryOwner: cellOwner,
		};
	}
	if (model.raster.connectedOcean[cell] !== 1) {
		return {
			owner: -1,
			margin: -SUPPORT_DISTANCE_CAP,
			boundaryOwner: -1,
		};
	}
	if (model.raster.boundaryBand[cell] !== 1) {
		return {
			owner: -1,
			margin: -SUPPORT_DISTANCE_CAP,
			boundaryOwner: -1,
		};
	}
	const boundary = nearestBoundary(point, model.raster);
	if (boundary === undefined) {
		return {
			owner: -1,
			margin: -SUPPORT_DISTANCE_CAP,
			boundaryOwner: -1,
		};
	}
	const margin = displacedMargin(
		-boundary.distance,
		point,
		boundary.boundary.owner,
		model.seed,
	);
	return {
		owner: margin > 0 ? boundary.boundary.owner : -1,
		margin,
		boundaryOwner: boundary.boundary.owner,
	};
}

export function sampleContinentSupport(
	direction: Vec3,
	continentIndex: number,
	model: LandSupportModel,
): ContinentSupportSample | undefined {
	if (
		continentIndex < 0 ||
		!Number.isSafeInteger(continentIndex)
	) {
		return undefined;
	}
	const point = normalizeVec3(direction);
	const guaranteed = nearestMember(point, model, continentIndex);
	if (guaranteed !== undefined) {
		const margin =
			guaranteed.member.guaranteeRadius -
			guaranteed.distance +
			MIN_NODE_BANDWIDTH;
		return {
			margin,
			normalizedScore: margin / MIN_NODE_BANDWIDTH,
		};
	}
	const query = queryLand(point, model);
	if (query.owner === continentIndex) {
		return {
			margin: query.margin,
			normalizedScore: query.margin / MIN_NODE_BANDWIDTH,
		};
	}
	const boundary = nearestBoundary(point, model.raster, continentIndex);
	const margin =
		boundary === undefined
			? -SUPPORT_DISTANCE_CAP
			: -Math.min(SUPPORT_DISTANCE_CAP, boundary.distance);
	return {
		margin,
		normalizedScore: margin / MIN_NODE_BANDWIDTH,
	};
}

export function classifySupportedContinent(
	direction: Vec3,
	model: LandSupportModel,
): number {
	return queryLand(direction, model).owner;
}

export function continentSupportClearance(
	direction: Vec3,
	continentIndex: number,
	model: LandSupportModel,
): number {
	const support = sampleContinentSupport(
		direction,
		continentIndex,
		model,
	);
	return support === undefined
		? Number.POSITIVE_INFINITY
		: -support.margin;
}

export function landSupportDiagnostics(
	model: LandSupportModel,
): LandSupportDiagnostics {
	let connectedOceanCellCount = 0;
	let landCellCount = 0;
	for (const value of model.raster.connectedOcean) {
		connectedOceanCellCount += value;
	}
	for (const owner of model.raster.ownerByCell) {
		landCellCount += owner >= 0 ? 1 : 0;
	}
	return {
		rasterCellCount: model.raster.grid.vertices.length,
		densityAnchorCount: bucketValueCount(model.anchors),
		boundarySampleCount: model.raster.boundaries.length,
		connectedOceanCellCount,
		connectedOceanFraction:
			connectedOceanCellCount / model.raster.grid.vertices.length,
		landCellCount,
	};
}
