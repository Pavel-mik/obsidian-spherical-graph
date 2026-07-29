import { hashString } from '../geometry/deterministicHash';
import {
	geodesicDistance,
	sphericalWeightedMean,
} from '../geometry/sphericalGeometry';
import { readVec3, type Vec3 } from '../geometry/vector3';
import type { GraphData } from '../graph/graphTypes';
import {
	isContinentalNode,
	isRootIslandNode,
	topLevelFolder,
} from './directorySemantics';
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
	createIntrinsicSphericalGrid,
	gridSubdivisionForSpacing,
	type IntrinsicSphericalGrid,
} from './sphericalGrid';
import type { SphericalRegionOptions } from './sphericalRegions';
import type { CommunityDetectionOptions } from './communityDetection';

export interface PostLayoutGeographyOptions extends SphericalRegionOptions {
	readonly gridSubdivision?: number;
	/** Retained for source compatibility; directory ownership is authoritative. */
	readonly communityDetection?: CommunityDetectionOptions;
}

export interface PostLayoutGeographyAnalysis {
	readonly geography: PersistedContinentalGeography;
	readonly assignmentByNode: Int32Array;
	readonly grid: IntrinsicSphericalGrid;
	readonly density: SphericalDensityField;
	readonly watershed: SphericalWatershed;
	readonly ownerByCell: Int32Array;
}

interface DirectoryGroup {
	readonly folder: string;
	readonly memberIndices: readonly number[];
	readonly nodeIds: readonly string[];
}

interface PreviousMatch {
	readonly continent: PersistedContinent;
	readonly similarity: number;
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

function relativeNodeId(value: string): string {
	const normalized = value.replaceAll('\\', '/');
	const separator = normalized.indexOf('/');
	return separator < 0 ? normalized : normalized.slice(separator + 1);
}

function jaccard(left: readonly string[], right: readonly string[]): number {
	const leftSet = new Set(left);
	let intersection = 0;
	for (const value of right) {
		intersection += leftSet.has(value) ? 1 : 0;
	}
	const union = leftSet.size + new Set(right).size - intersection;
	return union === 0 ? 0 : intersection / union;
}

function membershipSimilarity(
	left: readonly string[],
	right: readonly string[],
): number {
	return Math.max(
		jaccard(left, right),
		jaccard(left.map(relativeNodeId), right.map(relativeNodeId)),
	);
}

function matchPreviousContinents(
	groups: readonly DirectoryGroup[],
	previous: PersistedContinentalGeography | undefined,
): ReadonlyMap<number, PreviousMatch> {
	if (previous === undefined) {
		return new Map();
	}
	const candidates: Array<{
		readonly groupIndex: number;
		readonly previousIndex: number;
		readonly similarity: number;
	}> = [];
	for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
		for (
			let previousIndex = 0;
			previousIndex < previous.continents.length;
			previousIndex += 1
		) {
			const similarity = membershipSimilarity(
				groups[groupIndex]?.nodeIds ?? [],
				previous.continents[previousIndex]?.nodeIds ?? [],
			);
			if (similarity >= 0.42) {
				candidates.push({ groupIndex, previousIndex, similarity });
			}
		}
	}
	candidates.sort(
		(left, right) =>
			right.similarity - left.similarity ||
			left.groupIndex - right.groupIndex ||
			left.previousIndex - right.previousIndex,
	);
	const usedGroups = new Set<number>();
	const usedPrevious = new Set<number>();
	const matches = new Map<number, PreviousMatch>();
	for (const candidate of candidates) {
		if (
			usedGroups.has(candidate.groupIndex) ||
			usedPrevious.has(candidate.previousIndex)
		) {
			continue;
		}
		const continent = previous.continents[candidate.previousIndex];
		if (continent === undefined) {
			continue;
		}
		usedGroups.add(candidate.groupIndex);
		usedPrevious.add(candidate.previousIndex);
		matches.set(candidate.groupIndex, {
			continent,
			similarity: candidate.similarity,
		});
	}
	return matches;
}

function directoryGroups(graph: GraphData): DirectoryGroup[] {
	const indicesByFolder = new Map<string, number[]>();
	for (const node of graph.nodes) {
		if (!isContinentalNode(node)) {
			continue;
		}
		const folder = topLevelFolder(node.path);
		if (folder === undefined) {
			continue;
		}
		const entries = indicesByFolder.get(folder);
		if (entries === undefined) {
			indicesByFolder.set(folder, [node.index]);
		} else {
			entries.push(node.index);
		}
	}
	return [...indicesByFolder.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([folder, memberIndices]) => ({
			folder,
			memberIndices: Object.freeze([...memberIndices].sort((a, b) => a - b)),
			nodeIds: Object.freeze(
				memberIndices
					.map((index) => graph.nodes[index]?.id)
					.filter((id): id is string => id !== undefined)
					.sort(),
			),
		}));
}

