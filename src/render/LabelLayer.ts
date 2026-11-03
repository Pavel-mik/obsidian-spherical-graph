import { cityLabelAnchor, LabelPlacement } from './LabelPlacement';
import { countryLabels } from './countryGeometry';
import { countryTerritoryForDisplay } from './countryPresentation';
import { Camera, Group, Vector3 } from 'three';
import { SPHERE_RADIUS } from '../constants';
import { surfaceRadius } from './terrainSurface';
import { AppearanceSettings } from '../settings/settings';
import {
	DEFAULT_RENDER_FILTERS,
	isRenderNodeVisible,
	type RenderFilterState,
} from './renderFilters';
import {
	cameraZoomInPercent,
	labelBudgetForViewport,
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
	private countries: ReturnType<typeof countryLabels> = [];
	private readonly continentPool: HTMLElement[] = [];
	private snapshot: PreparedRenderSnapshot | undefined;
	private selection: RenderSelectionState = {};
	private rankedNodes: readonly RenderNode[] = [];
	private candidates: readonly RenderNode[] = [];
	private route: RenderRouteState | undefined;
	private appearance: AppearanceSettings;
	private filters: RenderFilterState = DEFAULT_RENDER_FILTERS;
	private readonly worldPosition = new Vector3();
	private readonly projectedPosition = new Vector3();
	private interactionActive = false;
	private searchPaths: ReadonlySet<string> = new Set();

	constructor(
		container: HTMLElement,
		private readonly graphGroup: Group,
		appearance: AppearanceSettings,
		private readonly placement = new LabelPlacement(),
		private readonly terrainOccluded?: (camera:Vector3,point:Vector3)=>boolean,
	) {
		this.appearance = appearance;
		this.root = container.createDiv();
		this.root.className = 'spherical-graph-label-layer';
		this.root.setAttribute('aria-hidden', 'true');
		container.append(this.root);
	}

	setSnapshot(snapshot: PreparedRenderSnapshot): void {
		this.snapshot = snapshot;
		this.countries = countryLabels(countryTerritoryForDisplay(snapshot));
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

		if (this.interactionActive) {
			this.hideNodeLabels();
			this.renderContinents(camera, width, height);
			return;
		}
		const snapshot = this.snapshot;
		const zoomVisuals = labelZoomVisuals(
			camera.position.length(),
			this.appearance.labelZoomThresholdPercent,
		);
		if (
			snapshot === undefined ||
			!this.appearance.showLabels ||
			this.appearance.maxLabels === 0 ||
			width <= 0 ||
			height <= 0
		) {
			this.hideNodeLabels();
			this.renderContinents(camera, width, height);
			return;
		}

		const visibleLimit = Math.min(
			this.pool.length,
			labelBudgetForViewport(width, height),
		);
		let visibleIndex = 0;
		for (const node of this.candidates) {
			if (visibleIndex >= visibleLimit) {
				break;
			}
			if (!isRenderNodeVisible(node, this.filters)) {
				continue;
			}
			const endpoint = routeRoleForNode(this.route, node.id) !== undefined;
			const selected = node.id === this.selection.selectedNodeId;
			const hovered = node.id === this.selection.hoveredNodeId;
			const search = this.searchPaths.has(node.path);
			const important = selected || hovered || endpoint || search;
			if (!important && zoomVisuals.opacity <= 0.01) continue;
			const offset = node.index * 3;
			const x = snapshot.positions[offset];
			const y = snapshot.positions[offset + 1];
			const z = snapshot.positions[offset + 2];
			if (x === undefined || y === undefined || z === undefined) {
				continue;
			}

			this.worldPosition
				.set(x, y, z)
				.multiplyScalar(surfaceRadius(snapshot,this.appearance,[x,y,z],0.08))
				.applyMatrix4(this.graphGroup.matrixWorld);
			if (
				this.appearance.surfaceMode === 'solid' &&
				this.worldPosition.dot(camera.position) <=
					SPHERE_RADIUS * SPHERE_RADIUS
			) {
				continue;
			}

			if(this.appearance.surfaceMode==='solid'&&this.terrainOccluded?.(camera.position,this.worldPosition))continue;
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
			const screenY = (-this.projectedPosition.y * 0.5 + 0.5) * height - 24;
			const routeRole = routeRoleForNode(this.route, node.id);
			element.textContent =
				routeRole === 'start'
					? `Start · ${node.basename}`
					: routeRole === 'destination'
						? `Dest · ${node.basename}`
						: node.basename;
			element.removeAttribute('title');
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
			const labelWidth = Math.min(240, ((element.textContent?.length ?? 0) + (node.id === this.selection.activeNodeId ? 9 : 0)) * 7 + 16);
			const anchor = cityLabelAnchor(screenX, screenY+24, labelWidth, width, height, selected || hovered);
			if (!this.placement.place(anchor.x, anchor.y, labelWidth, selected || hovered ? 30 : 20,
				selected || hovered ? 100 : endpoint ? 90 : search ? 80 : 40, element)) continue;
			element.style.opacity = important ? '1' : zoomVisuals.opacity.toFixed(3);
			element.style.transform = `translate(${anchor.x.toFixed(1)}px, ${anchor.y.toFixed(1)}px) translate(-50%, -50%) scale(1)`;
			element.hidden = false;
			visibleIndex += 1;
		}

		for (let index = visibleIndex; index < this.pool.length; index += 1) {
			const element = this.pool[index];
			if (element !== undefined) {
				element.hidden = true;
			}
		}
		this.renderContinents(camera, width, height);
	}

	hasVisibleNodeLabel(nodeId:string):boolean {
		return this.pool.some(element=>!element.hidden&&element.dataset.nodeId===nodeId);
	}

	dispose(): void {
		this.pool.length = 0;
		this.continentPool.length = 0;
		this.root.remove();
		this.snapshot = undefined;
		this.rankedNodes = [];
		this.candidates = [];
	}

	updateSearch(paths: ReadonlySet<string>): void {
		this.searchPaths = new Set(paths); this.rebuildCandidates();
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
			this.selection.selectedNodeId
				? snapshot.nodeById.get(this.selection.selectedNodeId)
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
		for (const node of snapshot.nodes) if (this.searchPaths.has(node.path)) offer(node);
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
		const continentCount =
			this.appearance.showContinents
				? (this.snapshot?.geography.continents.length ?? 0) + this.countries.length
				: 0;
		while (this.continentPool.length < continentCount) {
			const element = this.root.createDiv();
			element.className = 'spherical-graph-continent-label';
			element.hidden = true;
			this.root.append(element);
			this.continentPool.push(element);
		}
		while (this.continentPool.length > continentCount) {
			this.continentPool.pop()?.remove();
		}
	}

	private hideNodeLabels(): void {
		for (const element of this.pool) {
			element.hidden = true;
		}
	}

	setInteractionActive(active: boolean): void {
		this.interactionActive = active;
	}

	private renderContinents(
		camera: Camera,
		width: number,
		height: number,
	): void {
		const snapshot = this.snapshot;
		if (
			snapshot === undefined ||
			!this.appearance.showContinents ||
			this.appearance.surfaceMode === 'hidden' ||
			width <= 0 ||
			height <= 0
		) {
			for (const element of this.continentPool) {
				element.hidden = true;
			}
			return;
		}
		const cameraDirection = camera.position.clone().normalize();
		let visibleIndex = 0;
		const zoomPercent = cameraZoomInPercent(camera.position.length());
		const labels = [
			...snapshot.geography.continents.map((continent) => ({ ...continent, country: false })),
			...(this.appearance.showCountryBorders && zoomPercent >= 45 && !this.interactionActive
				? this.countries.map((country) => ({ ...country, id: country.key, country: true })) : []),
		];
		const occupied: Array<{ x: number; y: number }> = [];
		for (const continent of labels) {
			const element = this.continentPool[visibleIndex];
			if (element === undefined) {
				break;
			}
			this.worldPosition
				.set(continent.center[0] ?? 0, continent.center[1] ?? 0, continent.center[2] ?? 0)
				.multiplyScalar(surfaceRadius(snapshot,this.appearance,continent.center,0.06))
				.applyMatrix4(this.graphGroup.matrixWorld);
			const facing = this.worldPosition
				.clone()
				.normalize()
				.dot(cameraDirection);
			if (this.appearance.surfaceMode === 'solid' && this.worldPosition.dot(camera.position) <= SPHERE_RADIUS * SPHERE_RADIUS) {
				continue;
			}
			if(this.appearance.surfaceMode==='solid'&&this.terrainOccluded?.(camera.position,this.worldPosition))continue;
			this.projectedPosition.copy(this.worldPosition).project(camera);
			if (
				this.projectedPosition.z < -1 ||
				this.projectedPosition.z > 1 ||
				Math.abs(this.projectedPosition.x) > 1.08 ||
				Math.abs(this.projectedPosition.y) > 1.08
			) {
				continue;
			}
			const screenX = (this.projectedPosition.x * 0.5 + 0.5) * width;
			const screenY = (-this.projectedPosition.y * 0.5 + 0.5) * height;
			const opacity = Math.min(continent.country ? 0.85 : 0.92, Math.max(0, (facing - 0.12) / 0.5));
			const zoom = cameraZoomInPercent(camera.position.length()) / 100;
			if (continent.country && occupied.some((point) => Math.abs(point.x - screenX) < 95 && Math.abs(point.y - screenY) < 25)) continue;
			occupied.push({ x: screenX, y: screenY });
			element.className = continent.country ? 'spherical-graph-country-label' : 'spherical-graph-continent-label';
			if (!this.appearance.showLabels) continue;
			const labelWidth = Math.min(width - 24, continent.label.length * (continent.country ? 7 : 10) + 16);
			if (!this.placement.place(screenX, screenY, labelWidth, continent.country ? 20 : 28, continent.country ? 50 : 60, element)) continue;
			element.textContent = continent.label;
			element.dataset.continentId = continent.id;
			element.style.opacity = opacity.toFixed(3);
			element.style.transform = `translate(${screenX.toFixed(1)}px, ${screenY.toFixed(1)}px) translate(-50%, -50%) scale(${(0.88 + zoom * 0.18).toFixed(3)})`;
			element.hidden = false;
			visibleIndex += 1;
		}
		for (
			let index = visibleIndex;
			index < this.continentPool.length;
			index += 1
		) {
			const element = this.continentPool[index];
			if (element !== undefined) {
				element.hidden = true;
			}
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
