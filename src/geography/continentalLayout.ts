import {
	deterministicPermutation,
	deriveSeed,
	hashString,
	hashToUnitFloat,
} from '../geometry/deterministicHash';
import {
	exponentialMap,
	geodesicDistance,
	sphericalWeightedMean,
} from '../geometry/sphericalGeometry';
import {
	addVec3,
	crossVec3,
	normalizeVec3,
	orthogonalUnitVec3,
	readVec3,
	scaleVec3,
	tryNormalizeVec3,
	writeVec3,
	type Vec3,
} from '../geometry/vector3';
import type { GraphData } from '../graph/graphTypes';
import {
	fibonacciSpherePoint,
	initializeFullLayout,
} from '../layout/initialization';
import { detectContinentalCommunities } from './communityDetection';
import {
	CONTINENTAL_GEOGRAPHY_VERSION,
	CONTINENT_COLOR_COUNT,
	type ContinentLayoutPlan,
	type DetectedContinent,
	type PersistedContinent,
	type PersistedContinentalGeography,
} from './geographyTypes';

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

interface PreviousMatch {
	readonly continent: PersistedContinent;
	readonly similarity: number;
}

function jaccard(
	left: readonly string[],
	right: readonly string[],
): number {
	const leftSet = new Set(left);
	let intersection = 0;
	for (const value of right) {
		intersection += leftSet.has(value) ? 1 : 0;
	}
	const union = leftSet.size + new Set(right).size - intersection;
	return union === 0 ? 0 : intersection / union;
}

function matchPreviousContinents(
	detected: readonly DetectedContinent[],
	previous: PersistedContinentalGeography | undefined,
): ReadonlyMap<number, PreviousMatch> {
	if (previous === undefined) {
		return new Map();
	}
	const candidates: Array<{
		readonly detectedIndex: number;
		readonly previousIndex: number;
		readonly similarity: number;
	}> = [];
	for (let detectedIndex = 0; detectedIndex < detected.length; detectedIndex += 1) {
		for (
			let previousIndex = 0;
			previousIndex < previous.continents.length;
			previousIndex += 1
		) {
			const similarity = jaccard(
				detected[detectedIndex]?.memberNodeIds ?? [],
				previous.continents[previousIndex]?.nodeIds ?? [],
			);
			if (similarity >= 0.42) {
				candidates.push({
					detectedIndex,
					previousIndex,
					similarity,
				});
			}
		}
	}
	candidates.sort(
		(left, right) =>
			right.similarity - left.similarity ||
			left.detectedIndex - right.detectedIndex ||
			left.previousIndex - right.previousIndex,
	);
	const usedDetected = new Set<number>();
	const usedPrevious = new Set<number>();
	const matches = new Map<number, PreviousMatch>();
	for (const candidate of candidates) {
		if (
			usedDetected.has(candidate.detectedIndex) ||
			usedPrevious.has(candidate.previousIndex)
		) {
			continue;
		}
		const continent = previous.continents[candidate.previousIndex];
		if (continent === undefined) {
			continue;
		}
		usedDetected.add(candidate.detectedIndex);
		usedPrevious.add(candidate.previousIndex);
		matches.set(candidate.detectedIndex, {
			continent,
			similarity: candidate.similarity,
		});
	}
	return matches;
}

function displayName(value: string): string {
	const base = value
		.replace(/[-_]+/gu, ' ')
		.replace(/\s+/gu, ' ')
		.trim();
	return base.length === 0
		? value
		: base.replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase());
}

