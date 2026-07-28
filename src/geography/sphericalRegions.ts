import type { GraphData } from '../graph/graphTypes';
import { candidateMetrics } from './communityMetrics';
import type {
	CommunityDetectionResult,
	DetectedContinent,
} from './geographyTypes';
import {
	quantile,
	type SphericalDensityField,
	type SphericalWatershed,
} from './sphericalDensity';
import type { IntrinsicSphericalGrid } from './sphericalGrid';

export interface SpatialContinentRegion {
	readonly basin: number;
	readonly memberIndices: readonly number[];
	readonly prior: DetectedContinent | undefined;
	readonly prominence: number;
	readonly stability: number;
	readonly conductance: number;
	readonly score: number;
}

export interface SphericalRegionResult {
	readonly regions: readonly SpatialContinentRegion[];
	readonly ownerByCell: Int32Array;
	readonly assignmentByNode: Int32Array;
}

export interface SphericalRegionOptions {
	readonly minimumContinentNodes?: number;
	readonly maximumContinents?: number;
	readonly minimumProminence?: number;
}

interface CandidateBasin {
	readonly basin: number;
	readonly nodeIndices: readonly number[];
	readonly seedNodeIndices: readonly number[];
	readonly priorIndex: number;
	readonly priorCount: number;
	readonly prominence: number;
	readonly score: number;
}

function automaticMinimum(nodeCount: number): number {
	return Math.max(
		6,
		Math.min(22, Math.ceil(Math.sqrt(nodeCount) * 0.58)),
	);
}

function connectedComponents(
	grid: IntrinsicSphericalGrid,
	mask: (cell: number) => boolean,
): number[][] {
	const seen = new Uint8Array(grid.vertices.length);
	const components: number[][] = [];
	for (let start = 0; start < grid.vertices.length; start += 1) {
		if (seen[start] === 1 || !mask(start)) {
			continue;
		}
		const component: number[] = [];
		const queue = [start];
		seen[start] = 1;
		for (let cursor = 0; cursor < queue.length; cursor += 1) {
			const cell = queue[cursor];
			if (cell === undefined) {
				continue;
			}
			component.push(cell);
			for (const neighbor of grid.neighbors[cell] ?? []) {
				if (seen[neighbor] === 0 && mask(neighbor)) {
					seen[neighbor] = 1;
					queue.push(neighbor);
				}
			}
		}
		components.push(component);
	}
	return components;
}

function dominantPrior(
	nodeIndices: readonly number[],
	detection: CommunityDetectionResult,
): { readonly index: number; readonly count: number } {
	const counts = new Map<number, number>();
	for (const nodeIndex of nodeIndices) {
		const prior = detection.assignmentByNode[nodeIndex] ?? -1;
		if (prior >= 0) {
			counts.set(prior, (counts.get(prior) ?? 0) + 1);
		}
	}
	let index = -1;
	let count = 0;
	for (const [candidate, candidateCount] of counts) {
		if (
			candidateCount > count ||
			(candidateCount === count && candidate < index)
		) {
			index = candidate;
			count = candidateCount;
		}
	}
	return { index, count };
}

