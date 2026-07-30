import {
	Color,
	Group,
	InstancedMesh,
	LineSegments,
	Matrix4,
	OctahedronGeometry,
	ShaderMaterial,
	Vector3,
} from 'three';
import { describe, expect, it } from 'vitest';
import {
	BASE_TAG_MARKER_SIZE,
	DEFAULT_TAG_ORBIT_RADIUS,
} from '../../src/constants';
import {
	TagLayer,
	tagMarkerScaleForGlobe,
	tagOrbitRadiusForAppearance,
	tagPerspectiveVisibility,
} from '../../src/render/TagLayer';
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
	edge: '#21e6ff',
	edgeSelected: '#ff4fd8',
	edgeRoute: '#c8ff3d',
	graticule: '#284650',
	tag: '#9d7bff',
	tagSoft: '#ded7ff',
	tagEdge: '#7364c7',
	sphere: '#252a34',
	coast: '#d4b572',
	land: ['#66725a', '#a07a49'],
};

const snapshot = prepareRenderSnapshot({
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
	tags: [
		{ id: '#a', label: '#a', nodeIndices: [0] },
		{ id: '#shared', label: '#shared', nodeIndices: [0, 1] },
	],
	positions: new Float32Array([1, 0, 0, 0, 1, 0]),
});

describe('TagLayer', () => {
	it('batches all satellites on the larger invisible orbit', () => {
		const group = new Group();
		const layer = new TagLayer(
			group,
			DEFAULT_SETTINGS.appearance,
			theme,
		);
		layer.setSnapshot(snapshot);

		const satellites = group.getObjectByName(
			'spherical-graph-tag-satellites',
		);
		expect(satellites).toBeInstanceOf(InstancedMesh);
		expect((satellites as InstancedMesh).count).toBe(2);
		expect((satellites as InstancedMesh).geometry)
			.toBeInstanceOf(OctahedronGeometry);
		expect((satellites as InstancedMesh).material)
			.toBeInstanceOf(ShaderMaterial);
		expect(
			((satellites as InstancedMesh).material as ShaderMaterial)
				.vertexShader,
		).toContain('tagOccludedByGlobe');
		expect(
			((satellites as InstancedMesh).material as ShaderMaterial)
				.fragmentShader,
		).toContain('polishedSilver');
		expect(
			((satellites as InstancedMesh).material as ShaderMaterial)
				.fragmentShader,
		).toContain('vPerspectiveVisibility');
		expect(
			(
				(satellites as InstancedMesh).material as ShaderMaterial
			).uniforms.tagColor?.value as Color,
		).toBeInstanceOf(Color);
		expect(
			(
				(
					(satellites as InstancedMesh)
						.material as ShaderMaterial
				).uniforms.tagColor?.value as Color
			).getHexString(),
		).toBe('d9e2e7');
		expect(
			((satellites as InstancedMesh).material as ShaderMaterial)
				.uniforms.tagViewProtectionEnabled?.value,
		).toBe(0);
		expect(
			tagMarkerScaleForGlobe(
				DEFAULT_SETTINGS.appearance.globeSize,
			),
		).toBeLessThan(BASE_TAG_MARKER_SIZE);

		const matrix = new Matrix4();
		const position = new Vector3();
		(satellites as InstancedMesh).getMatrixAt(0, matrix);
		position.setFromMatrixPosition(matrix);
		expect(position.length()).toBeCloseTo(
			DEFAULT_TAG_ORBIT_RADIUS,
			6,
		);
		const focusPosition = layer.positionForTag('#a', new Vector3());
		expect(focusPosition?.length()).toBeCloseTo(
			DEFAULT_TAG_ORBIT_RADIUS,
			6,
		);
		expect(
			layer.positionForTag('#missing', new Vector3()),
		).toBeUndefined();

		const raisedAppearance = {
			...DEFAULT_SETTINGS.appearance,
			tagOrbitHeightPercent: 50,
			tagViewProtectionEnabled: true,
		};
		layer.updateAppearance(raisedAppearance);
		(satellites as InstancedMesh).getMatrixAt(0, matrix);
		position.setFromMatrixPosition(matrix);
		expect(position.length()).toBeCloseTo(15, 6);
		expect(
			((satellites as InstancedMesh).material as ShaderMaterial)
				.uniforms.tagViewProtectionEnabled?.value,
		).toBe(1);
		expect(tagOrbitRadiusForAppearance(raisedAppearance)).toBe(15);
		layer.dispose();
	});

	it('draws standard-width spiral links only for selected or route nodes', () => {
		const group = new Group();
		const layer = new TagLayer(
			group,
			DEFAULT_SETTINGS.appearance,
			theme,
		);
		layer.setSnapshot(snapshot);
		expect(
			group.getObjectByName('spherical-graph-tag-links'),
		).toBeUndefined();

		layer.updateSelection('A');
		const selectedLinks = group.getObjectByName(
			'spherical-graph-tag-links',
		);
		expect(selectedLinks).toBeInstanceOf(LineSegments);
		const selectedVertexCount = (selectedLinks as LineSegments)
			.geometry.getAttribute('position').count;
		const selectedMaterial = (selectedLinks as LineSegments)
			.material as ShaderMaterial;
		expect(selectedMaterial.fragmentShader).toContain(
			'polishedSilver',
		);
		expect(selectedMaterial.vertexShader).toContain(
			'vPerspectiveVisibility',
		);
		expect(selectedMaterial.vertexShader).toContain(
			'tagLinkOccludedByGlobe',
		);
		expect(selectedMaterial.vertexShader).toContain(
			'? 0.0',
		);
		expect(
			(
				selectedMaterial.uniforms.tagEdgeColor?.value as Color
			).getHexString(),
		).toBe('b7c4cb');

		layer.updateRoute({
			startNodeId: 'A',
			endNodeId: 'B',
			nodeIds: ['A', 'B'],
			edges: [{ source: 0, target: 1 }],
		});
		const routeLinks = group.getObjectByName(
			'spherical-graph-tag-links',
		);
		expect(
			(routeLinks as LineSegments).geometry.getAttribute('position').count,
		).toBeGreaterThan(selectedVertexCount);
		layer.updateSelection(undefined);
		layer.updateRoute(undefined);
		expect(
			group.getObjectByName('spherical-graph-tag-links'),
		).toBeUndefined();

		layer.updateSelectedTag('#shared');
		expect(
			group.getObjectByName('spherical-graph-tag-links'),
		).toBeInstanceOf(LineSegments);
		layer.setVisible(false);
		expect(
			layer.positionForTag('#a', new Vector3()),
		).toBeUndefined();
		expect(
			group.getObjectByName('spherical-graph-tag-satellites')
				?.visible,
		).toBe(false);
		expect(
			group.getObjectByName('spherical-graph-tag-links')?.visible,
		).toBe(false);
		layer.setVisible(true);
		expect(
			group.getObjectByName('spherical-graph-tag-links')?.visible,
		).toBe(true);
		layer.dispose();
	});

	it('attenuates satellite contrast smoothly with perspective depth', () => {
		const nearest = tagPerspectiveVisibility(1);
		const horizon = tagPerspectiveVisibility(0);
		const farthest = tagPerspectiveVisibility(-1);

		expect(nearest).toBe(1);
		expect(horizon).toBeGreaterThan(farthest);
		expect(horizon).toBeLessThan(nearest);
		expect(farthest).toBeCloseTo(0.34, 10);
		expect(tagPerspectiveVisibility(Number.NaN)).toBeCloseTo(
			farthest,
			10,
		);
	});
});
