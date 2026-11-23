import {
	BufferAttribute,
	BufferGeometry,
	Camera,
	Color,
	Group,
	DynamicDrawUsage,
	LineSegments,
	Mesh,
	ShaderMaterial,
} from 'three';
import { sampleSurfaceRoad } from './surfaceRoad';
import { Vec3 } from '../geometry/vector3';
import { canonicalEdgeKey } from '../graph/shortestPaths';
import { AppearanceSettings } from '../settings/settings';
import {
	DEFAULT_RENDER_FILTERS,
	isRenderNodeVisible,
	type RenderFilterState,
} from './renderFilters';
import {
	PreparedRenderSnapshot,
	RenderEdge,
	RenderRouteState,
	RenderTheme,
} from './renderTypes';
import { edgesVisibleAtCameraDistance } from './edgeVisibility';
import { isSearchMatch, SEARCH_HIGHLIGHT_COLOR } from './searchHighlight';
import { screenSpaceLine } from './screenSpaceLine';
import { CARTOGRAPHY as T, updateLineViewport } from './cartography';
import { ordinaryRoadEmphasis } from './roadEmphasis';

interface EdgeDrawRecord {
	edge: RenderEdge;
	firstVertex: number;
	vertexCount: number;
	emphasis: number;
}

export class EdgeLayer {
	private geometry: BufferGeometry | undefined;
	private material: ShaderMaterial | undefined;
	private lines: Mesh | LineSegments | undefined;
	private readonly incident = new Map<number, EdgeDrawRecord[]>();
	private readonly byKey = new Map<string, EdgeDrawRecord>();
	private readonly masked = new Set<EdgeDrawRecord>();
	private priority = new Set<EdgeDrawRecord>();
	private hoverRecords: readonly EdgeDrawRecord[] = [];
	private snapshot: PreparedRenderSnapshot | undefined;
	private records: readonly EdgeDrawRecord[] = [];
	private selectedNodeId: string | undefined;
	private hoveredNodeId: string | undefined;
	private hoverRibbon: Mesh | undefined;
	private route: RenderRouteState | undefined;
	private selectedRibbon: Mesh | undefined;
	private selectedHalo: Mesh | undefined;
	private routeRibbon: Mesh | undefined;
	private routeHalo: Mesh | undefined;
	private searchRibbon: Mesh | undefined;
	private searchHalo: Mesh | undefined;
	private searchPaths: ReadonlySet<string> = new Set();
	private appearance: AppearanceSettings;
	private theme: RenderTheme;
	private filters: RenderFilterState = DEFAULT_RENDER_FILTERS;
	private interactionActive = false;

	constructor(
		private readonly group: Group,
		appearance: AppearanceSettings,
		theme: RenderTheme,
		private readonly segmentScale = 1,
	) {
		this.appearance = appearance;
		this.theme = theme;
	}

	setSnapshot(snapshot: PreparedRenderSnapshot): void {
		this.snapshot = snapshot;
		this.rebuildLines();
	}

	updateFilters(filters: RenderFilterState): void {
		const changed = filters.showAttachments !== this.filters.showAttachments || filters.showOrphans !== this.filters.showOrphans || filters.existingFilesOnly !== this.filters.existingFilesOnly;
		this.filters = { ...filters };
		if (!changed) return;
		this.rebuildLines();
	}

