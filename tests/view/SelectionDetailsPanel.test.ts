import { describe, expect, it } from 'vitest';
import { prepareRenderSnapshot } from '../../src/render/renderTypes';
import { buildSelectionDetailsModel } from '../../src/view/SelectionDetailsPanel';

const snapshot = prepareRenderSnapshot({
	snapshotId: 'snapshot',
	nodes: [
		{
			index: 0,
			id: 'Alpha.md',
			path: 'Alpha.md',
			basename: 'Alpha',
			degree: 2,
			weightedDegree: 2,
		},
		{
			index: 1,
			id: 'Zulu.md',
			path: 'Zulu.md',
			basename: 'Zulu',
			degree: 1,
			weightedDegree: 1,
		},
		{
			index: 2,
			id: 'Beta.md',
			path: 'Beta.md',
			basename: 'Beta',
			degree: 1,
			weightedDegree: 1,
		},
	],
	edges: [
		{ source: 0, target: 1, weight: 1 },
		{ source: 0, target: 2, weight: 1 },
	],
	tags: [
		{
			id: '#atlas',
			label: '#atlas',
			nodeIndices: [0],
		},
		{
			id: '#project',
			label: '#project',
			nodeIndices: [1, 0],
		},
	],
	positions: new Float32Array([
		1, 0, 0,
		0, 1, 0,
		0, 0, 1,
	]),
});

describe('buildSelectionDetailsModel', () => {
	it('lists every direct connection in a stable name order', () => {
		const model = buildSelectionDetailsModel(
			snapshot,
			'Alpha.md',
			undefined,
		);
		expect(model.selected?.node.basename).toBe('Alpha');
		expect(
			model.selected?.connections.map((node) => node.basename),
		).toEqual(['Beta', 'Zulu']);
		expect(model.selected?.tags.map((tag) => tag.label)).toEqual([
			'#atlas',
			'#project',
		]);
	});

	it('exposes route endpoints and all nodes in the shortest-path union', () => {
		const model = buildSelectionDetailsModel(snapshot, undefined, {
			kind: 'complete',
			distance: 1,
			route: {
				startNodeId: 'Alpha.md',
				endNodeId: 'Zulu.md',
				nodeIds: ['Alpha.md', 'Zulu.md'],
				edges: [{ source: 0, target: 1 }],
			},
		});
		expect(model.route).toMatchObject({
			kind: 'complete',
			distance: 1,
		});
		expect(model.route?.start.basename).toBe('Alpha');
		expect(model.route?.end?.basename).toBe('Zulu');
		expect(model.route?.nodes.map((node) => node.id)).toEqual([
			'Alpha.md',
			'Zulu.md',
		]);
	});

	it('lists every note for the selected tag in a stable name order', () => {
		const model = buildSelectionDetailsModel(
			snapshot,
			undefined,
			undefined,
			'#project',
		);

		expect(model.tag?.tag.label).toBe('#project');
		expect(model.tag?.nodes.map((node) => node.basename)).toEqual([
			'Alpha',
			'Zulu',
		]);
	});
});
