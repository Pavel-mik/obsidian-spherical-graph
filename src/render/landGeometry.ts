import { IcosahedronGeometry, Vector3 } from 'three';
import {
	hashNumbers,
	hashToSignedUnitFloat,
} from '../geometry/deterministicHash';
import {
	exponentialMap,
	geodesicDistance,
	tangentDirection,
} from '../geometry/sphericalGeometry';
import {
	addVec3,
	crossVec3,
	dotVec3,
	normalizeVec3,
	orthogonalUnitVec3,
	readVec3,
	scaleVec3,
	type Vec3,
} from '../geometry/vector3';
import {
	classifySupportedContinent,
	continentSupportClearance,
	createLandSupportModel,
	sampleContinentSupport,
	type LandSupportModel,
} from './landSupport';
import type {
	RenderEdge,
	RenderGeography,
} from './renderTypes';

export const SEA_OWNER = -1;
const LAND_SURFACE_OFFSET = 0.0025;
const COAST_SURFACE_OFFSET = 0.006;
export const MIN_BEACH_ANGULAR_WIDTH = 0.006;
export const MAX_BEACH_ANGULAR_WIDTH = 0.025;
export const MAX_RENDERED_ISLANDS = 24;
const MIN_RENDERED_ISLAND_SEPARATION = 0.11;

export interface LandSurfaceData {
	readonly positions: Float32Array;
	readonly colorIndices: Uint8Array;
	readonly shades: Float32Array;
	readonly beachPositions: Float32Array;
	readonly coastPositions: Float32Array;
	readonly triangleCount: number;
	readonly beachTriangleCount: number;
	readonly renderedIslandCount: number;
}

interface CoastProfile {
	readonly center: Vec3;
	readonly tangentX: Vec3;
	readonly tangentY: Vec3;
	readonly capRadius: number;
	readonly orientation: number;
	readonly phases: readonly [number, number, number, number];
	readonly textureSeed: number;
}

interface LandModel {
	readonly geography: RenderGeography;
	readonly positions: Float32Array;
	readonly seed: number;
	readonly edges?: readonly RenderEdge[];
	readonly coastProfiles?: readonly CoastProfile[];
	readonly support?: LandSupportModel;
}

function terrainNoise(direction: Vec3, seed: number): number {
	const phase = hashToSignedUnitFloat(seed, 0x71) * Math.PI;
	const first = Math.sin(
		direction[0] * 9.1 +
			direction[1] * 13.7 +
			direction[2] * 6.3 +
			phase,
	);
	const second = Math.sin(
		direction[0] * 17.3 -
			direction[1] * 7.9 +
			direction[2] * 11.1 -
			phase * 0.7,
	);
	return first * 0.68 + second * 0.32;
}

export function continentBeachWidth(
	direction: Vec3,
	owner: number,
	seed: number,
): number {
	const point = normalizeVec3(direction);
	const phase = hashToSignedUnitFloat(seed, owner, 0xbeac4) * Math.PI;
	const field =
		Math.sin(
			point[0] * 8.3 +
				point[1] * 11.7 -
				point[2] * 7.1 +
				phase,
		) *
			0.55 +
		Math.sin(
			point[0] * 19.1 -
				point[1] * 16.7 +
				point[2] * 22.3 -
				phase * 0.7,
		) *
			0.3 +
		Math.sin(
			point[0] * 41.3 +
				point[1] * 37.9 -
				point[2] * 43.7 +
				phase * 1.3,
		) *
			0.15;
	const unit = Math.min(1, Math.max(0, field * 0.5 + 0.5));
	return (
		MIN_BEACH_ANGULAR_WIDTH +
		(MAX_BEACH_ANGULAR_WIDTH - MIN_BEACH_ANGULAR_WIDTH) * unit
	);
}

