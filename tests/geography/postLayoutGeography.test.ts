import { describe, expect, it } from 'vitest';
import {
	derivePostLayoutGeography,
} from '../../src/geography/postLayoutGeography';
import { oceanComponentCount } from '../../src/geography/sphericalRegions';
import {
	exponentialMap,
	geodesicDistance,
} from '../../src/geometry/sphericalGeometry';
import {
	crossVec3,
	normalizeVec3,
	orthogonalUnitVec3,
	scaleVec3,
	writeVec3,
	type Vec3,
} from '../../src/geometry/vector3';
import type {
	GraphData,
	GraphEdge,
	GraphNode,
} from '../../src/graph/graphTypes';

function graphWithGroups(groupSizes: readonly number[]): GraphData {
	const nodes: GraphNode[] = [];
	const edges: GraphEdge[] = [];
	let start = 0;
	for (let groupIndex = 0; groupIndex < groupSizes.length; groupIndex += 1) {
		const size = groupSizes[groupIndex] ?? 0;
		const folder = groupIndex === 0 ? 'Research' : 'Books';
		for (let offset = 0; offset < size; offset += 1) {
			const index = start + offset;
			nodes.push({
				index,
				id: `${folder}/note-${index}.md`,
				path: `${folder}/note-${index}.md`,
				basename: `note-${index}`,
				degree: Math.max(0, size - 1),
				weightedDegree: Math.max(0, size - 1),
				exists: true,
			});
		}
		for (let left = start; left < start + size; left += 1) {
			for (let right = left + 1; right < start + size; right += 1) {
				edges.push({
					source: left,
					target: right,
					weight: 1,
					forwardWeight: 1,
					backwardWeight: 0,
				});
			}
		}
		start += size;
	}
	return {
		nodes,
		edges,
		signature: `groups-${groupSizes.join('-')}`,
		filterSignature: 'filters',
		descriptor: {
			nodeIds: nodes.map((node) => node.id),
			edges: edges.map((edge) => ({
				sourceId: nodes[edge.source]?.id ?? '',
				targetId: nodes[edge.target]?.id ?? '',
				weight: edge.weight,
				forwardWeight: edge.forwardWeight,
				backwardWeight: edge.backwardWeight,
			})),
			filterSignature: 'filters',
		},
	};
}

function addLooseNodes(graph: GraphData, count: number): GraphData {
	const nodes = [...graph.nodes];
	for (let offset = 0; offset < count; offset += 1) {
		const index = nodes.length;
		nodes.push({
			index,
			id: `Loose/note-${index}.md`,
			path: `Loose/note-${index}.md`,
			basename: `note-${index}`,
			degree: 0,
			weightedDegree: 0,
			exists: true,
		});
	}
	return {
		...graph,
		nodes,
		signature: `${graph.signature}-loose-${count}`,
		descriptor: {
			...graph.descriptor,
			nodeIds: nodes.map((node) => node.id),
		},
	};
}

function withoutEdges(graph: GraphData): GraphData {
	const nodes = graph.nodes.map((node) => ({
		...node,
		degree: 0,
		weightedDegree: 0,
	}));
	return {
		...graph,
		nodes,
		edges: [],
		signature: `${graph.signature}-without-edges`,
		descriptor: {
			...graph.descriptor,
			edges: [],
		},
	};
}

function clusterDirections(
	center: Vec3,
	count: number,
	maximumRadius = 0.14,
): Vec3[] {
	const firstTangent = orthogonalUnitVec3(center, count);
	const secondTangent = normalizeVec3(
		crossVec3(center, firstTangent),
	);
	return Array.from({ length: count }, (_, index) => {
		const phase = index * Math.PI * (3 - Math.sqrt(5));
		const radius =
			0.035 +
			maximumRadius * Math.sqrt((index + 0.5) / count);
		const tangent = normalizeVec3([
			firstTangent[0] * Math.cos(phase) +
				secondTangent[0] * Math.sin(phase),
			firstTangent[1] * Math.cos(phase) +
				secondTangent[1] * Math.sin(phase),
			firstTangent[2] * Math.cos(phase) +
				secondTangent[2] * Math.sin(phase),
		]);
		return exponentialMap(center, scaleVec3(tangent, radius));
	});
}

