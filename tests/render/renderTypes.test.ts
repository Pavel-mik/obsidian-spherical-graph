import { describe, expect, it } from 'vitest';
import {
	prepareRenderSnapshot,
	RenderGraphSnapshot,
} from '../../src/render/renderTypes';

function snapshot(): RenderGraphSnapshot {
	return {
		snapshotId: 'snapshot-1',
		nodes: [
			{
				index: 0,
				id: 'a',
				path: 'A.md',
				basename: 'A',
				degree: 1,
				weightedDegree: 1,
			},
			{
				index: 1,
				id: 'b',
				path: 'B.md',
				basename: 'B',
				degree: 1,
				weightedDegree: 1,
			},
		],
		edges: [{ source: 0, target: 1, weight: 1 }],
		tags: [
			{
				id: '#shared',
				label: '#shared',
				nodeIndices: [1, 0, 1],
			},
		],
		geography: {
			continents: [
				{
					id: 'continent-a',
					label: 'Archive',
					nodeIndices: [0],
					center: [1, 0, 0],
					capRadius: 0.5,
					colorIndex: 0,
				},
			],
			islandNodeIndices: [1],
		},
		positions: new Float32Array([1, 0, 0, 0, 1, 0]),
	};
}

describe('prepareRenderSnapshot', () => {
	it('copies committed positions and builds picking/neighbor indexes', () => {
		const source = snapshot();
		const prepared = prepareRenderSnapshot(source);

		expect(prepared.positions).not.toBe(source.positions);
		expect(prepared.nodeById.get('b')?.index).toBe(1);
		expect(prepared.neighborsByIndex.get(0)?.has(1)).toBe(true);
		expect(prepared.tagById.get('#shared')?.nodeIndices).toEqual([0, 1]);
		expect(prepared.tagsByNodeIndex.get(1)?.[0]?.id).toBe('#shared');
		expect(prepared.geography.continents[0]?.label).toBe('Archive');
		expect(prepared.geography.islandNodeIndices).toEqual([1]);

		prepared.positions[0] = 0;
		expect(source.positions[0]).toBe(1);
	});

	it('rejects malformed or non-spherical snapshots before a swap', () => {
		const wrongLength = snapshot();
		wrongLength.positions = new Float32Array([1, 0, 0]);
		expect(() => prepareRenderSnapshot(wrongLength)).toThrow(
			/Position buffer/u,
		);

		const offSphere = snapshot();
		offSphere.positions[0] = 0.5;
		expect(() => prepareRenderSnapshot(offSphere)).toThrow(/unit sphere/u);

		const badEdge = snapshot();
		badEdge.edges = [{ source: 0, target: 9, weight: 1 }];
		expect(() => prepareRenderSnapshot(badEdge)).toThrow(/invalid node/u);

		const badTag = snapshot();
		badTag.tags = [
			{ id: '#bad', label: '#bad', nodeIndices: [9] },
		];
		expect(() => prepareRenderSnapshot(badTag)).toThrow(/Tag #bad/u);

		const overlappingGeography = snapshot();
		overlappingGeography.geography = {
			continents: [
				{
					id: 'overlap',
					label: 'Overlap',
					nodeIndices: [0],
					center: [1, 0, 0],
					capRadius: 0.5,
					colorIndex: 0,
				},
			],
			islandNodeIndices: [0],
		};
		expect(() => prepareRenderSnapshot(overlappingGeography)).toThrow(
			/invalid island/u,
		);
	});
});