function createCoastProfile(
	continentIndex: number,
	model: LandModel,
): CoastProfile | undefined {
	const continent = model.geography.continents[continentIndex];
	if (continent === undefined) {
		return undefined;
	}
	const profileSeed = hashNumbers(model.seed, continentIndex, 0xc0457);
	const tangentX = orthogonalUnitVec3(continent.center, profileSeed);
	return {
		center: continent.center,
		tangentX,
		tangentY: normalizeVec3(crossVec3(continent.center, tangentX)),
		capRadius: continent.capRadius,
		orientation:
			hashToSignedUnitFloat(profileSeed, 0x0a71) * Math.PI,
		phases: [
			hashToSignedUnitFloat(profileSeed, 3) * Math.PI,
			hashToSignedUnitFloat(profileSeed, 5) * Math.PI,
			hashToSignedUnitFloat(profileSeed, 8) * Math.PI,
			hashToSignedUnitFloat(profileSeed, 13) * Math.PI,
		],
		textureSeed: hashNumbers(profileSeed, 0x7e221),
	};
}

function createLandModel(
	geography: RenderGeography,
	positions: Float32Array,
	seed: number,
	edges: readonly RenderEdge[] = [],
): LandModel {
	const model: LandModel = {
		geography,
		positions,
		seed,
		edges,
	};
	return {
		...model,
		coastProfiles: geography.continents.map((_, index) =>
			createCoastProfile(index, model),
		).filter((profile): profile is CoastProfile => profile !== undefined),
		support: createLandSupportModel(
			geography,
			positions,
			edges,
			seed,
		),
	};
}

function coastRadius(
	point: Vec3,
	profile: CoastProfile,
): number {
	const x = dotVec3(point, profile.tangentX);
	const y = dotVec3(point, profile.tangentY);
	const azimuth = Math.atan2(y, x);
	const [phase3, phase5, phase8, phase13] = profile.phases;
	const coves =
		-Math.pow(
			Math.max(0, Math.sin(azimuth * 3 + phase3)),
			6,
		) *
			0.052 -
		Math.pow(
			Math.max(0, Math.sin(azimuth * 7 - phase8)),
			8,
		) *
			0.032;
	const headlands =
		Math.pow(
			Math.max(0, Math.sin(azimuth * 5 + phase5 + 1.4)),
			8,
		) *
			0.048 +
		Math.pow(
			Math.max(0, Math.sin(azimuth * 9 + phase13 - 0.8)),
			10,
		) *
			0.026;
	const outline =
		0.975 +
		Math.cos((azimuth - profile.orientation) * 2) * 0.03 +
		Math.sin(azimuth * 3 + phase3) * 0.028 +
		Math.sin(azimuth * 5 + phase5) * 0.024 +
		Math.sin(azimuth * 8 + phase8) * 0.018 +
		Math.sin(azimuth * 13 + phase13) * 0.014 +
		terrainNoise(point, profile.textureSeed) * 0.018 +
		coves +
		headlands;
	return profile.capRadius * Math.min(1.11, Math.max(0.845, outline));
}

/**
 * Samples the legacy broad radial envelope. It remains useful for decorative
 * shelf-island placement, while actual continent ownership is derived from
 * member nodes and short internal roads.
 */
export function continentCoastRadius(
	direction: Vec3,
	continentIndex: number,
	model: LandModel,
): number {
	const point = normalizeVec3(direction);
	const profile =
		model.coastProfiles?.[continentIndex] ??
		createCoastProfile(continentIndex, model);
	return profile === undefined ? 0 : coastRadius(point, profile);
}

/**
 * Returns a continent index, an island owner encoded after all continents, or
 * `SEA_OWNER`. A dominance margin guarantees one owner per cell and preserves
 * water where two land potentials would otherwise overlap.
 */
export function classifyLandOwner(
	direction: Vec3,
	model: LandModel,
): number {
	const point = normalizeVec3(direction);
	const continentOwner = classifyContinentOwner(point, model);
	if (continentOwner !== SEA_OWNER) {
		return continentOwner;
	}

	for (
		let islandIndex = 0;
		islandIndex < model.geography.islandNodeIndices.length;
		islandIndex += 1
	) {
		const nodeIndex = model.geography.islandNodeIndices[islandIndex];
		if (nodeIndex === undefined) {
			continue;
		}
		const center = readVec3(model.positions, nodeIndex);
		const radius =
			0.055 +
			(hashNumbers(model.seed, nodeIndex, 0x151a) % 1000) /
				1000 *
				0.025;
		if (geodesicDistance(point, center) <= radius) {
			return model.geography.continents.length + islandIndex;
		}
	}
	return SEA_OWNER;
}

