import {
	hashNumbers,
	hashToSignedUnitFloat,
} from '../geometry/deterministicHash';
import { sampleGeodesicArc } from '../geometry/geodesicArc';
import { geodesicDistance } from '../geometry/sphericalGeometry';
import {
	normalizeVec3,
	readVec3,
	type Vec3,
} from '../geometry/vector3';
import type {
	RenderEdge,
	RenderGeography,
} from './renderTypes';

const SUPPORT_CELL_SIZE = 0.11;
const MIN_NODE_SUPPORT_RADIUS = 0.055;
const MAX_NODE_SUPPORT_RADIUS = 0.15;
const MIN_EDGE_SUPPORT_RADIUS = 0.038;
const MAX_EDGE_SUPPORT_RADIUS = 0.09;
const MAX_BRIDGED_EDGE_ANGLE = 0.36;
const OWNER_DOMINANCE_MARGIN = 0.055;
const FOREIGN_NODE_ADVANTAGE = 0.018;
const COAST_VARIATION = 0.075;

interface SupportAnchor {
	readonly direction: Vec3;
	readonly owner: number;
	readonly radius: number;
}

interface TerritoryNode {
	readonly direction: Vec3;
	readonly owner: number;
}

interface SpatialBuckets<T> {
	readonly cellSize: number;
	readonly cells: ReadonlyMap<string, readonly T[]>;
}

export interface LandSupportModel {
	readonly anchors: SpatialBuckets<SupportAnchor>;
	readonly territoryNodes: SpatialBuckets<TerritoryNode>;
	readonly maximumSupportRadius: number;
	readonly seed: number;
}