function continentLabel(
	graph: GraphData,
	detected: DetectedContinent,
	fallbackIndex: number,
): string {
	const folderCounts = new Map<string, number>();
	for (const nodeIndex of detected.memberIndices) {
		const path = graph.nodes[nodeIndex]?.path ?? '';
		const firstSlash = path.indexOf('/');
		if (firstSlash <= 0) {
			continue;
		}
		const folder = path.slice(0, firstSlash);
		folderCounts.set(folder, (folderCounts.get(folder) ?? 0) + 1);
	}
	const dominant = [...folderCounts.entries()].sort(
		(left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
	)[0];
	if (
		dominant !== undefined &&
		dominant[1] / detected.memberIndices.length >= 0.4
	) {
		return displayName(dominant[0]);
	}

	const representative = [...detected.memberIndices]
		.map((index) => graph.nodes[index])
		.filter((node) => node !== undefined)
		.sort(
			(left, right) =>
				right.degree - left.degree ||
				left.path.localeCompare(right.path),
		)[0];
	return representative === undefined
		? `Region ${fallbackIndex + 1}`
		: displayName(representative.basename);
}

function defaultCenters(count: number, seed: number): readonly Vec3[] {
	if (count === 0) {
		return [];
	}
	const permutation = deterministicPermutation(
		count,
		deriveSeed(seed, count, 'continent-centers'),
	);
	const result: Vec3[] = [];
	for (let index = 0; index < count; index += 1) {
		const pointIndex = permutation[index] ?? index;
		result.push(fibonacciSpherePoint(pointIndex, count));
	}
	return result;
}

function capRadius(
	memberCount: number,
	largestMemberCount: number,
): number {
	const relative = Math.sqrt(
		memberCount / Math.max(1, largestMemberCount),
	);
	return Math.min(0.64, Math.max(0.4, 0.42 + relative * 0.16));
}

export function createContinentLayoutPlan(
	graph: GraphData,
	seed: number,
	previous?: PersistedContinentalGeography,
): ContinentLayoutPlan {
	const detection = detectContinentalCommunities(graph, seed);
	const centers = defaultCenters(detection.continents.length, seed);
	const previousMatches = matchPreviousContinents(
		detection.continents,
		previous,
	);
	const largestMemberCount = Math.max(
		1,
		...detection.continents.map(
			(continent) => continent.memberIndices.length,
		),
	);
	const usedColors = new Set<number>();
	const continents = detection.continents.map((detected, index) => {
		const previousMatch = previousMatches.get(index)?.continent;
		let colorIndex =
			previousMatch?.colorIndex ??
			hashString(detected.id, seed) % CONTINENT_COLOR_COUNT;
		for (let attempt = 0; attempt < CONTINENT_COLOR_COUNT; attempt += 1) {
			if (!usedColors.has(colorIndex)) {
				break;
			}
			colorIndex = (colorIndex + 1) % CONTINENT_COLOR_COUNT;
		}
		usedColors.add(colorIndex);
		return {
			id: previousMatch?.id ?? detected.id,
			label:
				previousMatch?.label ??
				continentLabel(graph, detected, index),
			nodeIds: [...detected.memberNodeIds],
			center: previousMatch?.center ?? centers[index] ?? [1, 0, 0],
			capRadius: Math.max(
				previousMatch?.capRadius ?? 0,
				capRadius(
					detected.memberIndices.length,
					largestMemberCount,
				),
			),
			colorIndex,
			stability: detected.stability,
			conductance: detected.conductance,
		} satisfies PersistedContinent;
	});
	const centerBuffer = new Float32Array(continents.length * 3);
	const capRadii = new Float32Array(continents.length);
	for (let index = 0; index < continents.length; index += 1) {
		const continent = continents[index];
		if (continent === undefined) {
			continue;
		}
		writeVec3(centerBuffer, index, continent.center);
		capRadii[index] = continent.capRadius;
	}
	return {
		detection,
		continents,
		assignmentByNode: detection.assignmentByNode.slice(),
		centers: centerBuffer,
		capRadii,
	};
}

function pointInCap(
	center: Vec3,
	capRadiusRadians: number,
	rank: number,
	count: number,
	seed: number,
	nodeIndex: number,
): Vec3 {
	const firstTangent = orthogonalUnitVec3(
		center,
		deriveSeed(seed, nodeIndex, rank),
	);
	const secondTangent = normalizeVec3(crossVec3(center, firstTangent));
	const phase =
		rank * GOLDEN_ANGLE +
		hashToUnitFloat(seed, nodeIndex, 0x7a9) * Math.PI * 2;
	const direction = normalizeVec3(
		addVec3(
			scaleVec3(firstTangent, Math.cos(phase)),
			scaleVec3(secondTangent, Math.sin(phase)),
		),
	);
	const angularRadius =
		capRadiusRadians *
		0.7 *
		Math.sqrt((rank + 0.5) / Math.max(1, count));
	return exponentialMap(center, scaleVec3(direction, angularRadius));
}

function islandCandidate(
	nodeIndex: number,
	nodeCount: number,
	seed: number,
	continents: readonly PersistedContinent[],
	occupiedIslands: readonly Vec3[],
): Vec3 {
	const candidateCount = Math.max(256, Math.min(8192, nodeCount * 4));
	let best = fibonacciSpherePoint(0, candidateCount);
	let bestScore = Number.NEGATIVE_INFINITY;
	const occupiedSample = occupiedIslands.slice(-64);
	for (let sample = 0; sample < 128; sample += 1) {
		const candidateIndex =
			deriveSeed(seed, nodeIndex, sample, 'island') % candidateCount;
		const candidate = fibonacciSpherePoint(candidateIndex, candidateCount);
		let score = Math.PI;
		for (const continent of continents) {
			score = Math.min(
				score,
				geodesicDistance(candidate, continent.center) -
					continent.capRadius -
					0.08,
			);
		}
		for (const occupied of occupiedSample) {
			score = Math.min(
				score,
				geodesicDistance(candidate, occupied) * 0.7,
			);
		}
		if (score > bestScore) {
			bestScore = score;
			best = candidate;
		}
	}
	return best;
}

export function initializeContinentalLayout(
	graph: GraphData,
	plan: ContinentLayoutPlan,
	seed: number,
): Float32Array {
	if (plan.continents.length === 0) {
		return initializeFullLayout(graph.nodes.length, seed);
	}
	const positions = new Float32Array(graph.nodes.length * 3);
	const written = new Uint8Array(graph.nodes.length);
	for (let continentIndex = 0; continentIndex < plan.continents.length; continentIndex += 1) {
		const detected = plan.detection.continents[continentIndex];
		const continent = plan.continents[continentIndex];
		if (detected === undefined || continent === undefined) {
			continue;
		}
		const orderedMembers = [...detected.memberIndices].sort(
			(left, right) =>
				(graph.nodes[right]?.degree ?? 0) -
					(graph.nodes[left]?.degree ?? 0) ||
				(graph.nodes[left]?.path ?? '').localeCompare(
					graph.nodes[right]?.path ?? '',
				),
		);
		for (let rank = 0; rank < orderedMembers.length; rank += 1) {
			const nodeIndex = orderedMembers[rank];
			if (nodeIndex === undefined) {
				continue;
			}
			writeVec3(
				positions,
				nodeIndex,
				pointInCap(
					continent.center,
					continent.capRadius,
					rank,
					orderedMembers.length,
					seed,
					nodeIndex,
				),
			);
			written[nodeIndex] = 1;
		}
	}

	const occupiedIslands: Vec3[] = [];
	for (let nodeIndex = 0; nodeIndex < graph.nodes.length; nodeIndex += 1) {
		if (written[nodeIndex] === 1) {
			continue;
		}
		const position = islandCandidate(
			nodeIndex,
			graph.nodes.length,
			seed,
			plan.continents,
			occupiedIslands,
		);
		writeVec3(positions, nodeIndex, position);
		occupiedIslands.push(position);
	}
	return positions;
}

function meanPosition(
	positions: ArrayLike<number>,
	members: readonly number[],
): Vec3 | null {
	return sphericalWeightedMean(
		members.map((index) => readVec3(positions, index)),
	);
}

export function createPersistedContinentalGeography(
	graph: GraphData,
	positions: ArrayLike<number>,
	seed: number,
	previous?: PersistedContinentalGeography,
): PersistedContinentalGeography {
	if (positions.length !== graph.nodes.length * 3) {
		throw new RangeError('Geography positions must contain one vector per note.');
	}
	const plan = createContinentLayoutPlan(graph, seed, previous);
	const continents = plan.continents.map((continent, index) => {
		const detected = plan.detection.continents[index];
		const mean =
			detected === undefined
				? null
				: meanPosition(positions, detected.memberIndices);
		const blended =
			mean === null
				? continent.center
				: tryNormalizeVec3(
						addVec3(
							scaleVec3(continent.center, previous === undefined ? 0.2 : 0.72),
							scaleVec3(mean, previous === undefined ? 0.8 : 0.28),
						),
					) ?? continent.center;
		let maximumDistance = 0;
		for (const memberIndex of detected?.memberIndices ?? []) {
			maximumDistance = Math.max(
				maximumDistance,
				geodesicDistance(blended, readVec3(positions, memberIndex)),
			);
		}
		return {
			...continent,
			center: blended,
			capRadius: Math.min(
				0.76,
				Math.max(continent.capRadius, maximumDistance + 0.12),
			),
		};
	});
	return Object.freeze({
		version: CONTINENTAL_GEOGRAPHY_VERSION,
		continents: Object.freeze(
			continents.map((continent) => {
				const center: Vec3 = [
					continent.center[0],
					continent.center[1],
					continent.center[2],
				];
				return Object.freeze({
					...continent,
					nodeIds: Object.freeze([...continent.nodeIds]),
					center: Object.freeze(center),
				});
			}),
		),
		islandNodeIds: Object.freeze(
			plan.detection.islandNodeIndices
				.map((index) => graph.nodes[index]?.id)
				.filter((id): id is string => id !== undefined)
				.sort(),
		),
	});
}