function classifyContinentOwner(
	direction: Vec3,
	model: LandModel,
): number {
	const support =
		model.support ??
		createLandSupportModel(
			model.geography,
			model.positions,
			model.edges ?? [],
			model.seed,
		);
	return classifySupportedContinent(
		normalizeVec3(direction),
		support,
	);
}

function vertexKey(vector: Vector3): string {
	return `${Math.round(vector.x * 1e6)},${Math.round(vector.y * 1e6)},${Math.round(vector.z * 1e6)}`;
}

function pushAtRadius(
	target: number[],
	vector: Vector3,
	radius: number,
): void {
	target.push(
		vector.x * radius,
		vector.y * radius,
		vector.z * radius,
	);
}

function appendDetailedCoastSegment(
	target: number[],
	start: Vec3,
	end: Vec3,
	ownerCenter: Vec3,
	seed: number,
	owner: number,
	radius: number,
): void {
	const subdivisions = 4;
	let previous = normalizeVec3(start);
	for (let subdivision = 1; subdivision <= subdivisions; subdivision += 1) {
		const fraction = subdivision / subdivisions;
		const base = normalizeVec3([
			start[0] * (1 - fraction) + end[0] * fraction,
			start[1] * (1 - fraction) + end[1] * fraction,
			start[2] * (1 - fraction) + end[2] * fraction,
		]);
		const phase =
			hashToSignedUnitFloat(seed, owner, 0xc0a57) * Math.PI;
		const jitterField =
			Math.sin(
				base[0] * 137.3 -
					base[1] * 113.9 +
					base[2] * 151.7 +
					phase,
			) *
				0.62 +
			Math.sin(
				base[0] * 281.9 +
					base[1] * 263.3 -
					base[2] * 239.7 -
					phase * 0.73,
			) *
				0.38;
		const point =
			subdivision === subdivisions
				? base
				: exponentialMap(
						base,
						scaleVec3(
							tangentDirection(base, ownerCenter, owner),
							jitterField * 0.0055,
						),
					);
		target.push(
			previous[0] * radius,
			previous[1] * radius,
			previous[2] * radius,
			point[0] * radius,
			point[1] * radius,
			point[2] * radius,
		);
		previous = point;
	}
}

interface ClippedLandPolygon {
	readonly points: readonly Vector3[];
	readonly coastIntersections: readonly Vector3[];
}

function bisectPredicateBoundary(
	start: Vector3,
	end: Vector3,
	isInside: (point: Vector3) => boolean,
): Vector3 {
	let inside = isInside(start) ? start.clone() : end.clone();
	let outside = isInside(start) ? end.clone() : start.clone();
	for (let iteration = 0; iteration < 11; iteration += 1) {
		const middle = inside.clone().add(outside).normalize();
		if (isInside(middle)) {
			inside = middle;
		} else {
			outside = middle;
		}
	}
	return inside.add(outside).normalize();
}

function clipTriangleByPredicate(
	triangle: readonly [Vector3, Vector3, Vector3],
	isInside: (point: Vector3) => boolean,
): ClippedLandPolygon {
	const points: Vector3[] = [];
	const coastIntersections: Vector3[] = [];
	for (let index = 0; index < triangle.length; index += 1) {
		const current = triangle[index];
		const next = triangle[(index + 1) % triangle.length];
		if (current === undefined || next === undefined) {
			continue;
		}
		const currentInside = isInside(current);
		const nextInside = isInside(next);
		if (currentInside && nextInside) {
			points.push(next);
		} else if (currentInside !== nextInside) {
			const intersection = bisectPredicateBoundary(
				current,
				next,
				isInside,
			);
			points.push(intersection);
			coastIntersections.push(intersection);
			if (nextInside) {
				points.push(next);
			}
		}
	}
	return { points, coastIntersections };
}

function surfaceShade(point: Vector3, seed: number, owner: number): number {
	return (
		0.91 +
		terrainNoise(
			[point.x, point.y, point.z],
			hashNumbers(seed, owner, 0x5ade),
		) *
			0.065 +
		terrainNoise(
			[point.z, point.x, point.y],
			hashNumbers(seed, owner, 0xd3711),
		) *
			0.025
	);
}

