import { hashString } from '../geometry/deterministicHash';
import {
	geodesicDistance,
	sphericalWeightedMean,
} from '../geometry/sphericalGeometry';
import { readVec3, type Vec3 } from '../geometry/vector3';
import type { GraphData } from '../graph/graphTypes';
import {
	detectContinentalCommunities,
	type CommunityDetectionOptions,
} from './communityDetection';
import { continentId } from './communityMetrics';
import {
	CONTINENTAL_GEOGRAPHY_VERSION,
	CONTINENT_COLOR_COUNT,
	type PersistedContinent,
	type PersistedContinentalGeography,
} from './geographyTypes';
import {
	buildSphericalWatershed,
	estimateNodeSpacing,
	evaluateAdaptiveDensity,
	type SphericalDensityField,
	type SphericalWatershed,
} from './sphericalDensity';
import {
	buildSphericalRegions,
	type SphericalRegionOptions,
} from './sphericalRegions';
import {
	createIntrinsicSphericalGrid,
	gridSubdivisionForSpacing,
	type IntrinsicSphericalGrid,
} from './sphericalGrid';

export interface PostLayoutGeographyOptions
	extends SphericalRegionOptions {
	readonly gridSubdivision?: number;
	readonly communityDetection?: CommunityDetectionOptions;
}

