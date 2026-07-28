import {
	hashNumbers,
	hashToSignedUnitFloat,
} from '../geometry/deterministicHash';
import { sampleGeodesicArc } from '../geometry/geodesicArc';
import {
	geodesicDistance,
	tangentDirection,
} from '../geometry/sphericalGeometry';
import {
	addVec3,
	crossVec3,
	dotVec3,
	lengthVec3,
	normalizeVec3,
	orthogonalUnitVec3,
	projectTangentVec3,
	readVec3,
	scaleVec3,
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
const COHERENT_FREE_EDGE_MAX_ANGLE = 0.22;
const MIN_COAST_SCALE = 0.58;
const MAX_COAST_SCALE = 1.34;
const SMOOTH_UNION_SHARPNESS = 400;

interface SupportAnchor {
	readonly direction: Vec3;
	readonly owner: number;
	readonly radius: number;
	readonly tangentX: Vec3;
	readonly tangentY: Vec3;
	readonly majorScale: number;
	readonly minorScale: number;
	readonly outerInfluence: number;
	readonly maximumGrowth: number;
}

interface TerritoryNode {
	readonly direction: Vec3;
	readonly owner: number;
	readonly carvesLand: boolean;
}

interface SpatialBuckets<T> {
	readonly cellSize: number;
	readonly cells: ReadonlyMap<string, readonly T[]>;
}

interface OwnerCoastProfile {
	readonly center: Vec3;
	readonly tangentX: Vec3;
	readonly tangentY: Vec3;
	readonly phases: readonly [
		number,
		number,
		number,
		number,
		number,
		number,
	];
}

export interface LandSupportModel {
	readonly anchors: SpatialBuckets<SupportAnchor>;
	readonly territoryNodes: SpatialBuckets<TerritoryNode>;
	readonly maximumSupportRadius: number;
	readonly maximumEffectiveSupportRadius: number;
	readonly ownerCoastProfiles: readonly OwnerCoastProfile[];
	readonly seed: number;
}

export interface ContinentSupportSample {
	readonly normalizedScore: number;
	/**
	 * Positive inside the support envelope, zero on the coast, negative at
	 * unsupported samples that were still within the spatial query radius.
	 */
	readonly margin: number;
}

interface MutableBuckets<T> {
	readonly cellSize: number;
	readonly cells: Map<string, T[]>;
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.min(maximum, Math.max(minimum, value));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
	const unit = clamp((value - edge0) / (edge1 - edge0), 0, 1);
	return unit * unit * (3 - 2 * unit);
}

function maximumSupportGrowth(radius: number): number {
	const density =
		(MAX_NODE_SUPPORT_RADIUS - radius) /
		(MAX_NODE_SUPPORT_RADIUS - MIN_NODE_SUPPORT_RADIUS);
	return clamp(0.022 + density * 0.1, 0.022, 0.122);
}

function supportGrowthEnvelope(scale: number): number {
	return (
		0.12 +
		smoothstep(MIN_COAST_SCALE, MAX_COAST_SCALE, scale) * 0.88
	);
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

function continentMemberExtent(
	geography: RenderGeography,
	positions: Float32Array,
	continentIndex: number,
): number {
	const continent = geography.continents[continentIndex];
	if (continent === undefined) {
		return MIN_NODE_SUPPORT_RADIUS;
	}
	const distances = continent.nodeIndices
		.filter(
			(nodeIndex) =>
				Number.isSafeInteger(nodeIndex) &&
				nodeIndex >= 0 &&
				nodeIndex * 3 + 2 < positions.length,
		)
		.map((nodeIndex) =>
			geodesicDistance(
				continent.center,
				normalizeVec3(readVec3(positions, nodeIndex)),
			),
		)
		.sort((left, right) => left - right);
	if (distances.length === 0) {
		return Math.max(MIN_NODE_SUPPORT_RADIUS, continent.capRadius);
	}
	const percentileIndex = Math.min(
		distances.length - 1,
		Math.floor((distances.length - 1) * 0.92),
	);
	return Math.max(
		MIN_NODE_SUPPORT_RADIUS,
		distances[percentileIndex] ?? continent.capRadius,
	);
}

function anchorOuterInfluence(
	direction: Vec3,
	owner: number,
	memberExtents: readonly number[],
	geography: RenderGeography,
): number {
	const continent = geography.continents[owner];
	const extent = memberExtents[owner];
	if (continent === undefined || extent === undefined || extent <= 0) {
		return 0;
	}
	return smoothstep(
		0.44,
		0.88,
		geodesicDistance(direction, continent.center) / extent,
	);
}

function createOwnerCoastProfile(
	center: Vec3,
	owner: number,
	seed: number,
): OwnerCoastProfile {
	const profileSeed = hashNumbers(seed, owner, 0xc0457);
	const tangentX = orthogonalUnitVec3(center, profileSeed);
	return {
		center: normalizeVec3(center),
		tangentX,
		tangentY: normalizeVec3(crossVec3(center, tangentX)),
		phases: [
			hashToSignedUnitFloat(profileSeed, 1) * Math.PI,
			hashToSignedUnitFloat(profileSeed, 2) * Math.PI,
			hashToSignedUnitFloat(profileSeed, 3) * Math.PI,
			hashToSignedUnitFloat(profileSeed, 5) * Math.PI,
			hashToSignedUnitFloat(profileSeed, 8) * Math.PI,
			hashToSignedUnitFloat(profileSeed, 13) * Math.PI,
		],
	};
}

/**
 * One continuous field deforms every support kernel belonging to an owner.
 * Low harmonics make the whole landmass asymmetric; successively smaller
 * harmonics add capes, bays, and fine inlets without moving graph nodes.
 */
function coastScale(
	point: Vec3,
	anchor: SupportAnchor,
	model: LandSupportModel,
): number {
	const profile = model.ownerCoastProfiles[anchor.owner];
	if (profile === undefined) {
		return 1;
	}
	const azimuth = Math.atan2(
		dotVec3(point, profile.tangentY),
		dotVec3(point, profile.tangentX),
	);
	const [phase1, phase2, phase3, phase5, phase11, phase23] =
		profile.phases;
	const broad =
		Math.sin(azimuth + phase1) * 0.14 +
		Math.sin(azimuth * 2 + phase2) * 0.145 +
		Math.sin(azimuth * 3 + phase3) * 0.075;
	const detail =
		Math.sin(azimuth * 5 + phase5) * 0.052 +
		Math.sin(azimuth * 11 + phase11) * 0.034 +
		Math.sin(azimuth * 23 + phase23) * 0.021 +
		Math.sin(azimuth * 47 + phase1 * 1.7 - phase11) * 0.012 +
		Math.sin(azimuth * 89 - phase2 * 0.6 + phase23) * 0.006;
	const micro =
		Math.sin(
			point[0] * 47.3 -
				point[1] * 61.7 +
				point[2] * 53.9 +
				phase11,
		) *
			0.017 +
		Math.sin(
			point[0] * 91.1 +
				point[1] * 73.3 -
				point[2] * 87.7 -
				phase23,
		) *
			0.009;
	return clamp(
		1 + anchor.outerInfluence * (0.035 + broad + detail + micro),
		MIN_COAST_SCALE,
		MAX_COAST_SCALE,
	);
}

function anchorDirectionalScale(
	point: Vec3,
	anchor: SupportAnchor,
): number {
	const projected = projectTangentVec3(anchor.direction, point);
	const magnitude = lengthVec3(projected);
	if (magnitude <= 1e-9) {
		return 1;
	}
	const inverseMagnitude = 1 / magnitude;
	const cosine =
		dotVec3(projected, anchor.tangentX) * inverseMagnitude;
	const sine =
		dotVec3(projected, anchor.tangentY) * inverseMagnitude;
	return 1 /
		Math.sqrt(
			(cosine * cosine) /
				(anchor.majorScale * anchor.majorScale) +
			(sine * sine) /
				(anchor.minorScale * anchor.minorScale),
		);
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

function territoryEdgeWeight(weight: number): number {
	return Math.min(4, 0.75 + Math.log1p(Math.max(0, weight)));
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
	const modelSeed = hashNumbers(seed, 0x1a4d);
	const assignments = semanticAssignments(geography, nodeCount);
	const anchors = createBuckets<SupportAnchor>();
	const territoryNodes = createBuckets<TerritoryNode>();
	const memberExtents = geography.continents.map((_, continentIndex) =>
		continentMemberExtent(geography, positions, continentIndex),
	);
	const ownerCoastProfiles = geography.continents.map(
		(continent, owner) =>
			createOwnerCoastProfile(continent.center, owner, modelSeed),
	);
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
	const freeNeighborCounts = new Uint16Array(nodeCount);
	const freeNeighborWeights = new Float64Array(nodeCount);
	const continentNeighborWeights = new Float64Array(nodeCount);
	const preferredAxes = new Array<Vec3 | undefined>(nodeCount);
	const preferredAxisScores = new Float64Array(nodeCount);
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
		const weight = territoryEdgeWeight(edge.weight);
		if (sourceOwner >= 0 && targetOwner === sourceOwner) {
			const source = normalizeVec3(readVec3(positions, edge.source));
			const target = normalizeVec3(readVec3(positions, edge.target));
			const angle = geodesicDistance(source, target);
			if (angle > 1e-7) {
				const score = weight * Math.min(MAX_BRIDGED_EDGE_ANGLE, angle);
				if (score > (preferredAxisScores[edge.source] ?? 0)) {
					preferredAxisScores[edge.source] = score;
					preferredAxes[edge.source] = tangentDirection(
						source,
						target,
						edge.source,
					);
				}
				if (score > (preferredAxisScores[edge.target] ?? 0)) {
					preferredAxisScores[edge.target] = score;
					preferredAxes[edge.target] = tangentDirection(
						target,
						source,
						edge.target,
					);
				}
			}
		}
		if (sourceOwner === -1 && targetOwner === -1) {
			const source = normalizeVec3(readVec3(positions, edge.source));
			const target = normalizeVec3(readVec3(positions, edge.target));
			if (
				geodesicDistance(source, target) >
				COHERENT_FREE_EDGE_MAX_ANGLE
			) {
				continue;
			}
			freeNeighborCounts[edge.source] =
				(freeNeighborCounts[edge.source] ?? 0) + 1;
			freeNeighborCounts[edge.target] =
				(freeNeighborCounts[edge.target] ?? 0) + 1;
			freeNeighborWeights[edge.source] =
				(freeNeighborWeights[edge.source] ?? 0) + weight;
			freeNeighborWeights[edge.target] =
				(freeNeighborWeights[edge.target] ?? 0) + weight;
		} else if (sourceOwner === -1 && targetOwner >= 0) {
			continentNeighborWeights[edge.source] =
				(continentNeighborWeights[edge.source] ?? 0) + weight;
		} else if (targetOwner === -1 && sourceOwner >= 0) {
			continentNeighborWeights[edge.target] =
				(continentNeighborWeights[edge.target] ?? 0) + weight;
		}
	}

	for (let nodeIndex = 0; nodeIndex < nodeCount; nodeIndex += 1) {
		const owner = assignments[nodeIndex] ?? -2;
		if (owner < -1) {
			continue;
		}
		const direction = normalizeVec3(readVec3(positions, nodeIndex));
		const carvesLand =
			owner >= 0 ||
			((freeNeighborCounts[nodeIndex] ?? 0) >= 2 &&
				(freeNeighborWeights[nodeIndex] ?? 0) >=
					(continentNeighborWeights[nodeIndex] ?? 0));
		addToBuckets(territoryNodes, {
			direction,
			owner,
			carvesLand,
		});
		if (owner < 0) {
			continue;
		}
		const radius =
			radiusByContinent[owner] ?? MIN_NODE_SUPPORT_RADIUS;
		const kernelSeed = hashNumbers(
			modelSeed,
			owner,
			nodeIndex,
			0xa11ce,
		);
		const outerInfluence = anchorOuterInfluence(
			direction,
			owner,
			memberExtents,
			geography,
		);
		const majorScale =
			1 +
			outerInfluence *
				(0.18 +
					(hashToSignedUnitFloat(kernelSeed, 1) + 1) * 0.1);
		const minorScale =
			1 -
			outerInfluence *
				(0.02 +
					(hashToSignedUnitFloat(kernelSeed, 2) + 1) * 0.025);
		const preferredAxis =
			preferredAxes[nodeIndex] ??
			orthogonalUnitVec3(direction, kernelSeed);
		const preferredPerpendicular = normalizeVec3(
			crossVec3(direction, preferredAxis),
		);
		const orientationOffset =
			hashToSignedUnitFloat(kernelSeed, 3) * (Math.PI / 2);
		const tangentX = normalizeVec3(
			addVec3(
				scaleVec3(preferredAxis, Math.cos(orientationOffset)),
				scaleVec3(
					preferredPerpendicular,
					Math.sin(orientationOffset),
				),
			),
		);
		maximumSupportRadius = Math.max(maximumSupportRadius, radius);
		addToBuckets(anchors, {
			direction,
			owner,
			radius,
			tangentX,
			tangentY: normalizeVec3(crossVec3(direction, tangentX)),
			majorScale,
			minorScale,
			outerInfluence,
			maximumGrowth: maximumSupportGrowth(radius),
		});
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
				const kernelSeed = hashNumbers(
					modelSeed,
					owner,
					edge.source,
					edge.target,
					sampleIndex,
				);
				const tangentX = tangentDirection(
					direction,
					end,
					kernelSeed,
				);
				const outerInfluence = anchorOuterInfluence(
					direction,
					owner,
					memberExtents,
					geography,
				);
				edgeAnchors.set(key, {
					direction,
					owner,
					radius,
					tangentX,
					tangentY: normalizeVec3(
						crossVec3(direction, tangentX),
					),
					majorScale: 1.18 + outerInfluence * 0.1,
					minorScale: 0.96,
					outerInfluence,
					maximumGrowth: 0.022,
				});
			}
		}
	}
	for (const anchor of edgeAnchors.values()) {
		addToBuckets(anchors, anchor);
	}
	let maximumEffectiveSupportRadius = MIN_NODE_SUPPORT_RADIUS;
	for (const cell of anchors.cells.values()) {
		for (const anchor of cell) {
			maximumEffectiveSupportRadius = Math.max(
				maximumEffectiveSupportRadius,
				Math.min(
					anchor.radius *
						Math.max(anchor.majorScale, anchor.minorScale) *
						MAX_COAST_SCALE,
					anchor.radius + anchor.maximumGrowth,
				),
			);
		}
	}

	return {
		anchors,
		territoryNodes,
		maximumSupportRadius,
		maximumEffectiveSupportRadius,
		ownerCoastProfiles,
		seed: modelSeed,
	};
}

