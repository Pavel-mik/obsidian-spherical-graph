import { describe, expect, it } from 'vitest';

import type { GraphData } from '../../src/graph/graphTypes';
import type { PersistedLayoutSnapshot } from '../../src/persistence/layoutState';
import { createRenderGraphSnapshot } from '../../src/integration/renderSnapshot';

function graph(): GraphData {
	return {
		nodes: [
			{
				index: 0,
				id: 'A.md',
				path: 'A.md',
				basename: 'A',
				degree: 1,
				weightedDegree: 1,
				tags: ['#alpha', '#shared'],
				exists: true,
			},
			{
				index: 1,
				id: 'B.md',
				path: 'B.md',
				basename: 'B',
				degree: 2,
				weightedDegree: 2,
				tags: ['#beta', '#shared'],
				exists: true,
			},
			{
				index: 2,
				id: 'New.md',
				path: 'New.md',
				basename: 'New',
				degree: 1,
				weightedDegree: 1,
				tags: ['#pending'],
				exists: true,
			},
		],
		edges: [
			{
				source: 0,
				target: 1,
				weight: 1,
				forwardWeight: 1,
				backwardWeight: 0,
			},
			{
				source: 1,
				target: 2,
				weight: 1,
				forwardWeight: 1,
				backwardWeight: 0,
			},
		],
		signature: 'current-signature',
		filterSignature: 'filters',
		descriptor: {
			nodeIds: ['A.md', 'B.md', 'New.md'],
			edges: [],
			filterSignature: 'filters',
		},
	};
}

function snapshot(): PersistedLayoutSnapshot {
	return {
		snapshotId: 'layout-1',
		schemaVersion: 2,
		algorithmVersion: 1,
		graphSignature: 'old-signature',
		modeThatCreatedIt: 'initialize',
		effectiveSeed: 42,
		renewGeneration: 0,
		completedAt: 1,
		positionsByPath: {
			'A.md': [1, 0, 0],
			'B.md': [0, 1, 0],
			'Deleted.md': [0, 0, 1],
		},
		graphDescriptor: {
			nodeIds: ['A.md', 'B.md', 'Deleted.md'],
			edges: [],
			filterSignature: 'filters',
		},
	};
}

describe('createRenderGraphSnapshot', () => {
	it('keeps committed nodes fixed and omits pending and deleted nodes', () => {
		const result = createRenderGraphSnapshot(snapshot(), graph());

		expect(result.snapshotId).toMatch(
			/^layout-1:current-signature:[a-f0-9]+$/u,
		);
		expect(result.nodes.map((node) => node.id)).toEqual(['A.md', 'B.md']);
		expect([...result.positions]).toEqual([1, 0, 0, 0, 1, 0]);
		expect(result.edges).toEqual([{ source: 0, target: 1, weight: 1 }]);
		expect(result.tags).toEqual([
			{ id: '#alpha', label: '#alpha', nodeIndices: [0] },
			{ id: '#beta', label: '#beta', nodeIndices: [1] },
			{ id: '#shared', label: '#shared', nodeIndices: [0, 1] },
		]);
	});

	it('returns a valid empty render snapshot when no current node is committed', () => {
		const current = graph();
		const empty = createRenderGraphSnapshot(
			{
				...snapshot(),
				positionsByPath: { 'Deleted.md': [0, 0, 1] },
			},
			current,
		);

		expect(empty.nodes).toHaveLength(0);
		expect(empty.edges).toHaveLength(0);
		expect(empty.positions).toHaveLength(0);
	});

	it('keeps a reliable rename at its previous committed coordinate', () => {
		const current = graph();
		const renamedGraph: GraphData = {
			...current,
			nodes: current.nodes.map((node) =>
				node.path === 'A.md'
					? {
							...node,
							id: 'Renamed.md',
							path: 'Renamed.md',
							basename: 'Renamed',
						}
					: node,
			),
		};
		const result = createRenderGraphSnapshot(
			snapshot(),
			renamedGraph,
			[{ oldPath: 'A.md', newPath: 'Renamed.md' }],
		);

		expect(result.nodes[0]?.id).toBe('Renamed.md');
		expect([...result.positions.slice(0, 3)]).toEqual([1, 0, 0]);
	});

	it('derives auxiliary positions from committed notes without layout data', () => {
		const current = graph();
		const withAttachment: GraphData = {
			...current,
			auxiliaryNodes: [
				{
					id: 'map.png',
					path: 'map.png',
					basename: 'map',
					kind: 'attachment',
					degree: 1,
					weightedDegree: 2,
				},
			],
			auxiliaryEdges: [
				{
					sourceId: 'A.md',
					targetId: 'map.png',
					weight: 2,
				},
			],
		};
		const result = createRenderGraphSnapshot(
			snapshot(),
			withAttachment,
		);
		const attachment = result.nodes.find(
			(node) => node.id === 'map.png',
		);

		expect(attachment).toMatchObject({
			kind: 'attachment',
			isOrphan: false,
		});
		expect(result.positions).toHaveLength(9);
		expect(result.positions[6]).toBeGreaterThan(0.99);
		expect(result.edges).toContainEqual({
			source: 0,
			target: 2,
			weight: 2,
		});
	});
});