function candidateBasins(
	graph: GraphData,
	detection: CommunityDetectionResult,
	grid: IntrinsicSphericalGrid,
	field: SphericalDensityField,
	watershed: SphericalWatershed,
	options: SphericalRegionOptions,
): readonly CandidateBasin[] {
	const nodesByBasin = new Map<number, number[]>();
	const nodeDensities: number[] = [];
	for (let nodeIndex = 0; nodeIndex < graph.nodes.length; nodeIndex += 1) {
		const basin = watershed.basinByNode[nodeIndex] ?? -1;
		if (basin < 0) {
			continue;
		}
		const members = nodesByBasin.get(basin) ?? [];
		members.push(nodeIndex);
		nodesByBasin.set(basin, members);
		const cell = field.nodeCells[nodeIndex] ?? 0;
		nodeDensities.push(field.density[cell] ?? 0);
	}
	const typicalNodeDensity = quantile(nodeDensities, 0.5);
	const minimum =
		options.minimumContinentNodes ?? automaticMinimum(graph.nodes.length);
	const minimumProminence = options.minimumProminence ?? 0.08;
	const candidates: CandidateBasin[] = [];
	for (const [basin, nodeIndices] of nodesByBasin) {
		if (nodeIndices.length < minimum) {
			continue;
		}
		const prior = dominantPrior(nodeIndices, detection);
		const priorContinent =
			prior.index < 0 ? undefined : detection.continents[prior.index];
		const priorCoverage =
			priorContinent === undefined
				? 0
				: prior.count /
					Math.max(1, priorContinent.memberIndices.length);
		const priorPurity = prior.count / nodeIndices.length;
		const densityByNode = new Map(
			nodeIndices.map((nodeIndex) => {
				const cell = field.nodeCells[nodeIndex] ?? 0;
				return [nodeIndex, field.density[cell] ?? 0] as const;
			}),
		);
		const priorMembers =
			prior.index < 0
				? []
				: nodeIndices.filter(
						(nodeIndex) =>
							(detection.assignmentByNode[nodeIndex] ?? -1) ===
							prior.index,
					);
		const priorDensities = priorMembers.map(
			(nodeIndex) => densityByNode.get(nodeIndex) ?? 0,
		);
		const graphSeedThreshold = Math.max(
			(watershed.peakDensityByBasin[basin] ?? 0) * 0.09,
			quantile(priorDensities, 0.12) * 0.7,
		);
		const graphSeeds = priorMembers.filter(
			(nodeIndex) =>
				(densityByNode.get(nodeIndex) ?? 0) >= graphSeedThreshold,
		);
		const spatialSeedThreshold = Math.max(
			(watershed.peakDensityByBasin[basin] ?? 0) * 0.28,
			quantile([...densityByNode.values()], 0.62),
		);
		const spatialSeeds = nodeIndices.filter(
			(nodeIndex) =>
				(densityByNode.get(nodeIndex) ?? 0) >= spatialSeedThreshold,
		);
		const coherenceFor = (members: readonly number[]): number => {
			let meanX = 0;
			let meanY = 0;
			let meanZ = 0;
			for (const nodeIndex of members) {
				const cell = field.nodeCells[nodeIndex] ?? 0;
				const direction = grid.vertices[cell];
				if (direction !== undefined) {
					meanX += direction[0];
					meanY += direction[1];
					meanZ += direction[2];
				}
			}
			return (
				Math.hypot(meanX, meanY, meanZ) /
				Math.max(1, members.length)
			);
		};
		// The full dominant prior must itself be spatially coherent. Measuring
		// only its densest seed subset would let a globe-wide graph community
		// masquerade as a localized continent.
		const graphCoherence = coherenceFor(priorMembers);
		const densityCoherence = coherenceFor(spatialSeeds);
		const basinCoherence = coherenceFor(nodeIndices);
		const peak = watershed.peakDensityByBasin[basin] ?? 0;
		const saddle = watershed.saddleDensityByBasin[basin] ?? 0;
		const prominence =
			peak <= 1e-12 ? 0 : Math.max(0, (peak - saddle) / peak);
		const graphSupported =
			priorContinent !== undefined &&
			prior.count >= Math.max(3, Math.ceil(minimum * 0.35)) &&
			(priorCoverage >= 0.24 || prior.count >= minimum);
		const spatialSupported =
			prominence >= minimumProminence &&
			peak >= typicalNodeDensity * 1.02;
		const graphSpatialSupport =
			graphSupported &&
			graphSeeds.length >=
				Math.max(3, Math.ceil(minimum * 0.4)) &&
			prominence >= minimumProminence * 0.35 &&
			peak >= typicalNodeDensity * 0.92 &&
			graphCoherence >= 0.38 &&
			basinCoherence >= 0.28;
		const coherentSpatialSupport =
			spatialSupported &&
			spatialSeeds.length >=
				Math.max(3, Math.ceil(minimum * 0.4)) &&
			densityCoherence >= 0.32 &&
			basinCoherence >= 0.28;
		if (!graphSpatialSupport && !coherentSpatialSupport) {
			continue;
		}
		const seedNodeIndices = graphSpatialSupport
			? graphSeeds
			: spatialSeeds;
		const spatialCoherence = graphSpatialSupport
			? graphCoherence
			: densityCoherence;
		const sizeSignal = Math.min(
			1,
			seedNodeIndices.length /
				Math.max(minimum, graph.nodes.length * 0.16),
		);
		const score =
			sizeSignal * 0.3 +
			Math.min(1, prominence * 2.5) * 0.28 +
			priorPurity * 0.18 +
			(priorContinent?.stability ?? 0) * 0.14 +
			Math.min(1, priorCoverage) * 0.06 +
			Math.min(1, spatialCoherence) * 0.04;
		candidates.push({
			basin,
			nodeIndices: [...nodeIndices].sort((left, right) => left - right),
			seedNodeIndices: [...seedNodeIndices].sort(
				(left, right) => left - right,
			),
			priorIndex: prior.index,
			priorCount: prior.count,
			prominence,
			score,
		});
	}
	const maximum = options.maximumContinents ?? 7;
	return candidates
		.sort(
			(left, right) =>
				right.score - left.score ||
				right.nodeIndices.length - left.nodeIndices.length ||
				left.basin - right.basin,
		)
		.slice(0, maximum);
}

