import { describe, expect, it } from 'vitest';
import {
	geodesicDistance,
	sphericalWeightedMean,
} from '../../src/geometry/sphericalGeometry';
import {
	lengthVec3,
	readVec3,
	type Vec3,
} from '../../src/geometry/vector3';
import type {
	GraphData,
	GraphDescriptor,
	GraphEdge,
} from '../../src/graph/graphTypes';
import {
	directoryRegionIndexByNode,
	initializeDirectoryLayout,
} from '../../src/layout/directoryInitialization';

function edge(source: number, target: number, weight = 1): GraphEdge {
	return {
		source,
		target,
		weight,
		forwardWeight: weight,
		backwardWeight: 0,
	};
}

function graph(paths: readonly string[], edges: readonly GraphEdge[]): GraphData {
	const degrees = new Uint32Array(paths.length);
	for (const graphEdge of edges) {
		degrees[graphEdge.source] =
			(degrees[graphEdge.source] ?? 0) + 1;
		degrees[graphEdge.target] =
			(degrees[graphEdge.target] ?? 0) + 1;
	}
	const descriptor: GraphDescriptor = {
		nodeIds: [...paths],
		edges: [],
		filterSignature: 'filter',
	};
	return {
		nodes: paths.map((path, index) => ({
			index,
			id: path,
			path,
			basename: path,
			degree: degrees[index] ?? 0,
			weightedDegree: degrees[index] ?? 0,
			exists: true,
		})),
		edges,
		signature: `signature:${paths.length}:${edges.length}`,
		filterSignature: 'filter',
		descriptor,
	};
}

function expectUnitPositions(positions: Float32Array): void {
	for (let index = 0; index < positions.length / 3; index += 1) {
		expect(lengthVec3(readVec3(positions, index))).toBeCloseTo(1, 6);
	}
}