export interface PostLayoutGeographyAnalysis {
	readonly geography: PersistedContinentalGeography;
	readonly assignmentByNode: Int32Array;
	readonly grid: IntrinsicSphericalGrid;
	readonly density: SphericalDensityField;
	readonly watershed: SphericalWatershed;
	/**
	 * Exclusive analytical ownership of grid vertices. `-1` is connected
	 * ocean. This is intentionally not persisted in schema v1 yet.
	 */
	readonly ownerByCell: Int32Array;
}

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
	nodeIdsByContinent: readonly (readonly string[])[],
	previous: PersistedContinentalGeography | undefined,
): ReadonlyMap<number, PreviousMatch> {
	if (previous === undefined) {
		return new Map();
	}
	const candidates: Array<{
		readonly nextIndex: number;
		readonly previousIndex: number;
		readonly similarity: number;
	}> = [];
	for (
		let nextIndex = 0;
		nextIndex < nodeIdsByContinent.length;
		nextIndex += 1
	) {
		for (
			let previousIndex = 0;
			previousIndex < previous.continents.length;
			previousIndex += 1
		) {
			const similarity = jaccard(
				nodeIdsByContinent[nextIndex] ?? [],
				previous.continents[previousIndex]?.nodeIds ?? [],
			);
			if (similarity >= 0.42) {
				candidates.push({ nextIndex, previousIndex, similarity });
			}
		}
	}
	candidates.sort(
		(left, right) =>
			right.similarity - left.similarity ||
			left.nextIndex - right.nextIndex ||
			left.previousIndex - right.previousIndex,
	);
	const matchedNext = new Set<number>();
	const matchedPrevious = new Set<number>();
	const matches = new Map<number, PreviousMatch>();
	for (const candidate of candidates) {
		if (
			matchedNext.has(candidate.nextIndex) ||
			matchedPrevious.has(candidate.previousIndex)
		) {
			continue;
		}
		const continent = previous.continents[candidate.previousIndex];
		if (continent === undefined) {
			continue;
		}
		matchedNext.add(candidate.nextIndex);
		matchedPrevious.add(candidate.previousIndex);
		matches.set(candidate.nextIndex, {
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
	memberIndices: readonly number[],
	fallbackIndex: number,
): string {
	const folderCounts = new Map<string, number>();
	for (const nodeIndex of memberIndices) {
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
		dominant[1] / Math.max(1, memberIndices.length) >= 0.4
	) {
		return displayName(dominant[0]);
	}
	const representative = [...memberIndices]
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

function regionCenter(
	positions: ArrayLike<number>,
	members: readonly number[],
	fallback: Vec3,
): Vec3 {
	return (
		sphericalWeightedMean(
			members.map((index) => readVec3(positions, index)),
		) ?? fallback
	);
}

function diagnosticCapRadius(
	positions: ArrayLike<number>,
	members: readonly number[],
	center: Vec3,
	spacing: number,
): number {
	let maximumDistance = 0;
	for (const memberIndex of members) {
		maximumDistance = Math.max(
			maximumDistance,
			geodesicDistance(center, readVec3(positions, memberIndex)),
		);
	}
	return Math.min(
		1.2,
		Math.max(0.1, maximumDistance + Math.min(0.12, spacing * 0.55)),
	);
}

function freezeGeography(
	continents: readonly PersistedContinent[],
	islandNodeIds: readonly string[],
): PersistedContinentalGeography {
	return Object.freeze({
		version: CONTINENTAL_GEOGRAPHY_VERSION,
		continents: Object.freeze(
			continents.map((continent) =>
				Object.freeze({
					...continent,
					nodeIds: Object.freeze([...continent.nodeIds]),
					center: Object.freeze([
						continent.center[0],
						continent.center[1],
						continent.center[2],
					] as Vec3),
				}),
			),
		),
		islandNodeIds: Object.freeze([...islandNodeIds].sort()),
	});
}

/**
 * Derives cartographic geography only after the fixed layout has completed.
 * Graph communities are marker priors; they never choose or mutate positions.
 */
export function derivePostLayoutGeography(
	graph: GraphData,
	positions: ArrayLike<number>,
	seed: number,
	previous?: PersistedContinentalGeography,
	options: PostLayoutGeographyOptions = {},
): PostLayoutGeographyAnalysis {
	if (positions.length !== graph.nodes.length * 3) {
		throw new RangeError('Geography positions must contain one vector per note.');
	}
	if (graph.nodes.length === 0) {
		const grid = createIntrinsicSphericalGrid(
			options.gridSubdivision ?? 2,
		);
		const density = evaluateAdaptiveDensity(grid, positions);
		const watershed = buildSphericalWatershed(grid, density, {
			minimumBasinNodes: options.minimumContinentNodes ?? 6,
		});
		return {
			geography: freezeGeography([], []),
			assignmentByNode: new Int32Array(),
			grid,
			density,
			watershed,
			ownerByCell: new Int32Array(grid.vertices.length).fill(-1),
		};
	}
	const spacing = estimateNodeSpacing(positions).characteristicSpacing;
	const subdivision =
		options.gridSubdivision ?? gridSubdivisionForSpacing(spacing);
	const grid = createIntrinsicSphericalGrid(subdivision);
	const detection = detectContinentalCommunities(
		graph,
		seed,
		options.communityDetection,
	);
	const density = evaluateAdaptiveDensity(grid, positions);
	const minimumBasinNodes =
		options.minimumContinentNodes ??
		Math.max(
			6,
			Math.min(22, Math.ceil(Math.sqrt(graph.nodes.length) * 0.58)),
		);
	const watershed = buildSphericalWatershed(grid, density, {
		priorByNode: detection.assignmentByNode,
		minimumBasinNodes,
	});
	const regionResult = buildSphericalRegions(
		graph,
		detection,
		grid,
		density,
		watershed,
		options,
	);
	const nodeIdsByContinent = regionResult.regions.map((region) =>
		region.memberIndices
			.map((index) => graph.nodes[index]?.id)
			.filter((id): id is string => id !== undefined)
			.sort(),
	);
	const previousMatches = matchPreviousContinents(
		nodeIdsByContinent,
		previous,
	);
	const usedColors = new Set<number>();
	const continents = regionResult.regions.map((region, index) => {
		const nodeIds = nodeIdsByContinent[index] ?? [];
		const previousMatch = previousMatches.get(index)?.continent;
		let colorIndex =
			previousMatch?.colorIndex ??
			hashString(continentId(nodeIds), seed) % CONTINENT_COLOR_COUNT;
		for (let attempt = 0; attempt < CONTINENT_COLOR_COUNT; attempt += 1) {
			if (!usedColors.has(colorIndex)) {
				break;
			}
			colorIndex = (colorIndex + 1) % CONTINENT_COLOR_COUNT;
		}
		usedColors.add(colorIndex);
		const fallback =
			grid.vertices[region.basin] ?? ([1, 0, 0] as const);
		const center = regionCenter(
			positions,
			region.memberIndices,
			fallback,
		);
		return {
			id: previousMatch?.id ?? continentId(nodeIds),
			label:
				previousMatch?.label ??
				continentLabel(graph, region.memberIndices, index),
			nodeIds,
			center,
			capRadius: diagnosticCapRadius(
				positions,
				region.memberIndices,
				center,
				density.characteristicSpacing,
			),
			colorIndex,
			stability: region.stability,
			conductance: region.conductance,
		} satisfies PersistedContinent;
	});
	const islandNodeIds: string[] = [];
	for (let nodeIndex = 0; nodeIndex < graph.nodes.length; nodeIndex += 1) {
		if ((regionResult.assignmentByNode[nodeIndex] ?? -1) < 0) {
			const nodeId = graph.nodes[nodeIndex]?.id;
			if (nodeId !== undefined) {
				islandNodeIds.push(nodeId);
			}
		}
	}
	return {
		geography: freezeGeography(continents, islandNodeIds),
		assignmentByNode: regionResult.assignmentByNode,
		grid,
		density,
		watershed,
		ownerByCell: regionResult.ownerByCell,
	};
}

export function createPersistedContinentalGeography(
	graph: GraphData,
	positions: ArrayLike<number>,
	seed: number,
	previous?: PersistedContinentalGeography,
): PersistedContinentalGeography {
	return derivePostLayoutGeography(
		graph,
		positions,
		seed,
		previous,
	).geography;
}
