import {
	CircleGeometry,
	Color,
	Group,
	InstancedMesh,
	LineSegments,
	ShaderMaterial,
	Vector3,
} from 'three';
import { describe, expect, it } from 'vitest';

import { NodeLayer } from '../../src/render/NodeLayer';
import {
	prepareRenderSnapshot,
	type RenderTheme,
} from '../../src/render/renderTypes';
import { DEFAULT_SETTINGS } from '../../src/settings/settings';

const theme: RenderTheme = {
	background: '#101319',
	node: '#39d7ff',
	nodeAttachment: '#ffb547',
	nodeUnresolved: '#70818d',
	nodeNeighbor: '#9beeff',
	nodeDirectoryPeer: '#82b7ad',
	nodeActive: '#f3a712',
	nodeHovered: '#ffe066',
	nodeSelected: '#8d6bff',
	nodeRoute: '#c8ff3d',
	nodeRouteStart: '#c8ff3d',
	nodeRouteEnd: '#ffb547',
	edge: '#2496b5',
	edgeSelected: '#a690ff',
	edgeRoute: '#c8ff3d',
	graticule: '#284650',
	tag: '#9d7bff',
	tagSoft: '#ded7ff',
	tagEdge: '#7364c7',
	sphere: '#252a34',
	coast: '#d4b572',
	land: ['#66725a', '#a07a49'],
};

