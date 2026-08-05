import { Group, LineSegments, Mesh, PerspectiveCamera } from 'three';
import { describe, expect, it } from 'vitest';
import {
	adaptiveSegmentCount,
	maxSegmentsPerEdge,
	EdgeLayer,
} from '../../src/render/EdgeLayer';
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

describe('adaptiveSegmentCount', () => {
	it('uses a small floor for short arcs and more segments for long arcs', () => {
		expect(adaptiveSegmentCount([1, 0, 0], [1, 0, 0])).toBe(2);
		expect(adaptiveSegmentCount([1, 0, 0], [0, 1, 0])).toBe(12);
		expect(adaptiveSegmentCount([1, 0, 0], [-1, 0, 0])).toBe(24);
	});

	it('bounds total base-road tessellation for very large graphs', () => {
		expect(maxSegmentsPerEdge(100)).toBe(32);
		expect(maxSegmentsPerEdge(30_000)).toBe(6);
		expect(maxSegmentsPerEdge(200_000)).toBe(2);
	});

	it('adds bright batched ribbons for selected links and route links', () => {
		const group = new Group();
		const layer = new EdgeLayer(
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

		layer.updateSelection('A');
		const selected = group.getObjectByName(
			'spherical-graph-selected-edge-ribbon',
		);
		expect(selected).toBeInstanceOf(Mesh);
		expect(
			(selected as Mesh).geometry.getAttribute('position').count,
		).toBeGreaterThan(0);

		layer.updateRoute({
			startNodeId: 'A',
			endNodeId: 'B',
			nodeIds: ['A', 'B'],
			edges: [{ source: 0, target: 1 }],
		});
		expect(
			group.getObjectByName('spherical-graph-route-edge-ribbon'),
		).toBeInstanceOf(Mesh);
		expect(
			group.getObjectByName('spherical-graph-selected-edge-ribbon'),
		).toBeUndefined();
		layer.dispose();
	});

	it('removes links incident to disabled attachment nodes', () => {
		const group = new Group();
		const layer = new EdgeLayer(
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
						id: 'A',
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
		const hiddenLines = group.getObjectByName(
			'spherical-graph-edges',
		) as LineSegments;
		expect(hiddenLines.geometry.getAttribute('position').count).toBe(0);

		layer.updateFilters({
			showTags: true,
			showAttachments: true,
			existingFilesOnly: true,
			showOrphans: true,
		});
		const visibleLines = group.getObjectByName(
			'spherical-graph-edges',
		) as LineSegments;
		expect(
			visibleLines.geometry.getAttribute('position').count,
		).toBeGreaterThan(0);
		layer.dispose();
	});

	it('shows standard and highlighted links only after the configured zoom threshold', () => {
		const group = new Group();
		const layer = new EdgeLayer(
			group,
			DEFAULT_SETTINGS.appearance,
			theme,
		);
		layer.setSnapshot(
			prepareRenderSnapshot({
				snapshotId: 'zoom-threshold',
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
		const camera = new PerspectiveCamera();
		const lines = group.getObjectByName(
			'spherical-graph-edges',
		) as LineSegments;
		layer.updateSelection('A');
		const selectedRibbon = group.getObjectByName(
			'spherical-graph-selected-edge-ribbon',
		) as Mesh;

		camera.position.set(0, 0, 37);
		layer.render(camera);
		expect(lines.visible).toBe(false);
		expect(selectedRibbon.visible).toBe(false);

		camera.position.set(0, 0, 36);
		layer.render(camera);
		expect(lines.visible).toBe(true);
		expect(selectedRibbon.visible).toBe(true);

		layer.updateRoute({
			startNodeId: 'A',
			endNodeId: 'B',
			nodeIds: ['A', 'B'],
			edges: [{ source: 0, target: 1 }],
		});
		const routeRibbon = group.getObjectByName(
			'spherical-graph-route-edge-ribbon',
		) as Mesh;
		camera.position.set(0, 0, 37);
		layer.render(camera);
		expect(routeRibbon.visible).toBe(false);
		camera.position.set(0, 0, 36);
		layer.render(camera);
		expect(routeRibbon.visible).toBe(true);
		layer.dispose();
	});
});
