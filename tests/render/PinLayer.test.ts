import {
	Group,
	InstancedMesh,
	Matrix4,
	Vector3,
} from 'three';
import { describe, expect, it } from 'vitest';
import { PinLayer } from '../../src/render/PinLayer';
import {
	prepareRenderSnapshot,
	type RenderTheme,
} from '../../src/render/renderTypes';
import { DEFAULT_SETTINGS } from '../../src/settings/settings';

const theme: RenderTheme = {
	background: '#07131f',
	node: '#f1e4c4',
	nodeAttachment: '#b9a26c',
	nodeUnresolved: '#7f8d91',
	nodeNeighbor: '#fff2cf',
	nodeDirectoryPeer: '#82b7ad',
	nodeActive: '#7eb5c2',
	nodeHovered: '#ff6b57',
	nodeSelected: '#ff6b57',
	nodeRoute: '#f1bb55',
	nodeRouteStart: '#f1bb55',
	nodeRouteEnd: '#7eb5c2',
	edge: '#8da4ae',
	edgeSelected: '#ff6b57',
	edgeRoute: '#f1bb55',
	graticule: '#516675',
	tag: '#d49a43',
	tagSoft: '#ead2a0',
	tagEdge: '#a77937',
	sphere: '#0c2638',
	coast: '#d4b572',
	land: ['#66725a'],
};

const snapshot = prepareRenderSnapshot({
	snapshotId: 'pins',
	nodes: [
		{
			index: 0,
			id: 'Atlas.md',
			path: 'Atlas.md',
			basename: 'Atlas',
			degree: 0,
			weightedDegree: 0,
			isOrphan: true,
		},
		{
			index: 1,
			id: 'Other.md',
			path: 'Other.md',
			basename: 'Other',
			degree: 1,
			weightedDegree: 1,
		},
	],
	edges: [],
	positions: new Float32Array([1, 0, 0, 0, 1, 0]),
});

describe('PinLayer', () => {
	it('anchors a physical shaft and head outside each pinned city', () => {
		const group = new Group();
		const layer = new PinLayer(
			group,
			DEFAULT_SETTINGS.appearance,
			theme,
		);
		layer.setSnapshot(snapshot);
		layer.setPinnedNodeIds(['Atlas.md']);

		const shafts = group.getObjectByName(
			'spherical-graph-pin-shafts',
		) as InstancedMesh;
		const heads = group.getObjectByName(
			'spherical-graph-pin-heads',
		) as InstancedMesh;
		const shaftMatrix = new Matrix4();
		const headMatrix = new Matrix4();
		const shaftPosition = new Vector3();
		const headPosition = new Vector3();
		shafts.getMatrixAt(0, shaftMatrix);
		heads.getMatrixAt(0, headMatrix);
		shaftPosition.setFromMatrixPosition(shaftMatrix);
		headPosition.setFromMatrixPosition(headMatrix);

		expect(shafts.count).toBe(1);
		expect(heads.count).toBe(1);
		expect(shaftPosition.clone().normalize().distanceTo(new Vector3(1, 0, 0)))
			.toBeLessThan(1e-8);
		expect(headPosition.length()).toBeGreaterThan(shaftPosition.length());
		expect(headPosition.length()).toBeGreaterThan(10);
		layer.dispose();
	});

	it('hides a pinned orphan with the existing render filter', () => {
		const group = new Group();
		const layer = new PinLayer(
			group,
			DEFAULT_SETTINGS.appearance,
			theme,
		);
		layer.setSnapshot(snapshot);
		layer.setPinnedNodeIds(['Atlas.md', 'Other.md']);
		layer.updateFilters({
			showTags: true,
			showAttachments: false,
			existingFilesOnly: true,
			showOrphans: false,
		});

		expect(
			(group.getObjectByName(
				'spherical-graph-pin-heads',
			) as InstancedMesh).count,
		).toBe(1);
		layer.dispose();
	});

	it('scales pin geometry down when Globe size increases', () => {
		const group = new Group();
		const layer = new PinLayer(
			group,
			DEFAULT_SETTINGS.appearance,
			theme,
		);
		layer.setSnapshot(snapshot);
		layer.setPinnedNodeIds(['Other.md']);
		const heads = group.getObjectByName(
			'spherical-graph-pin-heads',
		) as InstancedMesh;
		const initial = new Matrix4();
		heads.getMatrixAt(0, initial);
		const initialScale = new Vector3().setFromMatrixScale(initial).x;

		layer.updateAppearance({
			...DEFAULT_SETTINGS.appearance,
			globeSize: DEFAULT_SETTINGS.appearance.globeSize * 2,
		});
		const updated = new Matrix4();
		heads.getMatrixAt(0, updated);

		expect(new Vector3().setFromMatrixScale(updated).x).toBeCloseTo(
			initialScale / 2,
			8,
		);
		layer.dispose();
	});
});