function islandLandBudget(nodeCount: number, islandCount: number): number {
	if (islandCount <= 8) {
		return islandCount;
	}
	const adaptiveBudget = Math.round(6 + Math.sqrt(nodeCount) * 0.72);
	return Math.min(
		islandCount,
		Math.max(8, Math.min(MAX_RENDERED_ISLANDS, adaptiveBudget)),
	);
}

export function renderedIslandRadius(
	nodeCount: number,
	nodeIndex: number,
	seed: number,
): number {
	const densityScale = Math.min(
		1,
		Math.max(0.38, Math.sqrt(96 / Math.max(1, nodeCount))),
	);
	return (
		(0.045 +
			(hashNumbers(seed, nodeIndex, 0x51) % 1000) / 1000 * 0.018) *
		densityScale
	);
}

interface IslandLandCandidate {
	readonly nodeIndex: number;
	readonly center: Vec3;
	readonly seaClearance: number;
	readonly tieBreaker: number;
}

/**
 * Free nodes are a layout concept, not a mandate to draw one land patch per
 * note. This deterministic render-only LOD keeps a small set of isolated,
 * spatially separated representatives. Other free nodes remain visible as
 * cities over open water and retain their links, picking, and labels.
 */
export function selectRenderedIslandNodeIndices(
	geography: RenderGeography,
	positions: Float32Array,
	seed: number,
	edges: readonly RenderEdge[] = [],
): readonly number[] {
	const nodeCount = positions.length / 3;
	const budget = islandLandBudget(
		nodeCount,
		geography.islandNodeIndices.length,
	);
	if (budget === 0) {
		return [];
	}
	const continentModel = createLandModel(
		geography,
		positions,
		seed,
		edges,
	);
	const candidates: IslandLandCandidate[] = [];
	for (const nodeIndex of geography.islandNodeIndices) {
		const center = normalizeVec3(readVec3(positions, nodeIndex));
		const islandRadius = renderedIslandRadius(nodeCount, nodeIndex, seed);
		let seaClearance = Math.PI;
		for (
			let continentIndex = 0;
			continentIndex < geography.continents.length;
			continentIndex += 1
		) {
			seaClearance = Math.min(
				seaClearance,
				continentSupportClearance(
					center,
					continentIndex,
					continentModel.support ??
						createLandSupportModel(
							geography,
							positions,
							edges,
							seed,
						),
				),
			);
		}
		if (seaClearance <= islandRadius * 1.4) {
			continue;
		}
		candidates.push({
			nodeIndex,
			center,
			seaClearance,
			tieBreaker: hashNumbers(seed, nodeIndex, 0x15e1),
		});
	}
	candidates.sort(
		(left, right) =>
			right.seaClearance - left.seaClearance ||
			left.tieBreaker - right.tieBreaker ||
			left.nodeIndex - right.nodeIndex,
	);

	const selected: IslandLandCandidate[] = [];
	for (const separationScale of [1, 0.72, 0.48] as const) {
		for (const candidate of candidates) {
			if (
				selected.length >= budget ||
				selected.some((entry) => entry.nodeIndex === candidate.nodeIndex)
			) {
				continue;
			}
			const minimumSeparation =
				MIN_RENDERED_ISLAND_SEPARATION * separationScale;
			if (
				minimumSeparation > 0 &&
				selected.some(
					(entry) =>
						geodesicDistance(entry.center, candidate.center) <
						minimumSeparation,
				)
			) {
				continue;
			}
			selected.push(candidate);
		}
		if (selected.length >= budget) {
			break;
		}
	}
	return selected
		.map((candidate) => candidate.nodeIndex)
		.sort((left, right) => left - right);
}

function islandColorIndex(
	center: Vec3,
	geography: RenderGeography,
	nodeIndex: number,
	seed: number,
): number {
	let nearestColorIndex: number | undefined;
	let nearestDistance = Number.POSITIVE_INFINITY;
	for (const continent of geography.continents) {
		const distance = geodesicDistance(center, continent.center);
		if (distance < nearestDistance) {
			nearestDistance = distance;
			nearestColorIndex = continent.colorIndex;
		}
	}
	return (
		nearestColorIndex ??
		hashNumbers(seed, nodeIndex, 0x15c0) % 6
	);
}

