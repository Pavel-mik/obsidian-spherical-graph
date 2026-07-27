import {
	Group,
	LineDashedMaterial,
	LineSegments,
	Mesh,
	ShaderMaterial,
} from 'three';
import { describe, expect, it } from 'vitest';
import { SphereLayer } from '../../src/render/SphereLayer';
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

describe('SphereLayer graticule', () => {
	it('uses a muted dashed material distinct from document edges', () => {
		const group = new Group();
		const layer = new SphereLayer(
			group,
			DEFAULT_SETTINGS.appearance,
			theme,
		);
		const grid = group.getObjectByName(
			'spherical-graph-surface-grid',
		);
		expect(grid).toBeInstanceOf(LineSegments);
		const material = (grid as LineSegments).material;
		expect(material).toBeInstanceOf(LineDashedMaterial);
		expect((material as LineDashedMaterial).color.getHexString()).toBe(
			'284650',
		);
		expect((material as LineDashedMaterial).color.getHexString()).not.toBe(
			'21e6ff',
		);
		expect((material as LineDashedMaterial).dashSize).toBeGreaterThan(0);
		expect((material as LineDashedMaterial).gapSize).toBeGreaterThan(0);
		expect(
			(grid as LineSegments).geometry.getAttribute('lineDistance'),
		).toBeDefined();
		layer.dispose();
	});

	it('uses offline procedural atlas materials for ocean and land', () => {
		const group = new Group();
		const layer = new SphereLayer(
			group,
			DEFAULT_SETTINGS.appearance,
			theme,
		);
		layer.setSnapshot(
			prepareRenderSnapshot({
				snapshotId: 'procedural-atlas:test',
				nodes: [
					{
						index: 0,
						id: 'city',
						path: 'City.md',
						basename: 'City',
						degree: 0,
						weightedDegree: 0,
					},
				],
				edges: [],
				positions: new Float32Array([1, 0, 0]),
				geography: {
					continents: [
						{
							id: 'land',
							label: 'Land',
							nodeIndices: [0],
							center: [1, 0, 0],
							capRadius: 0.45,
							colorIndex: 0,
						},
					],
					islandNodeIndices: [],
				},
			}),
		);
		const ocean = group.getObjectByName('spherical-graph-surface');
		const land = group.getObjectByName('spherical-graph-continents');
		const coast = group.getObjectByName('spherical-graph-coastlines');
		expect(ocean).toBeInstanceOf(Mesh);
		expect(land).toBeInstanceOf(Mesh);
		expect(coast).toBeInstanceOf(LineSegments);
		expect((ocean as Mesh).material).toBeInstanceOf(ShaderMaterial);
		expect((land as Mesh).material).toBeInstanceOf(ShaderMaterial);
		expect(
			((land as Mesh).material as ShaderMaterial).fragmentShader,
		).toContain('atlasFbm');
		layer.dispose();
	});
});
