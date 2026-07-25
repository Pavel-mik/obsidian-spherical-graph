import { Group, LineDashedMaterial, LineSegments } from 'three';
import { describe, expect, it } from 'vitest';
import { SphereLayer } from '../../src/render/SphereLayer';
import type { RenderTheme } from '../../src/render/renderTypes';
import { DEFAULT_SETTINGS } from '../../src/settings/settings';

const theme: RenderTheme = {
	background: '#101319',
	node: '#39d7ff',
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
});