function groupCenter(
	positions: ArrayLike<number>,
	members: readonly number[],
): Vec3 {
	return (
		sphericalWeightedMean(
			members.map((index) => readVec3(positions, index)),
		) ?? readVec3(positions, members[0] ?? 0)
	);
}

function diagnosticCapRadius(
	positions: ArrayLike<number>,
	members: readonly number[],
	center: Vec3,
	spacing: number,
): number {
	let maximumDistance = 0;
	for (const member of members) {
		maximumDistance = Math.max(
			maximumDistance,
			geodesicDistance(center, readVec3(positions, member)),
		);
	}
	return Math.min(
		1.55,
		Math.max(0.12, maximumDistance + Math.min(0.14, spacing * 0.6)),
	);
}

function conductance(
	graph: GraphData,
	assignment: Int32Array,
	owner: number,
): number {
	let internal = 0;
	let external = 0;
	for (const edge of graph.edges) {
		const sourceOwner = assignment[edge.source] ?? -1;
		const targetOwner = assignment[edge.target] ?? -1;
		if (sourceOwner === owner && targetOwner === owner) {
			internal += edge.weight;
		} else if (sourceOwner === owner || targetOwner === owner) {
			external += edge.weight;
		}
	}
	return external / Math.max(1, internal * 2 + external);
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
					center: Object.freeze([...continent.center] as [number, number, number]),
				}),
			),
		),
		islandNodeIds: Object.freeze([...islandNodeIds].sort()),
	});
}

/**
 * Converts the fixed S² layout into deterministic directory geography.
 * Top-level folders are authoritative continents, linked root notes are
 * islands, and degree-zero notes never manufacture land.
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
	const groups = directoryGroups(graph);
	const assignmentByNode = new Int32Array(graph.nodes.length);
	assignmentByNode.fill(-1);
	for (let owner = 0; owner < groups.length; owner += 1) {
		for (const nodeIndex of groups[owner]?.memberIndices ?? []) {
			assignmentByNode[nodeIndex] = owner;
		}
	}
	const weights = Float64Array.from(assignmentByNode, (owner) =>
		owner >= 0 ? 1 : 0,
	);
	const spacing =
		graph.nodes.length === 0
			? Math.PI / 2
			: estimateNodeSpacing(positions, 6, weights).characteristicSpacing;
	const subdivision =
		options.gridSubdivision ??
		Math.max(2, Math.min(6, gridSubdivisionForSpacing(spacing)));
	const grid = createIntrinsicSphericalGrid(subdivision);
	const density = evaluateAdaptiveDensity(grid, positions, weights);
	const watershed = buildSphericalWatershed(grid, density, {
		priorByNode: assignmentByNode,
		minimumBasinNodes: 1,
	});
	const previousMatches = matchPreviousContinents(groups, previous);
	const usedColors = new Set<number>();
	const continents = groups.map((group, owner) => {
		const previousMatch = previousMatches.get(owner)?.continent;
		let colorIndex =
			previousMatch?.colorIndex ??
			hashString(`directory:${group.folder}`, seed) % CONTINENT_COLOR_COUNT;
		for (let attempt = 0; attempt < CONTINENT_COLOR_COUNT; attempt += 1) {
			if (!usedColors.has(colorIndex)) {
				break;
			}
			colorIndex = (colorIndex + 1) % CONTINENT_COLOR_COUNT;
		}
		usedColors.add(colorIndex);
		const center = groupCenter(positions, group.memberIndices);
		const boundaryRatio = conductance(graph, assignmentByNode, owner);
		return {
			id:
				previousMatch?.id ??
				`directory-${hashString(group.folder).toString(16).padStart(8, '0')}`,
			label: displayName(group.folder),
			nodeIds: group.nodeIds,
			center,
			capRadius: diagnosticCapRadius(
				positions,
				group.memberIndices,
				center,
				spacing,
			),
			colorIndex,
			stability: 1,
			conductance: boundaryRatio,
		} satisfies PersistedContinent;
	});
	const islandNodeIds = graph.nodes
		.filter(isRootIslandNode)
		.map((node) => node.id)
		.sort();
	return {
		geography: freezeGeography(continents, islandNodeIds),
		assignmentByNode,
		grid,
		density,
		watershed,
		ownerByCell: new Int32Array(grid.vertices.length).fill(-1),
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
