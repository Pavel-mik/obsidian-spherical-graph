import {
	AdditiveBlending,
	BufferAttribute,
	BufferGeometry,
	Color,
	DoubleSide,
	Group,
	LineBasicMaterial,
	LineSegments,
	Mesh,
	MeshBasicMaterial,
	Vector3,
} from 'three';
import { EDGE_SURFACE_LIFT, SPHERE_RADIUS } from '../constants';
import { sampleGeodesicArc } from '../geometry/geodesicArc';
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

interface EdgeDrawRecord {
	edge: RenderEdge;
	firstVertex: number;
	vertexCount: number;
}

export class EdgeLayer {
	private geometry: BufferGeometry | undefined;
	private material: LineBasicMaterial | undefined;
	private lines: LineSegments | undefined;
	private snapshot: PreparedRenderSnapshot | undefined;
	private records: readonly EdgeDrawRecord[] = [];
	private selectedNodeId: string | undefined;
	private route: RenderRouteState | undefined;
	private selectedRibbon: Mesh | undefined;
	private routeRibbon: Mesh | undefined;
	private appearance: AppearanceSettings;
	private theme: RenderTheme;
	private filters: RenderFilterState = DEFAULT_RENDER_FILTERS;

	constructor(
		private readonly group: Group,
		appearance: AppearanceSettings,
		theme: RenderTheme,
	) {
		this.appearance = appearance;
		this.theme = theme;
	}

	setSnapshot(snapshot: PreparedRenderSnapshot): void {
		this.snapshot = snapshot;
		this.rebuildLines();
	}

	updateFilters(filters: RenderFilterState): void {
		this.filters = { ...filters };
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
			const segments = adaptiveSegmentCount(start, end);
			const points = sampleGeodesicArc(
				start,
				end,
				segments,
				SPHERE_RADIUS + EDGE_SURFACE_LIFT,
				startNode.id,
				endNode.id,
			);
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
			records.push({
				edge,
				firstVertex,
				vertexCount: positions.length / 3 - firstVertex,
			});
		}

		const geometry = new BufferGeometry();
		geometry.setAttribute(
			'position',
			new BufferAttribute(new Float32Array(positions), 3),
		);
		geometry.setAttribute(
			'color',
			new BufferAttribute(new Float32Array(positions.length), 3),
		);
		geometry.computeBoundingSphere();
		const material = new LineBasicMaterial({
			blending: AdditiveBlending,
			vertexColors: true,
			transparent: true,
			opacity: this.appearance.edgeOpacity,
			depthTest: true,
			depthWrite: false,
			toneMapped: false,
		});
		const lines = new LineSegments(geometry, material);
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
		this.appearance = appearance;
		if (this.material !== undefined) {
			this.material.opacity = appearance.edgeOpacity;
			this.material.needsUpdate = true;
		}
	}

	updateTheme(theme: RenderTheme): void {
		this.theme = theme;
		this.updateColors();
	}

	updateSelection(selectedNodeId: string | undefined): void {
		this.selectedNodeId = selectedNodeId;
		this.updateColors();
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

	dispose(): void {
		this.removeLines();
		this.snapshot = undefined;
		this.records = [];
	}

	private updateColors(): void {
		const snapshot = this.snapshot;
		const attribute = this.geometry?.getAttribute('color');
		if (
			snapshot === undefined ||
			attribute === undefined ||
			!(attribute instanceof BufferAttribute)
		) {
			return;
		}
		const selectedNode = this.selectedNodeId
			? snapshot.nodeById.get(this.selectedNodeId)
			: undefined;
		const baseColor = new Color(this.theme.edge);
		const dimColor = new Color(this.theme.edge).multiplyScalar(0.07);
		const selectedColor = new Color(this.theme.edgeSelected);

		for (const record of this.records) {
			const incident =
				selectedNode !== undefined &&
				(record.edge.source === selectedNode.index ||
					record.edge.target === selectedNode.index);
			const color =
				selectedNode === undefined
					? baseColor
					: incident
						? selectedColor
						: dimColor;
			const end = record.firstVertex + record.vertexCount;
			for (
				let vertex = record.firstVertex;
				vertex < end;
				vertex += 1
			) {
				attribute.setXYZ(vertex, color.r, color.g, color.b);
			}
		}
		attribute.needsUpdate = true;
		this.rebuildOverlays();
	}

	private rebuildOverlays(): void {
		this.removeOverlay('selected');
		this.removeOverlay('route');
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
			const records = this.records.filter(
				(record) =>
					(record.edge.source === selectedNode.index ||
						record.edge.target === selectedNode.index) &&
					!routeEdgeKeys.has(
						canonicalEdgeKey(
							record.edge.source,
							record.edge.target,
						),
					),
			);
			this.selectedRibbon = this.createRibbon(
				records,
				positionAttribute,
				this.theme.edgeSelected,
				0.044,
				4,
				'spherical-graph-selected-edge-ribbon',
			);
		}

		if (routeEdgeKeys.size > 0) {
			const records = this.records.filter((record) =>
				routeEdgeKeys.has(
					canonicalEdgeKey(
						record.edge.source,
						record.edge.target,
					),
				),
			);
			this.routeRibbon = this.createRibbon(
				records,
				positionAttribute,
				this.theme.edgeRoute,
				0.036,
				5,
				'spherical-graph-route-edge-ribbon',
			);
		}
	}

	private createRibbon(
		records: readonly EdgeDrawRecord[],
		positions: BufferAttribute,
		color: string,
		halfWidth: number,
		renderOrder: number,
		name: string,
	): Mesh | undefined {
		if (records.length === 0) {
			return undefined;
		}
		const geometry = createRibbonGeometry(
			records,
			positions,
			SPHERE_RADIUS + EDGE_SURFACE_LIFT + 0.025,
			halfWidth,
		);
		const mesh = new Mesh(
			geometry,
			new MeshBasicMaterial({
				blending: AdditiveBlending,
				color,
				depthTest: true,
				depthWrite: false,
				opacity: 0.96,
				side: DoubleSide,
				toneMapped: false,
				transparent: true,
			}),
		);
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
		this.removeOverlay('selected');
		this.removeOverlay('route');
		if (this.lines !== undefined) {
			this.group.remove(this.lines);
		}
		this.geometry?.dispose();
		this.material?.dispose();
		this.geometry = undefined;
		this.material = undefined;
		this.lines = undefined;
	}

	private removeOverlay(kind: 'selected' | 'route'): void {
		const overlay =
			kind === 'selected' ? this.selectedRibbon : this.routeRibbon;
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
		if (kind === 'selected') {
			this.selectedRibbon = undefined;
		} else {
			this.routeRibbon = undefined;
		}
	}
}

