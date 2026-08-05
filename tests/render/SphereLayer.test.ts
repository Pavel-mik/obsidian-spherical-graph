import {
	Group,
	LineDashedMaterial,
	LineSegments,
	Mesh,
	MeshBasicMaterial,
	ShaderMaterial,
	SphereGeometry,
} from 'three';
import { describe, expect, it } from 'vitest';
import { SPHERE_RADIUS } from '../../src/constants';
import {
	adaptiveLandDetail,
	SphereLayer,
} from '../../src/render/SphereLayer';
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

function setSingleContinentSnapshot(layer: SphereLayer): void {
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
}

describe('SphereLayer graticule', () => {
	it('reduces continent detail as vault rendering load grows', () => {
		expect(adaptiveLandDetail(100, 200)).toBe(48);
		expect(adaptiveLandDetail(1_000, 2_000)).toBe(32);
		expect(adaptiveLandDetail(2_000, 8_000)).toBe(24);
		expect(adaptiveLandDetail(5_000, 20_000)).toBe(16);
	});
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
		setSingleContinentSnapshot(layer);
		const ocean = group.getObjectByName('spherical-graph-surface');
		const land = group.getObjectByName('spherical-graph-continents');
		const beach = group.getObjectByName('spherical-graph-beaches');
		const coast = group.getObjectByName('spherical-graph-coastlines');
		expect(ocean).toBeInstanceOf(Mesh);
		expect(land).toBeInstanceOf(Mesh);
		expect(beach).toBeInstanceOf(Mesh);
		expect(coast).toBeInstanceOf(LineSegments);
		expect((ocean as Mesh).material).toBeInstanceOf(ShaderMaterial);
		expect((land as Mesh).material).toBeInstanceOf(ShaderMaterial);
		expect((beach as Mesh).material).toBeInstanceOf(ShaderMaterial);
		expect(
			((land as Mesh).material as ShaderMaterial).fragmentShader,
		).toContain('atlasFbm');
		expect(
			((beach as Mesh).material as ShaderMaterial).fragmentShader,
		).toContain('grains');
		layer.dispose();
	});
});

describe('SphereLayer surface occlusion', () => {
	it('uses a fully opaque ocean, land, and exact-radius depth mask in Solid mode', () => {
		const group = new Group();
		const layer = new SphereLayer(
			group,
			{
				...DEFAULT_SETTINGS.appearance,
				surfaceMode: 'solid',
				surfaceOpacity: 0.2,
			},
			theme,
		);
		setSingleContinentSnapshot(layer);

		const ocean = group.getObjectByName('spherical-graph-surface') as Mesh;
		const depthMask = group.getObjectByName(
			'spherical-graph-solid-depth-mask',
		) as Mesh;
		const land = group.getObjectByName(
			'spherical-graph-continents',
		) as Mesh;
		const beach = group.getObjectByName(
			'spherical-graph-beaches',
		) as Mesh;
		const oceanMaterial = ocean.material as ShaderMaterial;
		const depthMaterial = depthMask.material as MeshBasicMaterial;
		const landMaterial = land.material as ShaderMaterial;
		const beachMaterial = beach.material as ShaderMaterial;

		expect(oceanMaterial.transparent).toBe(false);
		expect(oceanMaterial.depthWrite).toBe(true);
		expect(oceanMaterial.uniforms.oceanOpacity?.value).toBe(1);
		expect(depthMask.visible).toBe(true);
		expect(depthMask.renderOrder).toBeGreaterThan(ocean.renderOrder);
		expect(depthMask.renderOrder).toBeLessThan(land.renderOrder);
		expect(
			(depthMask.geometry as SphereGeometry).parameters.radius,
		).toBe(SPHERE_RADIUS);
		expect(depthMaterial).toBeInstanceOf(MeshBasicMaterial);
		expect(depthMaterial.colorWrite).toBe(false);
		expect(depthMaterial.depthTest).toBe(true);
		expect(depthMaterial.depthWrite).toBe(true);
		expect(depthMaterial.transparent).toBe(false);
		expect(landMaterial.transparent).toBe(false);
		expect(landMaterial.depthWrite).toBe(true);
		expect(landMaterial.uniforms.landOpacity?.value).toBe(1);
		expect(beachMaterial.transparent).toBe(false);
		expect(beachMaterial.depthWrite).toBe(true);
		expect(beachMaterial.uniforms.beachOpacity?.value).toBe(1);
		layer.dispose();
	});

	it('disables the depth mask and preserves translucency in Transparent mode', () => {
		const group = new Group();
		const layer = new SphereLayer(
			group,
			DEFAULT_SETTINGS.appearance,
			theme,
		);
		setSingleContinentSnapshot(layer);
		layer.update(
			{
				...DEFAULT_SETTINGS.appearance,
				surfaceMode: 'transparent',
				surfaceOpacity: 0.18,
			},
			theme,
		);

		const ocean = group.getObjectByName('spherical-graph-surface') as Mesh;
		const depthMask = group.getObjectByName(
			'spherical-graph-solid-depth-mask',
		) as Mesh;
		const land = group.getObjectByName(
			'spherical-graph-continents',
		) as Mesh;
		const beach = group.getObjectByName(
			'spherical-graph-beaches',
		) as Mesh;
		const oceanMaterial = ocean.material as ShaderMaterial;
		const landMaterial = land.material as ShaderMaterial;
		const beachMaterial = beach.material as ShaderMaterial;

		expect(oceanMaterial.transparent).toBe(true);
		expect(oceanMaterial.depthWrite).toBe(false);
		expect(oceanMaterial.uniforms.oceanOpacity?.value).toBe(0.18);
		expect(depthMask.visible).toBe(false);
		expect(landMaterial.transparent).toBe(true);
		expect(landMaterial.depthWrite).toBe(false);
		expect(landMaterial.uniforms.landOpacity?.value).toBe(0.58);
		expect(beachMaterial.transparent).toBe(true);
		expect(beachMaterial.depthWrite).toBe(false);
		expect(beachMaterial.uniforms.beachOpacity?.value).toBe(0.52);
		layer.dispose();
	});

	it('keeps the depth mask hidden with the rest of the surface in Hidden mode', () => {
		const group = new Group();
		const layer = new SphereLayer(
			group,
			DEFAULT_SETTINGS.appearance,
			theme,
		);
		layer.update(
			{
				...DEFAULT_SETTINGS.appearance,
				surfaceMode: 'hidden',
			},
			theme,
		);

		expect(
			group.getObjectByName('spherical-graph-surface')?.visible,
		).toBe(false);
		expect(
			group.getObjectByName('spherical-graph-solid-depth-mask')?.visible,
		).toBe(false);
		layer.dispose();
	});
});