	private rebuildLines(): void {
		this.removeLines();
		const snapshot = this.snapshot;
		if (snapshot === undefined) {
			return;
		}
		const positions: number[] = [];
		const records: EdgeDrawRecord[] = [];
		for (const edge of snapshot.edges) {
			const startNode = snapshot.nodeByIndex.get(edge.source);
			const endNode = snapshot.nodeByIndex.get(edge.target);
			if (startNode === undefined || endNode === undefined) {
				continue;
			}
			if (
				!isRenderNodeVisible(startNode, this.filters) ||
				!isRenderNodeVisible(endNode, this.filters)
			) {
				continue;
			}
			const start = this.readPosition(snapshot, edge.source);
			const end = this.readPosition(snapshot, edge.target);
			if (start === undefined || end === undefined) {
				continue;
			}
			const segments = Math.max(
				2,
				Math.round(
					Math.min(
						adaptiveSegmentCount(start, end),
						maxSegmentsPerEdge(snapshot.edges.length),
					) * this.segmentScale,
				),
			);
			const points = sampleSurfaceRoad(snapshot,edge,segments,this.appearance);
			const firstVertex = positions.length / 3;
			for (let index = 0; index < points.length - 1; index += 1) {
				const point = points[index];
				const next = points[index + 1];
				if (point === undefined || next === undefined) {
					continue;
				}
				positions.push(
					point[0],
					point[1],
					point[2],
					next[0],
					next[1],
					next[2],
				);
			}
			const record = {
				emphasis: ordinaryRoadEmphasis(snapshot, edge),
				edge,
				firstVertex,
				vertexCount: positions.length / 3 - firstVertex,
			};
			records.push(record);
			this.byKey.set(canonicalEdgeKey(edge.source, edge.target), record);
			for (const node of [edge.source, edge.target]) {
				const list = this.incident.get(node);
				if (list) list.push(record); else this.incident.set(node, [record]);
			}
		}

		const geometry = new BufferGeometry();
		geometry.setAttribute(
			'position',
			new BufferAttribute(new Float32Array(positions), 3),
		);
		geometry.computeBoundingSphere();
		const atlas = this.appearance.mapStyle === 'atlas';
		const lines = atlas ? new LineSegments(geometry, new ShaderMaterial({
			transparent: true, depthWrite: false,
			uniforms: { lineColor: { value: new Color(this.theme.edge) }, lineOpacity: { value: this.appearance.edgeOpacity } },
			vertexShader: 'attribute float strokeOpacity; varying float strength; void main(){strength=strokeOpacity;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
			fragmentShader: 'uniform vec3 lineColor; uniform float lineOpacity; varying float strength; void main(){if(strength<=0.0)discard;gl_FragColor=vec4(lineColor,lineOpacity*strength);\n#include <colorspace_fragment>\n}',
		})) : screenSpaceLine(positions, { color: this.theme.edge, widthPx: T.edges.normal.widthPx, opacity: this.appearance.edgeOpacity });
		const factor = atlas ? 1 : 3;
		const opacity = new Float32Array(positions.length / 3 * factor);
		for (const record of records) opacity.fill(record.emphasis, record.firstVertex * factor, (record.firstVertex + record.vertexCount) * factor);
		lines.geometry.setAttribute('strokeOpacity', new BufferAttribute(opacity, 1).setUsage(DynamicDrawUsage));
		const material = lines.material;
		lines.name = 'spherical-graph-edges';
		lines.renderOrder = 1;
		this.geometry = geometry;
		this.material = material;
		this.lines = lines;
		this.records = records;
		this.group.add(lines);
		this.updateColors();
	}

	updateAppearance(appearance: AppearanceSettings): void {
		const terrainChanged=appearance.mapStyle!==this.appearance.mapStyle||appearance.showContinents!==this.appearance.showContinents||appearance.surfaceMode!==this.appearance.surfaceMode;
		this.appearance = appearance;
		if(terrainChanged)this.rebuildLines();
		if (this.material !== undefined) {
			this.material.opacity = appearance.edgeOpacity;
			this.material.uniforms.lineOpacity!.value = appearance.edgeOpacity;
			this.material.needsUpdate = true;
		}
	}

