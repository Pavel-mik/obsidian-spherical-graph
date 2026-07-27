import { Camera, Group, Vector3 } from 'three';
import { SPHERE_RADIUS } from '../constants';
import { AppearanceSettings } from '../settings/settings';
import {
	DEFAULT_RENDER_FILTERS,
	isRenderNodeVisible,
	type RenderFilterState,
} from './renderFilters';
import {
	cameraZoomInPercent,
	labelZoomVisuals,
} from './labelVisibility';
import {
	PreparedRenderSnapshot,
	RenderNode,
	RenderRouteState,
	RenderSelectionState,
} from './renderTypes';

export class LabelLayer {
	private readonly root: HTMLElement;
	private readonly pool: HTMLElement[] = [];
	private snapshot: PreparedRenderSnapshot | undefined;
	private selection: RenderSelectionState = {};
	private rankedNodes: readonly RenderNode[] = [];
	private candidates: readonly RenderNode[] = [];
	private route: RenderRouteState | undefined;
	private appearance: AppearanceSettings;
	private filters: RenderFilterState = DEFAULT_RENDER_FILTERS;
	private readonly worldPosition = new Vector3();
	private readonly projectedPosition = new Vector3();

	constructor(
		container: HTMLElement,
		private readonly graphGroup: Group,
		appearance: AppearanceSettings,
	) {
		this.appearance = appearance;
		this.root = container.createDiv();
		this.root.className = 'spherical-graph-label-layer';
		this.root.setAttribute('aria-hidden', 'true');
		container.append(this.root);
	}

	setSnapshot(snapshot: PreparedRenderSnapshot): void {
		this.snapshot = snapshot;
		this.rankedNodes = [...snapshot.nodes].sort(
			(left, right) =>
				right.degree - left.degree ||
				left.path.localeCompare(right.path),
		);
		this.rebuildCandidates();
	}

	updateAppearance(appearance: AppearanceSettings): void {
		this.appearance = appearance;
		this.resizePool();
	}

	updateFilters(filters: RenderFilterState): void {
		this.filters = { ...filters };
	}

	updateSelection(selection: RenderSelectionState): void {
		this.selection = { ...selection };
		this.rebuildCandidates();
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
		this.rebuildCandidates();
	}

	render(camera: Camera, width: number, height: number): void {
		this.resizePool();
		const snapshot = this.snapshot;
		const zoomVisuals = labelZoomVisuals(
			camera.position.length(),
			this.appearance.labelZoomThresholdPercent,
		);
		if (
			snapshot === undefined ||
			!this.appearance.showLabels ||
			this.appearance.maxLabels === 0 ||
			zoomVisuals.opacity <= 0.01 ||
			width <= 0 ||
			height <= 0
		) {
			this.hideAll();
			return;
		}

		let visibleIndex = 0;
		for (const node of this.candidates) {
			if (visibleIndex >= this.pool.length) {
				break;
			}
			if (!isRenderNodeVisible(node, this.filters)) {
				continue;
			}
			const offset = node.index * 3;
			const x = snapshot.positions[offset];
			const y = snapshot.positions[offset + 1];
			const z = snapshot.positions[offset + 2];
			if (x === undefined || y === undefined || z === undefined) {
				continue;
			}

			this.worldPosition
				.set(x, y, z)
				.multiplyScalar(SPHERE_RADIUS)
				.applyMatrix4(this.graphGroup.matrixWorld);
			if (
				this.appearance.surfaceMode === 'solid' &&
				this.worldPosition.dot(camera.position) <=
					SPHERE_RADIUS * SPHERE_RADIUS
			) {
				continue;
			}

			this.projectedPosition.copy(this.worldPosition).project(camera);
			if (
				this.projectedPosition.z < -1 ||
				this.projectedPosition.z > 1 ||
				Math.abs(this.projectedPosition.x) > 1.08 ||
				Math.abs(this.projectedPosition.y) > 1.08
			) {
				continue;
			}

			const element = this.pool[visibleIndex];
			if (element === undefined) {
				break;
			}
			const screenX = (this.projectedPosition.x * 0.5 + 0.5) * width;
			const screenY = (-this.projectedPosition.y * 0.5 + 0.5) * height;
			const routeRole = routeRoleForNode(this.route, node.id);
			element.textContent =
				routeRole === 'start'
					? `Start · ${node.basename}`
					: routeRole === 'destination'
						? `Dest · ${node.basename}`
						: node.basename;
			element.title = node.path;
			element.dataset.nodeId = node.id;
			element.dataset.selected = String(
				node.id === this.selection.selectedNodeId,
			);
			element.dataset.active = String(
				node.id === this.selection.activeNodeId,
			);
			element.dataset.hovered = String(
				node.id === this.selection.hoveredNodeId,
			);
			element.dataset.route = String(
				this.route?.nodeIds.includes(node.id) ?? false,
			);
			element.dataset.routeEndpoint = String(
				routeRole !== undefined,
			);
			if (routeRole === undefined) {
				delete element.dataset.routeRole;
			} else {
				element.dataset.routeRole = routeRole;
			}
			element.style.opacity = zoomVisuals.opacity.toFixed(3);
			element.style.transform = `translate(${screenX.toFixed(1)}px, ${screenY.toFixed(1)}px) translate(-50%, -50%) scale(${zoomVisuals.scale.toFixed(3)})`;
			element.hidden = false;
			visibleIndex += 1;
		}

		for (let index = visibleIndex; index < this.pool.length; index += 1) {
			const element = this.pool[index];
			if (element !== undefined) {
				element.hidden = true;
			}
		}
	}