function supportByOwner(
	point: Vec3,
	model: LandSupportModel,
): ReadonlyMap<number, ContinentSupportSample> {
	const accumulated = new Map<
		number,
		{
			margin: number;
			bestNormalizedScore: number;
			normalizationRadius: number;
		}
	>();
	forEachNearby(
		model.anchors,
		point,
		model.maximumEffectiveSupportRadius,
		(anchor) => {
			const coastDeformation = coastScale(point, anchor, model);
			const rawRadius =
				anchor.radius *
				anchorDirectionalScale(point, anchor) *
				coastDeformation;
			const effectiveRadius = clamp(
				rawRadius,
				Math.max(0.018, anchor.radius * 0.34),
				anchor.radius +
					anchor.maximumGrowth *
						supportGrowthEnvelope(coastDeformation),
			);
			const margin =
				effectiveRadius -
				geodesicDistance(point, anchor.direction);
			const normalizedScore = margin / effectiveRadius;
			const existing = accumulated.get(anchor.owner);
			if (existing === undefined) {
				accumulated.set(anchor.owner, {
					margin,
					bestNormalizedScore: normalizedScore,
					normalizationRadius: effectiveRadius,
				});
				return;
			}
			const maximum = Math.max(existing.margin, margin);
			existing.margin =
				maximum +
				Math.log1p(
					Math.exp(
						-Math.abs(existing.margin - margin) *
							SMOOTH_UNION_SHARPNESS,
					),
				) /
					SMOOTH_UNION_SHARPNESS;
			if (normalizedScore > existing.bestNormalizedScore) {
				existing.bestNormalizedScore = normalizedScore;
				existing.normalizationRadius = effectiveRadius;
			}
		},
	);
	const support = new Map<number, ContinentSupportSample>();
	for (const [owner, entry] of accumulated) {
		support.set(owner, {
			margin: entry.margin,
			normalizedScore:
				entry.margin / Math.max(1e-9, entry.normalizationRadius),
		});
	}
	return support;
}

export function sampleContinentSupport(
	direction: Vec3,
	continentIndex: number,
	model: LandSupportModel,
): ContinentSupportSample | undefined {
	return supportByOwner(
		normalizeVec3(direction),
		model,
	).get(continentIndex);
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
			if (!node.carvesLand) {
				return;
			}
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
	const support = sampleContinentSupport(
		direction,
		continentIndex,
		model,
	);
	return support === undefined
		? Number.POSITIVE_INFINITY
		: -support.margin;
}