function appendIslandPatch(
	landPositions: number[],
	colorIndices: number[],
	shades: number[],
	beachPositions: number[],
	coastPositions: number[],
	center: Vec3,
	baseAngularRadius: number,
	colorIndex: number,
	seed: number,
	radius: number,
): number {
	const segmentCount = 30;
	const firstTangent = orthogonalUnitVec3(center, seed);
	const secondTangent = normalizeVec3(crossVec3(center, firstTangent));
	const phase3 = hashToSignedUnitFloat(seed, 3) * Math.PI;
	const phase5 = hashToSignedUnitFloat(seed, 5) * Math.PI;
	const phase7 = hashToSignedUnitFloat(seed, 7) * Math.PI;
	const ring: Vec3[] = [];
	const innerRing: Vec3[] = [];
	for (let segment = 0; segment < segmentCount; segment += 1) {
		const phase = (segment / segmentCount) * Math.PI * 2;
		const localRadius =
			baseAngularRadius *
			(1 +
				Math.sin(phase * 3 + phase3) * 0.12 +
				Math.sin(phase * 5 + phase5) * 0.065 +
				Math.sin(phase * 7 + phase7) * 0.035);
		const beachWidth = Math.min(
			localRadius * 0.32,
			MIN_BEACH_ANGULAR_WIDTH +
				(Math.sin(phase * 4 - phase5) * 0.5 + 0.5) *
					0.004,
		);
		const tangentDirection = normalizeVec3(
			addVec3(
				scaleVec3(firstTangent, Math.cos(phase)),
				scaleVec3(secondTangent, Math.sin(phase)),
			),
		);
		ring.push(
			exponentialMap(
				center,
				scaleVec3(tangentDirection, localRadius),
			),
		);
		innerRing.push(
			exponentialMap(
				center,
				scaleVec3(
					tangentDirection,
					Math.max(localRadius * 0.5, localRadius - beachWidth),
				),
			),
		);
	}
	for (let segment = 0; segment < segmentCount; segment += 1) {
		const start = ring[segment];
		const end = ring[(segment + 1) % segmentCount];
		const innerStart = innerRing[segment];
		const innerEnd = innerRing[(segment + 1) % segmentCount];
		if (
			start === undefined ||
			end === undefined ||
			innerStart === undefined ||
			innerEnd === undefined
		) {
			continue;
		}
		for (const point of [center, start, end]) {
			beachPositions.push(
				point[0] * radius,
				point[1] * radius,
				point[2] * radius,
			);
		}
		for (const point of [center, innerStart, innerEnd]) {
			landPositions.push(
				point[0] * (radius + LAND_SURFACE_OFFSET),
				point[1] * (radius + LAND_SURFACE_OFFSET),
				point[2] * (radius + LAND_SURFACE_OFFSET),
			);
			colorIndices.push(colorIndex);
			shades.push(
				0.92 +
					terrainNoise(point, hashNumbers(seed, 0x5ade)) * 0.055,
			);
		}
		appendDetailedCoastSegment(
			coastPositions,
			start,
			end,
			center,
			seed,
			colorIndex,
			radius + COAST_SURFACE_OFFSET,
		);
	}
	return segmentCount;
}