interface MutableBuckets<T> {
	readonly cellSize: number;
	readonly cells: Map<string, T[]>;
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

function createBuckets<T>(): MutableBuckets<T> {
	return {
		cellSize: SUPPORT_CELL_SIZE,
		cells: new Map<string, T[]>(),
	};
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

function continentNodeRadius(
	nodeCount: number,
	memberCount: number,
	capRadius: number,
): number {
	const globalSpacing = Math.sqrt(
		(4 * Math.PI) / Math.max(1, nodeCount),
	);
	const capArea =
		2 * Math.PI * (1 - Math.cos(Math.min(Math.PI, capRadius)));
	const localSpacing = Math.sqrt(
		capArea / Math.max(1, memberCount),
	);
	return clamp(
		Math.max(globalSpacing * 0.4, localSpacing * 0.72),
		MIN_NODE_SUPPORT_RADIUS,
		MAX_NODE_SUPPORT_RADIUS,
	);
}

function coastScale(point: Vec3, owner: number, seed: number): number {
	const phase =
		hashToSignedUnitFloat(seed, owner, 0xc0457) * Math.PI;
	const broad = Math.sin(
		point[0] * 13.1 +
			point[1] * 7.7 -
			point[2] * 9.3 +
			phase,
	);
	const fine = Math.sin(
		point[0] * 29.3 -
			point[1] * 17.9 +
			point[2] * 23.1 -
			phase * 0.63,
	);
	return 1 + (broad * 0.68 + fine * 0.32) * COAST_VARIATION;
}

function semanticAssignments(
	geography: RenderGeography,
	nodeCount: number,
): Int32Array {
	const assignments = new Int32Array(nodeCount);
	assignments.fill(-2);
	for (
		let continentIndex = 0;
		continentIndex < geography.continents.length;
		continentIndex += 1
	) {
		for (
			const nodeIndex of
			geography.continents[continentIndex]?.nodeIndices ?? []
		) {
			if (
				Number.isSafeInteger(nodeIndex) &&
				nodeIndex >= 0 &&
				nodeIndex < nodeCount &&
				assignments[nodeIndex] === -2
			) {
				assignments[nodeIndex] = continentIndex;
			}
		}
	}
	for (const nodeIndex of geography.islandNodeIndices) {
		if (
			Number.isSafeInteger(nodeIndex) &&
			nodeIndex >= 0 &&
			nodeIndex < nodeCount &&
			assignments[nodeIndex] === -2
		) {
			assignments[nodeIndex] = -1;
		}
	}
	return assignments;
}

function edgeAnchorKey(
	direction: Vec3,
	owner: number,
): string {
	const resolution = SUPPORT_CELL_SIZE * 0.55;
	return `${owner}|${Math.round(direction[0] / resolution)}|${Math.round(direction[1] / resolution)}|${Math.round(direction[2] / resolution)}`;
}

export function createLandSupportModel(
	geography: RenderGeography,
	positions: Float32Array,
	edges: readonly RenderEdge[],
	seed: number,
): LandSupportModel {
	if (positions.length % 3 !== 0) {
		throw new RangeError(
			'Land support positions must contain complete vectors.',
		);
	}
	const nodeCount = positions.length / 3;
	const assignments = semanticAssignments(geography, nodeCount);
	const anchors = createBuckets<SupportAnchor>();
	const territoryNodes = createBuckets<TerritoryNode>();
	const radiusByContinent = geography.continents.map((continent) =>
		continentNodeRadius(
			Math.max(
				1,
				geography.continents.reduce(
					(total, entry) => total + entry.nodeIndices.length,
					geography.islandNodeIndices.length,
				),
			),
			continent.nodeIndices.length,
			continent.capRadius,
		),
	);
	let maximumSupportRadius = MIN_NODE_SUPPORT_RADIUS;

	for (let nodeIndex = 0; nodeIndex < nodeCount; nodeIndex += 1) {
		const owner = assignments[nodeIndex] ?? -2;
		if (owner < -1) {
			continue;
		}
		const direction = normalizeVec3(readVec3(positions, nodeIndex));
		addToBuckets(territoryNodes, { direction, owner });
		if (owner < 0) {
			continue;
		}
		const radius =
			radiusByContinent[owner] ?? MIN_NODE_SUPPORT_RADIUS;
		maximumSupportRadius = Math.max(maximumSupportRadius, radius);
		addToBuckets(anchors, { direction, owner, radius });
	}

	const edgeAnchors = new Map<string, SupportAnchor>();
	for (const edge of edges) {
		if (
			edge.source < 0 ||
			edge.target < 0 ||
			edge.source >= nodeCount ||
			edge.target >= nodeCount
		) {
			continue;
		}
		const owner = assignments[edge.source] ?? -2;
		if (
			owner < 0 ||
			(assignments[edge.target] ?? -2) !== owner
		) {
			continue;
		}
		const start = normalizeVec3(readVec3(positions, edge.source));
		const end = normalizeVec3(readVec3(positions, edge.target));
		const angle = geodesicDistance(start, end);
		if (angle <= 1e-7 || angle > MAX_BRIDGED_EDGE_ANGLE) {
			continue;
		}
		const nodeRadius =
			radiusByContinent[owner] ?? MIN_NODE_SUPPORT_RADIUS;
		const radius = clamp(
			nodeRadius * 0.64,
			MIN_EDGE_SUPPORT_RADIUS,
			MAX_EDGE_SUPPORT_RADIUS,
		);
		maximumSupportRadius = Math.max(maximumSupportRadius, radius);
		const segments = Math.max(
			2,
			Math.ceil(angle / Math.max(0.025, radius * 0.78)),
		);
		const samples = sampleGeodesicArc(
			start,
			end,
			segments,
			1,
			String(edge.source),
			String(edge.target),
		);
		for (
			let sampleIndex = 1;
			sampleIndex + 1 < samples.length;
			sampleIndex += 1
		) {
			const direction = samples[sampleIndex];
			if (direction === undefined) {
				continue;
			}
			const key = edgeAnchorKey(direction, owner);
			const existing = edgeAnchors.get(key);
			if (existing === undefined || radius > existing.radius) {
				edgeAnchors.set(key, {
					direction,
					owner,
					radius,
				});
			}
		}
	}
	for (const anchor of edgeAnchors.values()) {
		addToBuckets(anchors, anchor);
	}

	return {
		anchors,
		territoryNodes,
		maximumSupportRadius,
		seed: hashNumbers(seed, 0x1a4d),
	};
}

function supportByOwner(
	point: Vec3,
	model: LandSupportModel,
): ReadonlyMap<number, {
	readonly normalizedScore: number;
	readonly margin: number;
}> {
	const support = new Map<
		number,
		{ normalizedScore: number; margin: number }
	>();
	forEachNearby(
		model.anchors,
		point,
		model.maximumSupportRadius * (1 + COAST_VARIATION),
		(anchor) => {
			const effectiveRadius =
				anchor.radius *
				coastScale(point, anchor.owner, model.seed);
			const margin =
				effectiveRadius -
				geodesicDistance(point, anchor.direction);
			const normalizedScore = margin / effectiveRadius;
			const existing = support.get(anchor.owner);
			if (
				existing === undefined ||
				normalizedScore > existing.normalizedScore
			) {
				support.set(anchor.owner, {
					normalizedScore,
					margin,
				});
			}
		},
	);
	return support;
}

function foreignNodeWins(
	point: Vec3,
	owner: number,
	model: LandSupportModel,
): boolean {
	let nearestOwn = Number.POSITIVE_INFINITY;
	let nearestForeign = Number.POSITIVE_INFINITY;
	const searchRadius = Math.max(
		0.22,
		model.maximumSupportRadius * 1.35,
	);
	forEachNearby(
		model.territoryNodes,
		point,
		searchRadius,
		(node) => {
			const distance = geodesicDistance(point, node.direction);
			if (node.owner === owner) {
				nearestOwn = Math.min(nearestOwn, distance);
			} else {
				nearestForeign = Math.min(nearestForeign, distance);
			}
		},
	);
	return (
		Number.isFinite(nearestForeign) &&
		nearestForeign + FOREIGN_NODE_ADVANTAGE < nearestOwn
	);
}

export function classifySupportedContinent(
	direction: Vec3,
	model: LandSupportModel,
): number {
	const point = normalizeVec3(direction);
	const support = supportByOwner(point, model);
	let bestOwner = -1;
	let bestScore = Number.NEGATIVE_INFINITY;
	let secondScore = Number.NEGATIVE_INFINITY;
	for (const [owner, entry] of support) {
		if (entry.normalizedScore > bestScore) {
			secondScore = bestScore;
			bestScore = entry.normalizedScore;
			bestOwner = owner;
		} else if (entry.normalizedScore > secondScore) {
			secondScore = entry.normalizedScore;
		}
	}
	if (
		bestOwner < 0 ||
		bestScore <= 0 ||
		bestScore - secondScore < OWNER_DOMINANCE_MARGIN ||
		foreignNodeWins(point, bestOwner, model)
	) {
		return -1;
	}
	return bestOwner;
}

export function continentSupportClearance(
	direction: Vec3,
	continentIndex: number,
	model: LandSupportModel,
): number {
	const point = normalizeVec3(direction);
	const support = supportByOwner(point, model).get(continentIndex);
	return support === undefined
		? Number.POSITIVE_INFINITY
		: -support.margin;
}