	render(camera: Camera, width = 1, height = 1): void {
		for (const mesh of [this.lines, this.hoverRibbon, this.selectedRibbon, this.selectedHalo, this.routeRibbon, this.routeHalo, this.searchRibbon, this.searchHalo]) {
			if (mesh?.material instanceof ShaderMaterial) updateLineViewport(mesh.material, width, height);
		}
		const visible = edgesVisibleAtCameraDistance(
			camera.position.length(),
			this.appearance.edgeZoomThresholdPercent,
		);
		if (this.lines !== undefined) {
			const hasSelection = this.selectedNodeId !== undefined &&
				this.snapshot?.nodeById.has(this.selectedNodeId);
			this.lines.visible = visible && this.appearance.showEdges &&
				!hasSelection && !this.interactionActive;
		}
		if (this.hoverRibbon) this.hoverRibbon.visible = visible && this.appearance.showEdges && !this.interactionActive && this.selectedNodeId === undefined;
		if (this.selectedRibbon !== undefined) {
			this.selectedRibbon.visible = visible;
		}
		if (this.routeRibbon !== undefined) {
			this.routeRibbon.visible = visible;
		}
		if (this.selectedHalo) this.selectedHalo.visible = visible;
		if (this.routeHalo) this.routeHalo.visible = visible;
	}

	setInteractionActive(active: boolean): void {
		this.interactionActive = active;
	}

	updateTheme(theme: RenderTheme): void {
		this.theme = theme;
		this.updateColors();
	}

	updateSelection(selectedNodeId: string | undefined): void {
		if (this.selectedNodeId === selectedNodeId) return;
		this.selectedNodeId = selectedNodeId;
		this.updateColors();
	}

	updateHover(nodeId: string | undefined): void {
		if (this.hoveredNodeId === nodeId) return;
		this.hoveredNodeId = nodeId; this.refreshHover();
	}

	updateRoute(route: RenderRouteState | undefined): void {
		this.route =
			route === undefined
				? undefined
				: {
						...route,
						nodeIds: [...route.nodeIds],
						edges: [...route.edges],
					};
		this.rebuildOverlays();
	}

	updateSearch(paths: ReadonlySet<string>): void {
		this.searchPaths = new Set(paths);
		this.rebuildOverlays();
	}

	private rebuildSearchOverlay(): void {
		this.removeOverlay('searchRibbon');
		this.removeOverlay('searchHalo');
		const snapshot = this.snapshot;
		const positions = this.geometry?.getAttribute('position');
		if (!snapshot || !(positions instanceof BufferAttribute)) return;
		const selected = snapshot.nodeById.get(this.selectedNodeId ?? '');
		const route = new Set(this.route?.edges.map(edge => canonicalEdgeKey(edge.source, edge.target)) ?? []);
		const records = this.searchPaths.size === 0 ? [] : this.records.filter(({ edge }) => {
			if (route.has(canonicalEdgeKey(edge.source, edge.target)) ||
				(selected && (edge.source === selected.index || edge.target === selected.index))) return false;
			const source = snapshot.nodeByIndex.get(edge.source);
			const target = snapshot.nodeByIndex.get(edge.target);
			return source !== undefined && target !== undefined &&
				isSearchMatch(source, this.searchPaths) && isSearchMatch(target, this.searchPaths);
		});
		for (const record of records) this.priority.add(record);
		// The fine wine-colored stroke sits over a soft, translucent halo.
		this.searchHalo = this.createRibbon(records, positions, SEARCH_HIGHLIGHT_COLOR,
			T.edges.search.haloWidthPx, 6, 'spherical-graph-search-edge-halo', true);
		this.searchRibbon = this.createRibbon(records, positions, SEARCH_HIGHLIGHT_COLOR,
			T.edges.search.widthPx, 7, 'spherical-graph-search-edge-ribbon');
	}

	dispose(): void {
		this.removeLines();
		this.snapshot = undefined;
		this.records = [];
		this.searchPaths = new Set();
	}

	private updateColors(): void {
		if (this.material?.uniforms.lineColor) (this.material.uniforms.lineColor.value as Color).set(this.theme.edge);
		this.rebuildOverlays();
	}