describe('directory-aware spherical initialization', () => {
	it('classifies top-level folders and subfolder regions without territories', () => {
		const current = graph(
			[
				'Books/History/a.md',
				'Books/History/b.md',
				'Books/Science/c.md',
				'Research/x.md',
				'root.md',
				'Books/orphan.md',
			],
			[
				edge(0, 1),
				edge(1, 2),
				edge(2, 4),
				edge(3, 4),
			],
		);
		const initialized = initializeDirectoryLayout(current, 17);

		expect(initialized.folderIndexByNode).toEqual(
			new Int32Array([0, 0, 0, 1, -1, -1]),
		);
		expect(initialized.regionIndexByNode[0]).toBe(
			initialized.regionIndexByNode[1],
		);
		expect(initialized.regionIndexByNode[2]).not.toBe(
			initialized.regionIndexByNode[0],
		);
		expect(initialized.regionIndexByNode[3]).toBeGreaterThanOrEqual(0);
		expect(initialized.regionIndexByNode[4]).toBe(-1);
		expect(initialized.regionIndexByNode[5]).toBe(-1);
		expect(directoryRegionIndexByNode(current)).toEqual(
			initialized.regionIndexByNode,
		);
		expect('territory' in initialized).toBe(false);
		expectUnitPositions(initialized.positions);
	});

	it('is deterministic for one effective seed and changes for a renew seed', () => {
		const paths = Array.from(
			{ length: 72 },
			(_, index) =>
				`Books/${index % 3 === 0 ? 'History' : 'Science'}/Note-${index}.md`,
		);
		const edges = Array.from(
			{ length: paths.length - 1 },
			(_, index) => edge(index, index + 1),
		);
		const current = graph(paths, edges);
		const first = initializeDirectoryLayout(current, 41);
		const repeated = initializeDirectoryLayout(current, 41);
		const renewed = initializeDirectoryLayout(current, 42);

		expect(first).toEqual(repeated);
		expect(first.positions).not.toEqual(renewed.positions);
		expectUnitPositions(first.positions);
	});

	it('uses graph topology to split a large semantic cohort', () => {
		const componentSize = 48;
		const paths = Array.from(
			{ length: componentSize * 2 },
			(_, index) => `Books/Archive/Note-${index}.md`,
		);
		const edges: GraphEdge[] = [];
		for (let index = 0; index < componentSize - 1; index += 1) {
			edges.push(edge(index, index + 1));
			edges.push(
				edge(
					componentSize + index,
					componentSize + index + 1,
				),
			);
		}
		const initialized = initializeDirectoryLayout(graph(paths, edges), 29);
		const firstRegions = new Set(
			Array.from(
				initialized.regionIndexByNode.slice(0, componentSize),
			),
		);
		const secondRegions = new Set(
			Array.from(
				initialized.regionIndexByNode.slice(componentSize),
			),
		);

		expect(firstRegions.size).toBeGreaterThan(1);
		expect(secondRegions.size).toBeGreaterThan(1);
		for (const region of firstRegions) {
			expect(secondRegions.has(region)).toBe(false);
		}
	});

	it('partitions a large connected folder into bounded linear-space cohorts', () => {
		const nodeCount = 5_000;
		const paths = Array.from(
			{ length: nodeCount },
			(_, index) => `Archive/Series/Note-${index}.md`,
		);
		const edges = Array.from(
			{ length: nodeCount - 1 },
			(_, index) => edge(index, index + 1),
		);
		const regions = directoryRegionIndexByNode(graph(paths, edges));
		const counts = new Map<number, number>();
		for (const region of regions) {
			counts.set(region, (counts.get(region) ?? 0) + 1);
		}

		expect(counts.size).toBe(60);
		expect(Math.max(...counts.values())).toBeLessThanOrEqual(84);
		expect(Math.min(...counts.values())).toBeGreaterThanOrEqual(83);
	});

	it('produces an irregular multi-level cluster instead of a shared radial ring', () => {
		const nodeCount = 144;
		const paths = Array.from(
			{ length: nodeCount },
			(_, index) => `Documents/Notes/Note-${index}.md`,
		);
		const edges = Array.from(
			{ length: nodeCount - 1 },
			(_, index) => edge(index, index + 1),
		);
		const initialized = initializeDirectoryLayout(
			graph(paths, edges),
			73,
		);
		const points = Array.from(
			{ length: nodeCount },
			(_, index) => readVec3(initialized.positions, index),
		);
		const center =
			sphericalWeightedMean(points) ??
			([1, 0, 0] satisfies Vec3);
		const radialBins = new Map<number, number>();
		for (const point of points) {
			const bin = Math.round(
				geodesicDistance(center, point) / 0.035,
			);
			radialBins.set(bin, (radialBins.get(bin) ?? 0) + 1);
		}
		const largestBin = Math.max(...radialBins.values());

		expect(radialBins.size).toBeGreaterThan(10);
		expect(largestBin / nodeCount).toBeLessThan(0.22);
	});

	it('keeps root orphans unassigned on a seeded non-uniform distribution', () => {
		const nodeCount = 40;
		const current = graph(
			Array.from(
				{ length: nodeCount },
				(_, index) => `Orphan-${index}.md`,
			),
			[],
		);
		const first = initializeDirectoryLayout(current, 101);
		const repeated = initializeDirectoryLayout(current, 101);
		const sortedY = Array.from(
			{ length: nodeCount },
			(_, index) => first.positions[index * 3 + 1] ?? 0,
		).sort((left, right) => left - right);
		const gaps = sortedY
			.slice(1)
			.map((value, index) => value - (sortedY[index] ?? value));
		const minimumGap = Math.min(...gaps);
		const maximumGap = Math.max(...gaps);

		expect(first).toEqual(repeated);
		expect(first.folderIndexByNode).toEqual(
			new Int32Array(nodeCount).fill(-1),
		);
		expect(first.regionIndexByNode).toEqual(
			new Int32Array(nodeCount).fill(-1),
		);
		expect(maximumGap - minimumGap).toBeGreaterThan(0.015);
		expectUnitPositions(first.positions);
	});
});