export function buildLandSurfaceData(
	geography: RenderGeography,
	positions: Float32Array,
	radius: number,
	seed: number,
	detail = 48,
	edges: readonly RenderEdge[] = [],
): LandSurfaceData {
	if (
		positions.length % 3 !== 0 ||
		!Number.isFinite(radius) ||
		radius <= 0 ||
		!Number.isSafeInteger(detail) ||
		detail < 0 ||
		detail > 64
	) {
		throw new RangeError('Invalid land surface input.');
	}
	if (
		geography.continents.length === 0 &&
		geography.islandNodeIndices.length === 0
	) {
		return {
			positions: new Float32Array(),
			colorIndices: new Uint8Array(),
			shades: new Float32Array(),
			beachPositions: new Float32Array(),
			coastPositions: new Float32Array(),
			triangleCount: 0,
			beachTriangleCount: 0,
			renderedIslandCount: 0,
		};
	}
	const renderedIslandNodeIndices = selectRenderedIslandNodeIndices(
		geography,
		positions,
		seed,
		edges,
	);
	const rawGeometry = new IcosahedronGeometry(1, detail);
	const source =
		rawGeometry.index === null
			? rawGeometry
			: rawGeometry.toNonIndexed();
	const attribute = source.getAttribute('position');
	const landPositions: number[] = [];
	const colorIndices: number[] = [];
	const shades: number[] = [];
	const beachPositions: number[] = [];
	const coastPositions: number[] = [];
	const a = new Vector3();
	const b = new Vector3();
	const c = new Vector3();
	const centroid = new Vector3();
	const ownerCache = new Map<string, number>();
	const interiorCache = new Map<string, boolean>();
	const model = createLandModel(
		geography,
		positions,
		seed,
		edges,
	);
	const continentModel = model;
	const supportModel =
		model.support ??
		createLandSupportModel(geography, positions, edges, seed);
	const classifyVector = (point: Vector3): number => {
		const key = vertexKey(point);
		const cached = ownerCache.get(key);
		if (cached !== undefined) {
			return cached;
		}
		const owner = classifyContinentOwner(
			[point.x, point.y, point.z],
			continentModel,
		);
		ownerCache.set(key, owner);
		return owner;
	};
	const hasInteriorLand = (point: Vector3, owner: number): boolean => {
		const key = `${owner}|${vertexKey(point)}`;
		const cached = interiorCache.get(key);
		if (cached !== undefined) {
			return cached;
		}
		const direction: Vec3 = [point.x, point.y, point.z];
		const support = sampleContinentSupport(
			direction,
			owner,
			supportModel,
		);
		const inside =
			classifyVector(point) === owner &&
			support !== undefined &&
			support.margin >= continentBeachWidth(direction, owner, seed);
		interiorCache.set(key, inside);
		return inside;
	};
	let triangleCount = 0;
	let beachTriangleCount = 0;
	for (let vertex = 0; vertex + 2 < attribute.count; vertex += 3) {
		a.fromBufferAttribute(attribute, vertex).normalize();
		b.fromBufferAttribute(attribute, vertex + 1).normalize();
		c.fromBufferAttribute(attribute, vertex + 2).normalize();
		centroid.copy(a).add(b).add(c).normalize();
		const candidateOwners = new Set([
			classifyVector(a),
			classifyVector(b),
			classifyVector(c),
			classifyVector(centroid),
		]);
		candidateOwners.delete(SEA_OWNER);
		for (const owner of candidateOwners) {
			const continent = geography.continents[owner];
			const colorIndex =
				continent?.colorIndex ??
				hashNumbers(
					seed,
					geography.islandNodeIndices[
						owner - geography.continents.length
					] ?? owner,
				) %
					6;
			const outer = clipTriangleByPredicate(
				[a, b, c],
				(point) => classifyVector(point) === owner,
			);
			const beachFirst = outer.points[0];
			if (beachFirst !== undefined) {
				for (
					let pointIndex = 1;
					pointIndex + 1 < outer.points.length;
					pointIndex += 1
				) {
					const second = outer.points[pointIndex];
					const third = outer.points[pointIndex + 1];
					if (second === undefined || third === undefined) {
						continue;
					}
					for (const point of [beachFirst, second, third]) {
						pushAtRadius(beachPositions, point, radius);
					}
					beachTriangleCount += 1;
				}
			}
			const inner = clipTriangleByPredicate(
				[a, b, c],
				(point) => hasInteriorLand(point, owner),
			);
			const first = inner.points[0];
			if (first !== undefined) {
				for (
					let pointIndex = 1;
					pointIndex + 1 < inner.points.length;
					pointIndex += 1
				) {
					const second = inner.points[pointIndex];
					const third = inner.points[pointIndex + 1];
					if (second === undefined || third === undefined) {
						continue;
					}
					for (const point of [first, second, third]) {
						pushAtRadius(
							landPositions,
							point,
							radius + LAND_SURFACE_OFFSET,
						);
						colorIndices.push(colorIndex);
						shades.push(surfaceShade(point, seed, owner));
					}
					triangleCount += 1;
				}
			}
			for (
				let intersectionIndex = 0;
				intersectionIndex + 1 <
				outer.coastIntersections.length;
				intersectionIndex += 2
			) {
				const start =
					outer.coastIntersections[intersectionIndex];
				const end =
					outer.coastIntersections[intersectionIndex + 1];
				if (start === undefined || end === undefined) {
					continue;
				}
				const continentCenter =
					geography.continents[owner]?.center ??
					[start.x, start.y, start.z] as Vec3;
				appendDetailedCoastSegment(
					coastPositions,
					[start.x, start.y, start.z],
					[end.x, end.y, end.z],
					continentCenter,
					seed,
					owner,
					radius + COAST_SURFACE_OFFSET,
				);
			}
		}
	}

	// A few small, deterministic shelf islands make the generated geography
	// read like an atlas without changing graph ownership or node positions.
	for (
		let continentIndex = 0;
		continentIndex < geography.continents.length;
		continentIndex += 1
	) {
		const continent = geography.continents[continentIndex];
		const profile = model.coastProfiles?.[continentIndex];
		if (continent === undefined || profile === undefined) {
			continue;
		}
		const shelfSeed = hashNumbers(seed, continentIndex, 0xa7c41);
		const shelfCount = 1 + (shelfSeed % 2);
		for (let shelfIndex = 0; shelfIndex < shelfCount; shelfIndex += 1) {
			const phase =
				((hashNumbers(shelfSeed, shelfIndex) % 10_000) / 10_000) *
				Math.PI *
				2;
			const tangent = normalizeVec3(
				addVec3(
					scaleVec3(profile.tangentX, Math.cos(phase)),
					scaleVec3(profile.tangentY, Math.sin(phase)),
				),
			);
			const shelfCenter = exponentialMap(
				continent.center,
				scaleVec3(
					tangent,
					continent.capRadius *
						(1.12 + shelfIndex * 0.075),
				),
			);
			if (
				classifyContinentOwner(shelfCenter, continentModel) !==
					SEA_OWNER
			) {
				continue;
			}
			const patchSeed = hashNumbers(shelfSeed, shelfIndex, 0x151a);
			const patchTriangleCount = appendIslandPatch(
				landPositions,
				colorIndices,
				shades,
				beachPositions,
				coastPositions,
				shelfCenter,
				0.018 +
					(hashNumbers(patchSeed, 0x51) % 1000) / 1000 * 0.018,
				continent.colorIndex,
				patchSeed,
				radius,
			);
			triangleCount += patchTriangleCount;
			beachTriangleCount += patchTriangleCount;
		}
	}

	for (
		let islandIndex = 0;
		islandIndex < renderedIslandNodeIndices.length;
		islandIndex += 1
	) {
		const nodeIndex = renderedIslandNodeIndices[islandIndex];
		if (nodeIndex === undefined) {
			continue;
		}
		const center = normalizeVec3(readVec3(model.positions, nodeIndex));
		const islandSeed = hashNumbers(seed, nodeIndex, 0x151a);
		const islandRadius = renderedIslandRadius(
			positions.length / 3,
			nodeIndex,
			seed,
		);
		const colorIndex = islandColorIndex(
			center,
			geography,
			nodeIndex,
			seed,
		);
		const patchTriangleCount = appendIslandPatch(
			landPositions,
			colorIndices,
			shades,
			beachPositions,
			coastPositions,
			center,
			islandRadius,
			colorIndex,
			islandSeed,
			radius,
		);
		triangleCount += patchTriangleCount;
		beachTriangleCount += patchTriangleCount;
	}
	source.dispose();
	if (source !== rawGeometry) {
		rawGeometry.dispose();
	}
	return {
		positions: new Float32Array(landPositions),
		colorIndices: new Uint8Array(colorIndices),
		shades: new Float32Array(shades),
		beachPositions: new Float32Array(beachPositions),
		coastPositions: new Float32Array(coastPositions),
		triangleCount,
		beachTriangleCount,
		renderedIslandCount: renderedIslandNodeIndices.length,
	};
}
