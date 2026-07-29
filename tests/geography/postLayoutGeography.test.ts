import { describe, expect, it } from 'vitest';
import {
	derivePostLayoutGeography,
} from '../../src/geography/postLayoutGeography';
import {
	normalizeVec3,
	writeVec3,
	type Vec3,
} from '../../src/geometry/vector3';
import type {
	GraphData,
	GraphEdge,
	GraphNode,
} from '../../src/graph/graphTypes';
import { fibonacciSpherePoint } from '../../src/layout/initialization';

function graph(paths: readonly string[], edgePairs: readonly [number, number][]): GraphData {
	const degrees = new Uint32Array(paths.length);
	const edges: GraphEdge[] = edgePairs.map(([source, target]) => {
		degrees[source] = (degrees[source] ?? 0) + 1;
		degrees[target] = (degrees[target] ?? 0) + 1;
		return {
			source,
			target,
			weight: 1,
			forwardWeight: 1,
			backwardWeight: 0,
		};
	});
	const nodes: GraphNode[] = paths.map((path, index) => ({
		index,
		id: path,
		path,
		basename: path.split('/').at(-1) ?? path,
		degree: degrees[index] ?? 0,
		weightedDegree: degrees[index] ?? 0,
		exists: true,
	}));
	return {
		nodes,
		edges,
		signature: paths.join('|'),
		filterSignature: 'filters',
		descriptor: {
			nodeIds: [...paths],
			edges: edges.map((edge) => ({
				sourceId: paths[edge.source] ?? '',
				targetId: paths[edge.target] ?? '',
				weight: 1,
				forwardWeight: 1,
				backwardWeight: 0,
			})),
			filterSignature: 'filters',
		},
	};
}

function positions(count: number): Float32Array {
	const result = new Float32Array(count * 3);
	for (let index = 0; index < count; index += 1) {
		writeVec3(result, index, fibonacciSpherePoint(index, count));
	}
	return result;
}

describe('post-layout directory geography', () => {
	it('creates exactly one continent per non-orphan top-level folder', () => {
		const data = graph(
			[
				'Books/a.md',
				'Books/Fiction/b.md',
				'Research/c.md',
				'Research/Deep/d.md',
			],
			[
				[0, 1],
				[1, 2],
				[2, 3],
			],
		);
		const fixed = positions(data.nodes.length);
		const before = fixed.slice();
		const analysis = derivePostLayoutGeography(data, fixed, 42);

		expect(fixed).toEqual(before);
		expect(analysis.geography.continents.map((value) => value.label)).toEqual(
			['Books', 'Research'],
		);
		expect(analysis.geography.continents[0]?.nodeIds).toEqual([
			'Books/Fiction/b.md',
			'Books/a.md',
		]);
		expect([...analysis.assignmentByNode]).toEqual([0, 0, 1, 1]);
		expect(analysis.geography.islandNodeIds).toEqual([]);
	});

	it('keeps degree-one and degree-two folder notes on their continent', () => {
		const data = graph(
			['Books/a.md', 'Books/b.md', 'Books/c.md'],
			[
				[0, 1],
				[1, 2],
			],
		);
		const analysis = derivePostLayoutGeography(
			data,
			positions(data.nodes.length),
			7,
		);

		expect(analysis.geography.continents).toHaveLength(1);
		expect(analysis.geography.continents[0]?.nodeIds).toHaveLength(3);
		expect(analysis.geography.islandNodeIds).toEqual([]);
		expect([...analysis.assignmentByNode]).toEqual([0, 0, 0]);
	});

	it('renders linked root notes as islands and leaves all orphans over ocean', () => {
		const data = graph(
			[
				'Books/a.md',
				'Books/b.md',
				'Index.md',
				'Orphan.md',
				'Loose/orphan.md',
			],
			[
				[0, 1],
				[0, 2],
			],
		);
		const analysis = derivePostLayoutGeography(
			data,
			positions(data.nodes.length),
			11,
		);

		expect(analysis.geography.continents).toHaveLength(1);
		expect(analysis.geography.continents[0]?.nodeIds).toEqual([
			'Books/a.md',
			'Books/b.md',
		]);
		expect(analysis.geography.islandNodeIds).toEqual(['Index.md']);
		expect([...analysis.assignmentByNode]).toEqual([0, 0, -1, -1, -1]);
	});

	it('does not create land for a folder containing only orphans', () => {
		const data = graph(['Empty/a.md', 'Empty/b.md'], []);
		const analysis = derivePostLayoutGeography(
			data,
			positions(data.nodes.length),
			13,
		);

		expect(analysis.geography.continents).toEqual([]);
		expect(analysis.geography.islandNodeIds).toEqual([]);
		expect([...analysis.density.density].every((value) => value === 0)).toBe(
			true,
		);
	});

	it('is deterministic and preserves identity across a top-level folder rename', () => {
		const firstGraph = graph(
			['Books/a.md', 'Books/Sub/b.md'],
			[[0, 1]],
		);
		const fixed = new Float32Array([
			...normalizeVec3([1, 0.1, 0] as Vec3),
			...normalizeVec3([1, -0.1, 0] as Vec3),
		]);
		const first = derivePostLayoutGeography(firstGraph, fixed, 19);
		const previous = {
			...first.geography,
			continents: first.geography.continents.map((continent) => ({
				...continent,
				id: 'stable-books',
				colorIndex: 5,
			})),
		};
		const renamedGraph = graph(
			['Library/a.md', 'Library/Sub/b.md'],
			[[0, 1]],
		);
		const renamed = derivePostLayoutGeography(
			renamedGraph,
			fixed,
			19,
			previous,
		);
		const repeated = derivePostLayoutGeography(
			renamedGraph,
			fixed,
			19,
			previous,
		);

		expect(renamed.geography).toEqual(repeated.geography);
		expect(renamed.geography.continents[0]?.id).toBe('stable-books');
		expect(renamed.geography.continents[0]?.colorIndex).toBe(5);
		expect(renamed.geography.continents[0]?.label).toBe('Library');
	});

	it('rejects a position buffer that is not the completed layout', () => {
		const data = graph(['Books/a.md', 'Books/b.md'], [[0, 1]]);
		expect(() =>
			derivePostLayoutGeography(data, new Float32Array(3), 42),
		).toThrow(/one vector per note/u);
	});
});