	dispose(): void {
		this.pool.length = 0;
		this.root.remove();
		this.snapshot = undefined;
		this.rankedNodes = [];
		this.candidates = [];
	}

	private rebuildCandidates(): void {
		const snapshot = this.snapshot;
		if (snapshot === undefined) {
			this.candidates = [];
			return;
		}
		const candidates: RenderNode[] = [];
		const usedIds = new Set<string>();
		const offer = (node: RenderNode | undefined): void => {
			if (node === undefined) {
				return;
			}
			if (!usedIds.has(node.id)) {
				usedIds.add(node.id);
				candidates.push(node);
			}
		};

		offer(
			this.selection.activeNodeId
				? snapshot.nodeById.get(this.selection.activeNodeId)
				: undefined,
		);
		offer(
			this.selection.hoveredNodeId
				? snapshot.nodeById.get(this.selection.hoveredNodeId)
				: undefined,
		);
		const selected = this.selection.selectedNodeId
			? snapshot.nodeById.get(this.selection.selectedNodeId)
			: undefined;
		offer(selected);
		offer(
			this.route?.startNodeId
				? snapshot.nodeById.get(this.route.startNodeId)
				: undefined,
		);
		offer(
			this.route?.endNodeId
				? snapshot.nodeById.get(this.route.endNodeId)
				: undefined,
		);
		for (const routeNodeId of this.route?.nodeIds ?? []) {
			offer(snapshot.nodeById.get(routeNodeId));
		}
		if (selected !== undefined) {
			const neighbors = [
				...(snapshot.neighborsByIndex.get(selected.index) ?? []),
			]
				.map((index) => snapshot.nodeByIndex.get(index))
				.filter((node): node is RenderNode => node !== undefined)
				.sort(
					(left, right) =>
						right.degree - left.degree ||
						left.path.localeCompare(right.path),
				);
			for (const neighbor of neighbors) {
				offer(neighbor);
			}
		}
		for (const node of this.rankedNodes) {
			offer(node);
		}
		this.candidates = candidates;
	}

	private resizePool(): void {
		const desired = this.appearance.showLabels
			? this.appearance.maxLabels
			: 0;
		while (this.pool.length < desired) {
			const element = this.root.createDiv();
			element.className = 'spherical-graph-label';
			element.hidden = true;
			this.root.append(element);
			this.pool.push(element);
		}
		while (this.pool.length > desired) {
			this.pool.pop()?.remove();
		}
	}

	private hideAll(): void {
		for (const element of this.pool) {
			element.hidden = true;
		}
	}
}

export { cameraZoomInPercent };

export function routeRoleForNode(
	route: RenderRouteState | undefined,
	nodeId: string,
): 'start' | 'destination' | undefined {
	if (nodeId === route?.startNodeId) {
		return 'start';
	}
	if (nodeId === route?.endNodeId) {
		return 'destination';
	}
	return undefined;
}