	private rebuildOverlays(): void {
		this.priority = new Set();
		this.removeOverlay('hoverRibbon');
		this.removeOverlay('selectedRibbon');
		this.removeOverlay('selectedHalo');
		this.removeOverlay('routeRibbon');
		this.removeOverlay('routeHalo');
		const snapshot = this.snapshot;
		const positionAttribute = this.geometry?.getAttribute('position');
		if (
			snapshot === undefined ||
			positionAttribute === undefined ||
			!(positionAttribute instanceof BufferAttribute)
		) {
			return;
		}

		const selectedNode = this.selectedNodeId
			? snapshot.nodeById.get(this.selectedNodeId)
			: undefined;
		const routeEdgeKeys = new Set(
			this.route?.edges.map((edge) =>
				canonicalEdgeKey(edge.source, edge.target),
			) ?? [],
		);
		if (selectedNode !== undefined) {
			const records = (this.incident.get(selectedNode.index) ?? []).filter(({edge}) => !routeEdgeKeys.has(canonicalEdgeKey(edge.source, edge.target)));
			this.selectedHalo = this.createRibbon(records, positionAttribute, this.theme.edgeSelected,
				T.edges.selected.haloWidthPx, 3, 'spherical-graph-selected-edge-halo', true);
			this.selectedRibbon = this.createRibbon(
				records,
				positionAttribute,
				this.theme.edgeSelected,
				T.edges.selected.widthPx,
				4,
				'spherical-graph-selected-edge-ribbon',
			);
		}

		if (routeEdgeKeys.size > 0) {
			const records: EdgeDrawRecord[] = [];
			for (const key of routeEdgeKeys) {
				const record = this.byKey.get(key);
				if (record) { records.push(record); this.priority.add(record); }
			}
			this.routeHalo = this.createRibbon(records, positionAttribute, this.theme.edgeRoute,
				T.edges.route.haloWidthPx, 4, 'spherical-graph-route-edge-halo', true);
			this.routeRibbon = this.createRibbon(
				records,
				positionAttribute,
				this.theme.edgeRoute,
				T.edges.route.widthPx,
				5,
				'spherical-graph-route-edge-ribbon',
			);
		}
		this.rebuildSearchOverlay();
		for (const record of this.masked) if (!this.priority.has(record)) this.mask(record, false);
		for (const record of this.priority) this.mask(record, true);
		this.refreshHover();
	}

	private refreshHover(): void {
		this.removeOverlay('hoverRibbon');
		for (const record of this.hoverRecords) if (!this.priority.has(record)) this.mask(record, false);
		const node = this.snapshot?.nodeById.get(this.hoveredNodeId ?? '');
		this.hoverRecords = node && !this.selectedNodeId ? (this.incident.get(node.index) ?? []).filter(record => !this.priority.has(record)) : [];
		const positions = this.geometry?.getAttribute('position');
		if (!(positions instanceof BufferAttribute)) return;
		for (const record of this.hoverRecords) this.mask(record, true);
		this.hoverRibbon = this.createRibbon(this.hoverRecords, positions, this.theme.edge,
			T.edges.hoveredIncident.widthPx, 2, 'spherical-graph-hover-edge-ribbon');
	}

	private mask(record: EdgeDrawRecord, hidden: boolean): void {
		if (this.masked.has(record) === hidden) return;
		const attr = this.lines?.geometry.getAttribute('strokeOpacity');
		if (!(attr instanceof BufferAttribute)) return;
		const factor = this.appearance.mapStyle === 'atlas' ? 1 : 3;
		const start = record.firstVertex * factor, count = record.vertexCount * factor;
		attr.array.fill(hidden ? 0 : record.emphasis, start, start + count);
		attr.addUpdateRange(start, count);
		attr.needsUpdate = true;
		if (hidden) this.masked.add(record); else this.masked.delete(record);
	}