function buildInitialOwnership(
	grid: IntrinsicSphericalGrid,
	field: SphericalDensityField,
	watershed: SphericalWatershed,
	candidates: readonly CandidateBasin[],
): Int32Array {
	const ownerByCell = new Int32Array(grid.vertices.length);
	ownerByCell.fill(-1);
	const positiveDensity = [...field.density].filter((value) => value > 1e-12);
	const noiseFloor = quantile(positiveDensity, 0.16);
	for (let owner = 0; owner < candidates.length; owner += 1) {
		const candidate = candidates[owner];
		if (candidate === undefined) {
			continue;
		}
		const memberDensities = candidate.seedNodeIndices.map((nodeIndex) => {
			const cell = field.nodeCells[nodeIndex] ?? 0;
			return field.density[cell] ?? 0;
		});
		const peak =
			watershed.peakDensityByBasin[candidate.basin] ?? 0;
		const lowThreshold = Math.max(
			noiseFloor * 0.5,
			peak * 0.12,
			quantile(memberDensities, 0.1) * 0.52,
		);
		const memberCells = new Set(
			candidate.seedNodeIndices.map(
				(nodeIndex) => field.nodeCells[nodeIndex] ?? 0,
			),
		);
		const queue: number[] = [candidate.basin];
		for (const cell of memberCells) {
			queue.push(cell);
		}
		for (let cursor = 0; cursor < queue.length; cursor += 1) {
			const cell = queue[cursor];
			if (
				cell === undefined ||
				ownerByCell[cell] !== -1 ||
				(watershed.basinByCell[cell] ?? -1) !== candidate.basin
			) {
				continue;
			}
			const isNodeSeed = memberCells.has(cell);
			if (!isNodeSeed && (field.density[cell] ?? 0) < lowThreshold) {
				continue;
			}
			ownerByCell[cell] = owner;
			for (const neighbor of grid.neighbors[cell] ?? []) {
				if (ownerByCell[neighbor] === -1) {
					queue.push(neighbor);
				}
			}
		}
	}
	return ownerByCell;
}

function addSeaBetweenOwners(
	grid: IntrinsicSphericalGrid,
	field: SphericalDensityField,
	ownerByCell: Int32Array,
): void {
	const protectedCells = new Uint8Array(grid.vertices.length);
	for (const cell of field.nodeCells) {
		protectedCells[cell] = 1;
	}
	const eroded = ownerByCell.slice();
	for (let cell = 0; cell < ownerByCell.length; cell += 1) {
		const owner = ownerByCell[cell] ?? -1;
		if (owner < 0 || protectedCells[cell] === 1) {
			continue;
		}
		if (
			(grid.neighbors[cell] ?? []).some((neighbor) => {
				const neighborOwner = ownerByCell[neighbor] ?? -1;
				return neighborOwner >= 0 && neighborOwner !== owner;
			})
		) {
			eroded[cell] = -1;
		}
	}
	ownerByCell.set(eroded);
}