function createRibbonGeometry(
	records: readonly EdgeDrawRecord[],
	positions: BufferAttribute,
	radius: number,
	halfWidth: number,
): BufferGeometry {
	const vertices: number[] = [];
	const start = new Vector3();
	const end = new Vector3();
	const radial = new Vector3();
	const tangent = new Vector3();
	const side = new Vector3();
	const startLeft = new Vector3();
	const startRight = new Vector3();
	const endLeft = new Vector3();
	const endRight = new Vector3();

	for (const record of records) {
		const endVertex = record.firstVertex + record.vertexCount;
		for (
			let vertex = record.firstVertex;
			vertex + 1 < endVertex;
			vertex += 2
		) {
			start.fromBufferAttribute(positions, vertex).normalize();
			end.fromBufferAttribute(positions, vertex + 1).normalize();
			radial.copy(start).add(end).normalize();
			tangent.copy(end).sub(start).normalize();
			side.crossVectors(radial, tangent).normalize();
			if (side.lengthSq() < 1e-10) {
				continue;
			}
			startLeft
				.copy(start)
				.multiplyScalar(radius)
				.addScaledVector(side, halfWidth)
				.normalize()
				.multiplyScalar(radius);
			startRight
				.copy(start)
				.multiplyScalar(radius)
				.addScaledVector(side, -halfWidth)
				.normalize()
				.multiplyScalar(radius);
			endLeft
				.copy(end)
				.multiplyScalar(radius)
				.addScaledVector(side, halfWidth)
				.normalize()
				.multiplyScalar(radius);
			endRight
				.copy(end)
				.multiplyScalar(radius)
				.addScaledVector(side, -halfWidth)
				.normalize()
				.multiplyScalar(radius);
			pushTriangle(vertices, startLeft, startRight, endLeft);
			pushTriangle(vertices, startRight, endRight, endLeft);
		}
	}

	const geometry = new BufferGeometry();
	geometry.setAttribute(
		'position',
		new BufferAttribute(new Float32Array(vertices), 3),
	);
	geometry.computeBoundingSphere();
	return geometry;
}

function pushTriangle(
	vertices: number[],
	first: Vector3,
	second: Vector3,
	third: Vector3,
): void {
	vertices.push(
		first.x,
		first.y,
		first.z,
		second.x,
		second.y,
		second.z,
		third.x,
		third.y,
		third.z,
	);
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