describe('NodeLayer instance colors', () => {
	it('uses smooth tangent discs with a view-angle contrast shader', () => {
		const group = new Group();
		const layer = new NodeLayer(
			group,
			DEFAULT_SETTINGS.appearance,
			theme,
		);
		layer.setSnapshot(
			prepareRenderSnapshot({
				snapshotId: 'snapshot',
				nodes: [
					{
						index: 0,
						id: 'A.md',
						path: 'A.md',
						basename: 'A',
						degree: 1,
						weightedDegree: 1,
					},
				],
				edges: [],
				positions: new Float32Array([1, 0, 0]),
			}),
		);

		const mesh = layer.mesh;
		expect(mesh).toBeDefined();
		expect(mesh?.geometry).toBeInstanceOf(CircleGeometry);
		expect(mesh?.material).toBeInstanceOf(ShaderMaterial);
		expect(
			(mesh?.material as ShaderMaterial).fragmentShader,
		).toContain('limbContrast');
		expect(mesh?.geometry.getAttribute('color')).toBeUndefined();
		expect(mesh?.instanceColor).not.toBeNull();
		expect(
			[...(mesh?.instanceColor?.array ?? [])].some(
				(component) => component > 0,
			),
		).toBe(true);

		layer.dispose();
	});

	it('anchors the selection reticle to the selected node in the 3D layer', () => {
		const group = new Group();
		const layer = new NodeLayer(
			group,
			DEFAULT_SETTINGS.appearance,
			theme,
		);
		layer.setSnapshot(
			prepareRenderSnapshot({
				snapshotId: 'snapshot',
				nodes: [
					{
						index: 0,
						id: 'A.md',
						path: 'A.md',
						basename: 'A',
						degree: 1,
						weightedDegree: 1,
					},
				],
				edges: [],
				positions: new Float32Array([1, 0, 0]),
			}),
		);

		layer.updateSelection({ selectedNodeId: 'A.md' });
		const reticle = group.getObjectByName(
			'spherical-graph-node-reticle',
		);
		const nodeDirection = layer
			.positionForNode('A.md', new Vector3())
			?.normalize();
		if (nodeDirection === undefined) {
			throw new Error('The selected node position was not available.');
		}

		expect(reticle).toBeInstanceOf(LineSegments);
		expect(reticle?.visible).toBe(true);
		expect(reticle?.position.clone().normalize().distanceTo(nodeDirection))
			.toBeLessThan(1e-8);

		layer.updateSelection({});
		expect(reticle?.visible).toBe(false);
		layer.dispose();
	});

	it('scales both the node marker and selection reticle with Globe size', () => {
		const group = new Group();
		const layer = new NodeLayer(
			group,
			DEFAULT_SETTINGS.appearance,
			theme,
		);
		layer.setSnapshot(
			prepareRenderSnapshot({
				snapshotId: 'snapshot',
				nodes: [
					{
						index: 0,
						id: 'A.md',
						path: 'A.md',
						basename: 'A',
						degree: 1,
						weightedDegree: 1,
					},
				],
				edges: [],
				positions: new Float32Array([1, 0, 0]),
			}),
		);
		layer.updateSelection({ selectedNodeId: 'A.md' });
		const reticle = group.getObjectByName(
			'spherical-graph-node-reticle',
		);
		const initialReticleScale = reticle?.scale.x ?? 0;

		layer.updateAppearance({
			...DEFAULT_SETTINGS.appearance,
			globeSize: DEFAULT_SETTINGS.appearance.globeSize * 2,
		});

		expect(reticle?.scale.x).toBeCloseTo(initialReticleScale / 2, 8);
		layer.dispose();
	});

	it('uses separate start and destination colors with double endpoint rings', () => {
		const group = new Group();
		const layer = new NodeLayer(
			group,
			DEFAULT_SETTINGS.appearance,
			theme,
		);
		layer.setSnapshot(
			prepareRenderSnapshot({
				snapshotId: 'snapshot',
				nodes: [
					{
						index: 0,
						id: 'A',
						path: 'A.md',
						basename: 'A',
						degree: 1,
						weightedDegree: 1,
					},
					{
						index: 1,
						id: 'B',
						path: 'B.md',
						basename: 'B',
						degree: 1,
						weightedDegree: 1,
					},
				],
				edges: [{ source: 0, target: 1, weight: 1 }],
				positions: new Float32Array([1, 0, 0, 0, 1, 0]),
			}),
		);
		layer.updateRoute({
			startNodeId: 'A',
			endNodeId: 'B',
			nodeIds: ['A', 'B'],
			edges: [{ source: 0, target: 1 }],
		});

		const startColor = new Color();
		const endColor = new Color();
		layer.mesh?.getColorAt(0, startColor);
		layer.mesh?.getColorAt(1, endColor);
		expect(startColor.getHexString()).toBe('c8ff3d');
		expect(endColor.getHexString()).toBe('ffb547');
		const highlights = group.getObjectByName(
			'spherical-graph-node-highlights',
		);
		expect(highlights).toBeInstanceOf(InstancedMesh);
		expect((highlights as InstancedMesh).count).toBe(4);
		layer.dispose();
	});

	it('hides auxiliary node instances without changing their stored position', () => {
		const group = new Group();
		const layer = new NodeLayer(
			group,
			DEFAULT_SETTINGS.appearance,
			theme,
		);
		layer.setSnapshot(
			prepareRenderSnapshot({
				snapshotId: 'filters',
				nodes: [
					{
						index: 0,
						id: 'A.md',
						path: 'A.md',
						basename: 'A',
						degree: 1,
						weightedDegree: 1,
						kind: 'note',
					},
					{
						index: 1,
						id: 'map.png',
						path: 'map.png',
						basename: 'map',
						degree: 1,
						weightedDegree: 1,
						kind: 'attachment',
					},
				],
				edges: [{ source: 0, target: 1, weight: 1 }],
				positions: new Float32Array([1, 0, 0, 0, 1, 0]),
			}),
		);

		expect(layer.nodeForInstance(1)).toBeUndefined();
		expect(layer.positionForNode('map.png', new Vector3()))
			.toBeUndefined();
		layer.updateFilters({
			showTags: true,
			showAttachments: true,
			existingFilesOnly: true,
			showOrphans: true,
		});
		expect(layer.nodeForInstance(1)?.id).toBe('map.png');
		expect(
			layer.positionForNode('map.png', new Vector3())?.normalize().y,
		).toBeCloseTo(1, 8);
		layer.dispose();
	});
});