	private createRibbon(
		records: readonly EdgeDrawRecord[],
		positions: BufferAttribute,
		color: string,
		widthPx: number,
		renderOrder: number,
		name: string,
		softHalo = false,
	): Mesh | undefined {
		if (records.length === 0) {
			return undefined;
		}
		const segments: number[] = [];
		for (const record of records) {
			for (let i = record.firstVertex; i < record.firstVertex + record.vertexCount; i++) {
				segments.push(positions.getX(i), positions.getY(i), positions.getZ(i));
			}
		}
		const state = name.includes('hover') ? T.edges.hoveredIncident : name.includes('search') ? T.edges.search : name.includes('route') ? T.edges.route : T.edges.selected;
		const mesh = screenSpaceLine(segments, {
			color: softHalo && name.includes('search') ? T.colors.node.searchHalo : color,
			widthPx: widthPx, opacity: softHalo ? state.haloPeakOpacity : state.opacity, halo: softHalo,
		});
		mesh.name = name;
		mesh.renderOrder = renderOrder;
		this.group.add(mesh);
		return mesh;
	}

	private readPosition(
		snapshot: PreparedRenderSnapshot,
		nodeIndex: number,
	): Vec3 | undefined {
		const offset = nodeIndex * 3;
		const x = snapshot.positions[offset];
		const y = snapshot.positions[offset + 1];
		const z = snapshot.positions[offset + 2];
		return x === undefined || y === undefined || z === undefined
			? undefined
			: [x, y, z];
	}

	private removeLines(): void {
		this.incident.clear(); this.byKey.clear(); this.masked.clear(); this.priority.clear(); this.hoverRecords = [];
		this.removeOverlay('hoverRibbon');
		this.removeOverlay('searchRibbon');
		this.removeOverlay('searchHalo');
		this.removeOverlay('selectedRibbon');
		this.removeOverlay('selectedHalo');
		this.removeOverlay('routeRibbon');
		this.removeOverlay('routeHalo');
		if (this.lines !== undefined) {
			this.group.remove(this.lines);
		}
		if (this.lines?.geometry !== this.geometry) this.lines?.geometry.dispose();
		this.geometry?.dispose();
		this.material?.dispose();
		this.geometry = undefined;
		this.material = undefined;
		this.lines = undefined;
	}

	private removeOverlay(kind: 'hoverRibbon' | 'selectedRibbon' | 'selectedHalo' | 'routeRibbon' | 'routeHalo' | 'searchRibbon' | 'searchHalo'): void {
		const overlay = this[kind];
		if (overlay === undefined) {
			return;
		}
		this.group.remove(overlay);
		overlay.geometry.dispose();
		const material = overlay.material;
		if (Array.isArray(material)) {
			for (const item of material) {
				item.dispose();
			}
		} else {
			material.dispose();
		}
		this[kind] = undefined;
	}
}

export function adaptiveSegmentCount(start: Vec3, end: Vec3): number {
	const dot = Math.max(
		-1,
		Math.min(
			1,
			start[0] * end[0] +
				start[1] * end[1] +
				start[2] * end[2],
		),
	);
	const crossX = start[1] * end[2] - start[2] * end[1];
	const crossY = start[2] * end[0] - start[0] * end[2];
	const crossZ = start[0] * end[1] - start[1] * end[0];
	const angle = Math.atan2(Math.hypot(crossX, crossY, crossZ), dot);
	return Math.max(2, Math.min(32, Math.ceil(angle / (Math.PI / 24))));
}

const TOTAL_BASE_EDGE_SEGMENT_BUDGET = 180_000;

export function maxSegmentsPerEdge(edgeCount: number): number {
	if (!Number.isFinite(edgeCount) || edgeCount <= 0) {
		return 32;
	}
	return Math.max(
		2,
		Math.min(
			32,
			Math.floor(TOTAL_BASE_EDGE_SEGMENT_BUDGET / edgeCount),
		),
	);
}