function ensureConnectedOcean(
	grid: IntrinsicSphericalGrid,
	ownerByCell: Int32Array,
): void {
	let oceanComponents = connectedComponents(
		grid,
		(cell) => (ownerByCell[cell] ?? -1) < 0,
	);
	if (oceanComponents.length === 0) {
		ownerByCell[0] = -1;
		oceanComponents = [[0]];
	}
	oceanComponents.sort(
		(left, right) =>
			right.length - left.length ||
			(left[0] ?? 0) - (right[0] ?? 0),
	);
	for (const enclosed of oceanComponents.slice(1)) {
		const boundaryCounts = new Map<number, number>();
		for (const cell of enclosed) {
			for (const neighbor of grid.neighbors[cell] ?? []) {
				const owner = ownerByCell[neighbor] ?? -1;
				if (owner >= 0) {
					boundaryCounts.set(
						owner,
						(boundaryCounts.get(owner) ?? 0) + 1,
					);
				}
			}
		}
		const fillOwner = [...boundaryCounts.entries()].sort(
			(left, right) =>
				right[1] - left[1] || left[0] - right[0],
		)[0]?.[0];
		if (fillOwner === undefined) {
			continue;
		}
		for (const cell of enclosed) {
			ownerByCell[cell] = fillOwner;
		}
	}
}

export function oceanComponentCount(
	grid: IntrinsicSphericalGrid,
	ownerByCell: Int32Array,
): number {
	return connectedComponents(
		grid,
		(cell) => (ownerByCell[cell] ?? -1) < 0,
	).length;
}

export function buildSphericalRegions(
	graph: GraphData,
	detection: CommunityDetectionResult,
	grid: IntrinsicSphericalGrid,
	field: SphericalDensityField,
	watershed: SphericalWatershed,
	options: SphericalRegionOptions = {},
): SphericalRegionResult {
	const candidates = candidateBasins(
		graph,
		detection,
		grid,
		field,
		watershed,
		options,
	);
	const ownerByCell = buildInitialOwnership(
		grid,
		field,
		watershed,
		candidates,
	);
	addSeaBetweenOwners(grid, field, ownerByCell);
	ensureConnectedOcean(grid, ownerByCell);

	const assignmentByNode = new Int32Array(graph.nodes.length);
	assignmentByNode.fill(-1);
	const membersByOwner = candidates.map(() => [] as number[]);
	for (let nodeIndex = 0; nodeIndex < graph.nodes.length; nodeIndex += 1) {
		const cell = field.nodeCells[nodeIndex] ?? 0;
		const owner = ownerByCell[cell] ?? -1;
		if (owner >= 0 && owner < candidates.length) {
			assignmentByNode[nodeIndex] = owner;
			membersByOwner[owner]?.push(nodeIndex);
		}
	}
	const regions: SpatialContinentRegion[] = [];
	for (let owner = 0; owner < candidates.length; owner += 1) {
		const candidate = candidates[owner];
		const memberIndices = membersByOwner[owner] ?? [];
		if (candidate === undefined || memberIndices.length === 0) {
			continue;
		}
		const prior =
			candidate.priorIndex < 0
				? undefined
				: detection.continents[candidate.priorIndex];
		const metrics = candidateMetrics(graph, memberIndices, []);
		regions.push({
			basin: candidate.basin,
			memberIndices: Object.freeze([...memberIndices]),
			prior,
			prominence: candidate.prominence,
			stability: Math.min(
				1,
				Math.max(
					candidate.prominence,
					(prior?.stability ?? 0) *
						(candidate.priorCount /
							Math.max(1, memberIndices.length)),
				),
			),
			conductance: metrics.conductance,
			score: candidate.score,
		});
	}
	return {
		regions: Object.freeze(regions),
		ownerByCell,
		assignmentByNode,
	};
}