function packPositions(groups: readonly (readonly Vec3[])[]): Float32Array {
	const positions = new Float32Array(
		groups.reduce((sum, group) => sum + group.length, 0) * 3,
	);
	let index = 0;
	for (const group of groups) {
		for (const point of group) {
			writeVec3(positions, index, point);
			index += 1;
		}
	}
	return positions;
}

function uniformDirections(count: number): Vec3[] {
	const goldenAngle = Math.PI * (3 - Math.sqrt(5));
	return Array.from({ length: count }, (_, index) => {
		const y = 1 - (2 * (index + 0.5)) / count;
		const ring = Math.sqrt(Math.max(0, 1 - y * y));
		const angle = index * goldenAngle;
		return [
			ring * Math.cos(angle),
			y,
			ring * Math.sin(angle),
		];
	});
}

describe('post-layout spherical geography', () => {
	it('derives disjoint continents, connected ocean, and islands without moving positions', () => {
		const graph = addLooseNodes(graphWithGroups([10, 10]), 6);
		const positions = packPositions([
			clusterDirections([1, 0, 0], 10),
			clusterDirections([0, 1, 0], 10),
			[
				[-1, 0, 0],
				[0, -1, 0],
				[0, 0, 1],
				[0, 0, -1],
				normalizeVec3([-1, 1, 0]),
				normalizeVec3([-1, -1, 0]),
			],
		]);
		const before = positions.slice();
		const analysis = derivePostLayoutGeography(
			graph,
			positions,
			42,
			undefined,
			{
				gridSubdivision: 4,
				minimumContinentNodes: 6,
			},
		);

		expect(positions).toEqual(before);
		expect(analysis.geography.continents).toHaveLength(2);
		expect(
			analysis.geography.continents
				.map((continent) => continent.label)
				.sort(),
		).toEqual(['Books', 'Research']);
		expect(analysis.geography.islandNodeIds.length).toBeGreaterThanOrEqual(4);
		expect(
			oceanComponentCount(analysis.grid, analysis.ownerByCell),
		).toBe(1);
		expect(
			analysis.ownerByCell.every(
				(owner) =>
					owner === -1 ||
					(owner >= 0 &&
						owner < analysis.geography.continents.length),
			),
		).toBe(true);
		for (const continent of analysis.geography.continents) {
			expect(Math.hypot(...continent.center)).toBeCloseTo(1, 6);
			expect(continent.capRadius).toBeGreaterThanOrEqual(0.1);
			expect(continent.capRadius).toBeLessThanOrEqual(1.2);
		}
	});

	it('spatially splits one topological prior into distant landmasses', () => {
		const graph = graphWithGroups([16]);
		const positions = packPositions([
			clusterDirections([1, 0, 0], 8),
			clusterDirections([0, 1, 0], 8),
		]);
		const analysis = derivePostLayoutGeography(
			graph,
			positions,
			17,
			undefined,
			{
				gridSubdivision: 4,
				minimumContinentNodes: 6,
			},
		);

		expect(analysis.geography.continents).toHaveLength(2);
		expect(
			analysis.geography.continents.every(
				(continent) => continent.nodeIds.length === 8,
			),
		).toBe(true);
		expect(
			geodesicDistance(
				analysis.geography.continents[0]?.center ?? [1, 0, 0],
				analysis.geography.continents[1]?.center ?? [1, 0, 0],
			),
		).toBeGreaterThan(1);
		expect(
			oceanComponentCount(analysis.grid, analysis.ownerByCell),
		).toBe(1);
	});

	it('merges conflicting graph priors when they form one shallow spatial basin', () => {
		const graph = graphWithGroups([8, 8]);
		const center: Vec3 = [1, 0, 0];
		const firstCenter = exponentialMap(center, [0, 0.18, 0]);
		const secondCenter = exponentialMap(center, [0, -0.18, 0]);
		const positions = packPositions([
			clusterDirections(firstCenter, 8, 0.12),
			clusterDirections(secondCenter, 8, 0.12),
		]);
		const analysis = derivePostLayoutGeography(
			graph,
			positions,
			29,
			undefined,
			{
				gridSubdivision: 4,
				minimumContinentNodes: 6,
			},
		);

		expect(analysis.geography.continents).toHaveLength(1);
		expect(analysis.geography.continents[0]?.nodeIds).toHaveLength(16);
	});

	it('can recognize a spatial continent without any graph-community edges', () => {
		const graph = withoutEdges(graphWithGroups([12]));
		const positions = packPositions([
			clusterDirections([1, 0, 0], 12),
		]);
		const analysis = derivePostLayoutGeography(
			graph,
			positions,
			31,
			undefined,
			{
				gridSubdivision: 4,
				minimumContinentNodes: 6,
			},
		);

		expect(analysis.geography.continents).toHaveLength(1);
		expect(analysis.geography.continents[0]?.nodeIds).toHaveLength(12);
		expect(analysis.geography.islandNodeIds).toEqual([]);
	});

	it('does not let a topological prior turn a uniform globe into one continent', () => {
		const graph = graphWithGroups([16]);
		const positions = packPositions([uniformDirections(16)]);
		const analysis = derivePostLayoutGeography(
			graph,
			positions,
			37,
			undefined,
			{
				gridSubdivision: 3,
				minimumContinentNodes: 6,
			},
		);

		expect(analysis.geography.continents).toEqual([]);
		expect(analysis.geography.islandNodeIds).toHaveLength(16);
		expect(
			oceanComponentCount(analysis.grid, analysis.ownerByCell),
		).toBe(1);
	});

	it('keeps several dense marker regions separate across a loose spherical background', () => {
		const groupSizes = [26, 23, 20, 18, 16] as const;
		const looseCount = 36;
		const graph = addLooseNodes(
			graphWithGroups(groupSizes),
			looseCount,
		);
		const centers: readonly Vec3[] = [
			[1, 0, 0],
			[0, 1, 0],
			[-1, 0, 0],
			[0, -1, 0],
			[0, 0, 1],
		];
		const positions = packPositions([
			...groupSizes.map((size, index) =>
				clusterDirections(
					centers[index] ?? [1, 0, 0],
					size,
					0.34,
				),
			),
			uniformDirections(looseCount),
		]);
		const analysis = derivePostLayoutGeography(
			graph,
			positions,
			83,
			undefined,
			{
				gridSubdivision: 4,
				minimumContinentNodes: 10,
				maximumContinents: 7,
			},
		);

		expect(analysis.geography.continents.length).toBeGreaterThanOrEqual(4);
		expect(
			analysis.geography.continents.every(
				(continent) => continent.nodeIds.length >= 10,
			),
		).toBe(true);
		expect(
			oceanComponentCount(analysis.grid, analysis.ownerByCell),
		).toBe(1);
		expect(
			analysis.geography.continents.reduce(
				(total, continent) => total + continent.nodeIds.length,
				0,
			),
		).toBeGreaterThanOrEqual(80);
		expect(
			analysis.geography.islandNodeIds.length,
		).toBeGreaterThanOrEqual(Math.floor(looseCount * 0.5));
	});

	it('is deterministic and reuses matched persisted identity', () => {
		const graph = graphWithGroups([9, 9]);
		const positions = packPositions([
			clusterDirections([1, 0, 0], 9),
			clusterDirections([0, 1, 0], 9),
		]);
		const first = derivePostLayoutGeography(
			graph,
			positions,
			23,
			undefined,
			{
				gridSubdivision: 3,
				minimumContinentNodes: 6,
			},
		);
		const previous = {
			...first.geography,
			continents: first.geography.continents.map(
				(continent, index) => ({
					...continent,
					id: `stable-${index}`,
					label: `Stable ${index}`,
					colorIndex: 5 - index,
				}),
			),
		};
		const second = derivePostLayoutGeography(
			graph,
			positions,
			23,
			previous,
			{
				gridSubdivision: 3,
				minimumContinentNodes: 6,
			},
		);
		const repeated = derivePostLayoutGeography(
			graph,
			positions,
			23,
			previous,
			{
				gridSubdivision: 3,
				minimumContinentNodes: 6,
			},
		);

		expect(second.geography).toEqual(repeated.geography);
		expect(second.ownerByCell).toEqual(repeated.ownerByCell);
		expect(second.geography.continents.map((continent) => continent.id)).toEqual(
			['stable-0', 'stable-1'],
		);
		expect(
			second.geography.continents.map((continent) => continent.label),
		).toEqual(['Stable 0', 'Stable 1']);
	});

	it('rejects a position buffer that is not the completed layout', () => {
		const graph = graphWithGroups([8]);
		expect(() =>
			derivePostLayoutGeography(
				graph,
				new Float32Array(3),
				42,
			),
		).toThrow(/one vector per note/u);
	});
});
