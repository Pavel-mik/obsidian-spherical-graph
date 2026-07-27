import {
	App,
	ItemView,
	Modal,
	Scope,
	WorkspaceLeaf,
} from 'obsidian';
import { VIEW_TYPE } from '../constants';
import {
	findAllShortestPathUnion,
} from '../graph/shortestPaths';
import { UI_STRINGS } from '../i18n';
import { SphericalGraphRenderer } from '../render/SphericalGraphRenderer';
import {
	DEFAULT_RENDER_FILTERS,
	isRenderNodeVisible,
	renderNodeKind,
	type RenderFilterState,
} from '../render/renderFilters';
import {
	CameraState,
	RenderGraphSnapshot,
	RenderNode,
	RenderRouteState,
	RenderTag,
} from '../render/renderTypes';
import {
	cloneSphericalGraphSettings,
	parseSphericalGraphSettings,
	SphericalGraphSettings,
	SurfaceMode,
} from '../settings/settings';
import {
	LayoutStatusPresenter,
	presentLayoutStatus,
} from './LayoutStatusPresenter';
import {
	DetailsRouteState,
	SelectionDetailsPanel,
} from './SelectionDetailsPanel';
import {
	RouteToolbarState,
	ViewToolbar,
} from './ViewToolbar';
import { RENEW_CONFIRMATION_COPY } from './viewCopy';
import {
	SphericalGraphViewModel,
	SphericalGraphViewOptions,
	ViewStatusModel,
} from './viewTypes';

type RouteSelectionState =
	| { kind: 'idle' }
	| { kind: 'select-source' }
	| {
			kind: 'select-target';
			sourceNodeId: string;
			sourceLabel: string;
	  }
	| {
			kind: 'complete';
			sourceNodeId: string;
			sourceLabel: string;
			targetNodeId: string;
			targetLabel: string;
			distance: number;
	  }
	| {
			kind: 'unreachable';
			sourceNodeId: string;
			sourceLabel: string;
			targetNodeId: string;
			targetLabel: string;
	  };

export class SphericalGraphView extends ItemView {
	private readonly options: SphericalGraphViewOptions;
	private currentSettings: SphericalGraphSettings;
	private renderer: SphericalGraphRenderer | undefined;
	private toolbar: ViewToolbar | undefined;
	private detailsPanel: SelectionDetailsPanel | undefined;
	private statusPresenter: LayoutStatusPresenter | undefined;
	private root: HTMLElement | undefined;
	private stage: HTMLElement | undefined;
	private stateOverlay: HTMLElement | undefined;
	private model: SphericalGraphViewModel = {
		status: {
			state: { kind: 'no-layout' },
			nodeCount: 0,
			edgeCount: 0,
		},
	};
	private runtimeError: string | undefined;
	private opened = false;
	private selectedNodeId: string | undefined;
	private selectedTagId: string | undefined;
	private displayFilters: RenderFilterState = DEFAULT_RENDER_FILTERS;
	private routeSelection: RouteSelectionState = { kind: 'idle' };
	private renderRoute: RenderRouteState | undefined;

	constructor(
		leaf: WorkspaceLeaf,
		options: SphericalGraphViewOptions,
	) {
		super(leaf);
		this.scope = new Scope(this.app.scope);
		this.scope.register([], 'Escape', (event) => {
			const search = this.toolbar?.search;
			if (
				search === undefined ||
				search.input.ownerDocument.activeElement !== search.input
			) {
				return;
			}
			event.stopPropagation();
			search.clear();
			this.handleNodeSelection(undefined, false);
			return false;
		});
		this.options = options;
		this.currentSettings = parseSphericalGraphSettings(
			options.getSettings(),
		);
		this.displayFilters = {
			...DEFAULT_RENDER_FILTERS,
			showOrphans: this.currentSettings.data.includeOrphanNotes,
		};
	}

	getViewType(): string {
		return VIEW_TYPE;
	}

	getDisplayText(): string {
		return UI_STRINGS.viewName;
	}

	getIcon(): string {
		return 'orbit';
	}

	async onOpen(): Promise<void> {
		this.opened = true;
		this.currentSettings = parseSphericalGraphSettings(
			this.options.getSettings(),
		);
		this.contentEl.empty();
		this.contentEl.classList.add('spherical-graph-view-content');
		this.root = this.contentEl.createDiv();
		this.root.className = 'spherical-graph-view';
		this.stage = this.root.createDiv();
		this.stage.className = 'spherical-graph-stage';
		this.contentEl.append(this.root);

		this.toolbar = new ViewToolbar(
			this.root,
			{
				onRefresh: () => {
					this.invoke(() =>
						this.options.callbacks.onRefresh(),
					);
				},
				onRenew: () => {
					this.promptRenew();
				},
				onCancel: () => {
					this.invoke(() =>
						this.options.callbacks.onCancel(),
					);
				},
				onResetCamera: () => {
					this.resetCamera();
				},
				onRouteToggle: () => {
					this.toggleRouteSelection();
				},
				onFiltersChange: (filters) => {
					this.changeDisplayFilters(filters);
				},
				onSurfaceModeChange: (mode) => {
					this.changeSurfaceMode(mode);
				},
				onContinentsVisibilityChange: (visible) => {
					this.changeContinentsVisibility(visible);
				},
				onSelect: (node) => {
					this.handleNodeSelection(node, true);
				},
				onOpen: (node, openInNewLeaf) => {
					this.invoke(() =>
						this.options.callbacks.onOpenFile(
							node,
							openInNewLeaf,
						),
					);
				},
				onDismiss: () => {
					this.handleNodeSelection(undefined, false);
				},
			},
			this.currentSettings.appearance.surfaceMode,
			this.displayFilters,
			this.currentSettings.appearance.showContinents,
		);
		this.root.append(this.stage);

		const statusRail = this.root.createDiv();
		statusRail.className = 'spherical-graph-status-rail';
		this.root.append(statusRail);
		this.statusPresenter = new LayoutStatusPresenter(statusRail);

		this.stateOverlay = this.root.createDiv();
		this.stateOverlay.className = 'spherical-graph-state-overlay';
		this.stateOverlay.setAttribute('role', 'status');
		this.stateOverlay.setAttribute('aria-live', 'polite');
		this.root.append(this.stateOverlay);

		try {
			this.renderer = new SphericalGraphRenderer(this.stage, {
				appearance: this.currentSettings.appearance,
				camera: this.options.initialCamera,
				callbacks: {
					onOpenNode: (node, openInNewLeaf) => {
						this.invoke(() =>
							this.options.callbacks.onOpenFile(
								node,
								openInNewLeaf,
							),
						);
					},
					onSelect: (node) => {
						this.handleNodeSelection(node, false);
					},
					onSelectTag: (tag) => {
						this.handleTagSelection(tag);
					},
					onCameraChange: (camera) => {
						this.invoke(() =>
							this.options.callbacks.onCameraChange(camera),
						);
					},
					onContextError: (message) => {
						this.runtimeError = message;
						this.updateStateOverlay();
					},
					onContextRestored: () => {
						this.runtimeError = undefined;
						this.updateStateOverlay();
					},
				},
			});
			this.renderer.setFilters(this.displayFilters);
		} catch (error) {
			this.runtimeError = errorMessage(
				error,
				'WebGL could not be initialized.',
			);
		}
		this.detailsPanel = new SelectionDetailsPanel(this.stage, {
			onOpen: (node, openInNewLeaf) => {
				this.invoke(() =>
					this.options.callbacks.onOpenFile(node, openInNewLeaf),
				);
			},
		});

		this.renderModel();
	}

	async onClose(): Promise<void> {
		this.opened = false;
		this.renderer?.dispose();
		this.renderer = undefined;
		this.toolbar?.dispose();
		this.toolbar = undefined;
		this.detailsPanel?.dispose();
		this.detailsPanel = undefined;
		this.root?.remove();
		this.root = undefined;
		this.stage = undefined;
		this.stateOverlay = undefined;
		this.statusPresenter = undefined;
		await Promise.resolve(this.options.callbacks.onClose()).catch(
			() => undefined,
		);
	}

	setModel(model: SphericalGraphViewModel): void {
		const previousSnapshot = this.model.snapshot;
		this.model = model;
		if (!this.opened) {
			return;
		}
		if (
			model.snapshot !== undefined &&
			model.snapshot !== previousSnapshot
		) {
			this.applySnapshot(model.snapshot);
		}
		this.renderer?.setActiveNode(model.activeNodeId);
		this.updateStatus();
		this.updateStateOverlay();
	}

	setSnapshot(snapshot: RenderGraphSnapshot): void {
		this.model = {
			...this.model,
			snapshot,
			status: {
				...this.model.status,
				nodeCount: snapshot.nodes.length,
				edgeCount: snapshot.edges.length,
			},
		};
		if (this.opened) {
			this.applySnapshot(snapshot);
			this.updateStateOverlay();
		}
	}

	setStatus(status: ViewStatusModel): void {
		this.model = { ...this.model, status };
		if (this.opened) {
			this.updateStatus();
			this.updateStateOverlay();
		}
	}

	setActiveNode(nodeId: string | undefined): void {
		this.model = { ...this.model, activeNodeId: nodeId };
		this.renderer?.setActiveNode(nodeId);
	}

	updateSettings(settings: SphericalGraphSettings): void {
		this.currentSettings = parseSphericalGraphSettings(settings);
		this.renderer?.updateAppearance(this.currentSettings.appearance);
		this.toolbar?.setSurfaceMode(
			this.currentSettings.appearance.surfaceMode,
		);
		this.toolbar?.setContinentsVisible(
			this.currentSettings.appearance.showContinents,
		);
	}

	focusSearch(): void {
		this.toolbar?.search.focus();
	}

	focusNode(nodeId: string): boolean {
		this.selectedTagId = undefined;
		this.selectedNodeId = nodeId;
		this.renderer?.setSelectedTag(undefined);
		this.renderer?.setSelectedNode(nodeId);
		this.detailsPanel?.setSelectedTag(undefined);
		this.detailsPanel?.setSelectedNode(nodeId);
		return this.renderer?.focusNode(nodeId) ?? false;
	}

	/**
	 * Starts route picking, using the current selection as the origin when one
	 * exists. Calling it again clears the current or in-progress route.
	 */
	toggleRouteSelection(): boolean {
		const snapshot = this.model.snapshot;
		const routeNodes =
			snapshot?.nodes.filter(
				(node) =>
					renderNodeKind(node) === 'note' &&
					isRenderNodeVisible(node, this.displayFilters),
			) ?? [];
		if (snapshot === undefined || routeNodes.length < 2) {
			return false;
		}
		if (this.routeSelection.kind !== 'idle') {
			this.clearRoute();
			return true;
		}
		const selectedNode =
			this.selectedNodeId === undefined
				? undefined
			: routeNodes.find(
						(node) => node.id === this.selectedNodeId,
					);
		if (selectedNode === undefined) {
			this.routeSelection = { kind: 'select-source' };
			this.renderRoute = undefined;
			this.renderer?.setRoute(undefined);
		} else {
			this.setRouteSource(selectedNode);
		}
		this.syncRouteToolbar();
		return true;
	}

	resetCamera(): void {
		this.renderer?.resetCamera();
		const camera = this.renderer?.getCameraState();
		if (camera !== undefined) {
			this.invoke(() => this.options.callbacks.onResetCamera?.(camera));
		}
	}

	getCameraState(): CameraState | undefined {
		return this.renderer?.getCameraState();
	}

	getPositionBufferCopy(): Float32Array | undefined {
		return this.renderer?.getPositionBufferCopy();
	}

	/**
	 * Opens the same transactional Renew confirmation used by the toolbar.
	 * Commands can call this method without duplicating modal copy or behavior.
	 */
	promptRenew(): boolean {
		if (!presentLayoutStatus(this.model.status).canRenew) {
			return false;
		}
		new RenewConfirmationModal(this.app, () => {
			this.invoke(() => this.options.callbacks.onRenew());
		}).open();
		return true;
	}

	private renderModel(): void {
		if (!this.opened) {
			return;
		}
		if (this.model.snapshot !== undefined) {
			this.applySnapshot(this.model.snapshot);
		}
		this.renderer?.setActiveNode(this.model.activeNodeId);
		this.updateStatus();
		this.updateStateOverlay();
	}

	private applySnapshot(snapshot: RenderGraphSnapshot): void {
		try {
			this.renderer?.setSnapshot(snapshot);
			this.syncVisibleNodes(snapshot);
			this.toolbar?.setTagsAvailable(snapshot.tags?.length ?? 0);
			this.toolbar?.setFilterState(this.displayFilters);
			this.renderer?.setFilters(this.displayFilters);
			this.detailsPanel?.setSnapshot(snapshot);
			if (
				this.selectedNodeId !== undefined &&
				!snapshot.nodes.some(
					(node) => node.id === this.selectedNodeId,
				)
			) {
				this.selectedNodeId = undefined;
				this.detailsPanel?.setSelectedNode(undefined);
			}
			if (
				this.selectedTagId !== undefined &&
				!(snapshot.tags ?? []).some(
					(tag) => tag.id === this.selectedTagId,
				)
			) {
				this.selectedTagId = undefined;
				this.renderer?.setSelectedTag(undefined);
				this.detailsPanel?.setSelectedTag(undefined);
			}
			this.reconcileRoute(snapshot);
			this.runtimeError = undefined;
		} catch (error) {
			this.runtimeError = errorMessage(
				error,
				'The saved graph could not be rendered.',
			);
		}
	}

	private handleNodeSelection(
		node: RenderNode | undefined,
		focus: boolean,
	): void {
		this.selectedTagId = undefined;
		this.selectedNodeId = node?.id;
		this.renderer?.setSelectedTag(undefined);
		this.renderer?.setSelectedNode(node?.id);
		this.detailsPanel?.setSelectedTag(undefined);
		this.detailsPanel?.setSelectedNode(node?.id);
		if (node !== undefined && focus) {
			this.renderer?.focusNode(node.id);
		}
		if (node === undefined) {
			if (
				this.routeSelection.kind === 'select-source' ||
				this.routeSelection.kind === 'select-target'
			) {
				this.clearRoute();
			}
			return;
		}
		if (this.routeSelection.kind === 'select-source') {
			this.setRouteSource(node);
		} else if (this.routeSelection.kind === 'select-target') {
			if (node.id !== this.routeSelection.sourceNodeId) {
				this.completeRoute(
					this.routeSelection.sourceNodeId,
					this.routeSelection.sourceLabel,
					node.id,
					node.basename,
				);
			}
		}
	}

	private handleTagSelection(tag: RenderTag | undefined): void {
		if (tag !== undefined && !this.displayFilters.showTags) {
			return;
		}
		this.selectedNodeId = undefined;
		this.selectedTagId = tag?.id;
		this.renderer?.setSelectedNode(undefined);
		this.renderer?.setSelectedTag(tag?.id);
		this.detailsPanel?.setSelectedNode(undefined);
		this.detailsPanel?.setSelectedTag(tag?.id);
	}

	private changeDisplayFilters(filters: RenderFilterState): void {
		this.displayFilters = { ...filters };
		this.renderer?.setFilters(this.displayFilters);
		this.toolbar?.setFilterState(this.displayFilters);
		const snapshot = this.model.snapshot;
		if (snapshot !== undefined) {
			this.syncVisibleNodes(snapshot);
			const selected =
				this.selectedNodeId === undefined
					? undefined
					: snapshot.nodes.find(
							(node) => node.id === this.selectedNodeId,
						);
			if (
				selected !== undefined &&
				!isRenderNodeVisible(selected, this.displayFilters)
			) {
				this.handleNodeSelection(undefined, false);
			}
			if (
				!this.displayFilters.showTags &&
				this.selectedTagId !== undefined
			) {
				this.handleTagSelection(undefined);
			}
			this.reconcileRoute(snapshot);
		}
	}

	private syncVisibleNodes(snapshot: RenderGraphSnapshot): void {
		this.toolbar?.setNodes(
			snapshot.nodes.filter(
				(node) =>
					renderNodeKind(node) === 'note' &&
					isRenderNodeVisible(node, this.displayFilters),
			),
		);
	}

	private setRouteSource(node: RenderNode): void {
		this.routeSelection = {
			kind: 'select-target',
			sourceNodeId: node.id,
			sourceLabel: node.basename,
		};
		this.renderRoute = {
			startNodeId: node.id,
			nodeIds: [node.id],
			edges: [],
		};
		this.renderer?.setRoute(this.renderRoute);
		this.syncRouteToolbar();
	}

	private completeRoute(
		sourceNodeId: string,
		sourceLabel: string,
		targetNodeId: string,
		targetLabel: string,
	): void {
		const snapshot = this.model.snapshot;
		const source = snapshot?.nodes.find(
			(node) =>
				node.id === sourceNodeId &&
				renderNodeKind(node) === 'note' &&
				isRenderNodeVisible(node, this.displayFilters),
		);
		const target = snapshot?.nodes.find(
			(node) =>
				node.id === targetNodeId &&
				renderNodeKind(node) === 'note' &&
				isRenderNodeVisible(node, this.displayFilters),
		);
		if (
			snapshot === undefined ||
			source === undefined ||
			target === undefined
		) {
			this.clearRoute();
			return;
		}
		const result = findAllShortestPathUnion(
			snapshot.nodes.length,
			snapshot.edges.filter((edge) => {
				const edgeSource = snapshot.nodes[edge.source];
				const edgeTarget = snapshot.nodes[edge.target];
				return (
					edgeSource !== undefined &&
					edgeTarget !== undefined &&
					renderNodeKind(edgeSource) === 'note' &&
					renderNodeKind(edgeTarget) === 'note' &&
					isRenderNodeVisible(
						edgeSource,
						this.displayFilters,
					) &&
					isRenderNodeVisible(
						edgeTarget,
						this.displayFilters,
					)
				);
			}),
			source.index,
			target.index,
		);
		if (result === undefined) {
			this.routeSelection = {
				kind: 'unreachable',
				sourceNodeId,
				sourceLabel,
				targetNodeId,
				targetLabel,
			};
			this.renderRoute = {
				startNodeId: sourceNodeId,
				endNodeId: targetNodeId,
				nodeIds: [sourceNodeId, targetNodeId],
				edges: [],
			};
		} else {
			const nodesByIndex = new Map(
				snapshot.nodes.map((node) => [node.index, node] as const),
			);
			const nodeIds = result.nodeIndices
				.map((index) => nodesByIndex.get(index))
				.filter((node): node is RenderNode => node !== undefined)
				.map((node) => node.id);
			this.routeSelection = {
				kind: 'complete',
				sourceNodeId,
				sourceLabel,
				targetNodeId,
				targetLabel,
				distance: result.distance,
			};
			this.renderRoute = {
				startNodeId: sourceNodeId,
				endNodeId: targetNodeId,
				nodeIds,
				edges: result.edges,
			};
		}
		this.renderer?.setRoute(this.renderRoute);
		this.syncRouteToolbar();
	}

	private reconcileRoute(snapshot: RenderGraphSnapshot): void {
		const route = this.routeSelection;
		if (route.kind === 'idle' || route.kind === 'select-source') {
			this.renderRoute = undefined;
			this.renderer?.setRoute(undefined);
			this.syncRouteToolbar();
			return;
		}
		const source = snapshot.nodes.find(
			(node) =>
				node.id === route.sourceNodeId &&
				renderNodeKind(node) === 'note' &&
				isRenderNodeVisible(node, this.displayFilters),
		);
		if (source === undefined) {
			this.clearRoute();
			return;
		}
		if (route.kind === 'select-target') {
			this.renderRoute = {
				startNodeId: source.id,
				nodeIds: [source.id],
				edges: [],
			};
			this.renderer?.setRoute(this.renderRoute);
			this.syncRouteToolbar();
			return;
		}
		const target = snapshot.nodes.find(
			(node) =>
				node.id === route.targetNodeId &&
				renderNodeKind(node) === 'note' &&
				isRenderNodeVisible(node, this.displayFilters),
		);
		if (target === undefined) {
			this.clearRoute();
			return;
		}
		this.completeRoute(
			source.id,
			source.basename,
			target.id,
			target.basename,
		);
	}

	private clearRoute(): void {
		this.routeSelection = { kind: 'idle' };
		this.renderRoute = undefined;
		this.renderer?.setRoute(undefined);
		this.syncRouteToolbar();
	}

	private syncRouteToolbar(): void {
		const route = this.routeSelection;
		let toolbarState: RouteToolbarState;
		switch (route.kind) {
			case 'idle':
			case 'select-source':
				toolbarState = { kind: route.kind };
				break;
			case 'select-target':
				toolbarState = {
					kind: route.kind,
					sourceLabel: route.sourceLabel,
				};
				break;
			case 'complete':
				toolbarState = {
					kind: route.kind,
					sourceLabel: route.sourceLabel,
					targetLabel: route.targetLabel,
					distance: route.distance,
				};
				break;
			case 'unreachable':
				toolbarState = {
					kind: route.kind,
					sourceLabel: route.sourceLabel,
					targetLabel: route.targetLabel,
				};
				break;
		}
		this.toolbar?.setRouteState(toolbarState);
		this.detailsPanel?.setRoute(this.detailsRouteState());
	}

	private detailsRouteState(): DetailsRouteState | undefined {
		const route = this.renderRoute;
		if (route === undefined) {
			return undefined;
		}
		switch (this.routeSelection.kind) {
			case 'select-target':
				return { route, kind: 'selecting' };
			case 'complete':
				return {
					route,
					kind: 'complete',
					distance: this.routeSelection.distance,
				};
			case 'unreachable':
				return { route, kind: 'unreachable' };
			case 'idle':
			case 'select-source':
				return undefined;
		}
	}

	private updateStatus(): void {
		const presentation =
			this.statusPresenter?.update(this.model.status) ??
			presentLayoutStatus(this.model.status);
		this.toolbar?.setStatus(presentation);
	}

	private updateStateOverlay(): void {
		const overlay = this.stateOverlay;
		if (overlay === undefined) {
			return;
		}
		const status = presentLayoutStatus(this.model.status);
		const snapshot = this.model.snapshot;
		if (this.runtimeError !== undefined) {
			overlay.textContent = this.runtimeError;
			overlay.dataset.kind = 'error';
			overlay.hidden = false;
		} else if (
			snapshot === undefined &&
			(this.model.status.state.kind === 'initializing' ||
				this.model.status.state.kind === 'no-layout')
		) {
			overlay.textContent = status.text;
			overlay.dataset.kind =
				this.model.status.state.kind === 'initializing'
					? 'progress'
					: 'empty';
			overlay.hidden = false;
		} else if (snapshot !== undefined && snapshot.nodes.length === 0) {
			overlay.textContent = UI_STRINGS.noNotes;
			overlay.dataset.kind = 'empty';
			overlay.hidden = false;
		} else {
			overlay.hidden = true;
			delete overlay.dataset.kind;
		}
	}

	private changeSurfaceMode(mode: SurfaceMode): void {
		this.currentSettings = cloneSphericalGraphSettings(
			this.currentSettings,
		);
		this.currentSettings.appearance.surfaceMode = mode;
		this.renderer?.setSurfaceMode(mode);
		this.invoke(() =>
			this.options.callbacks.onSurfaceModeChange(mode),
		);
	}

	private changeContinentsVisibility(visible: boolean): void {
		this.currentSettings = cloneSphericalGraphSettings(
			this.currentSettings,
		);
		this.currentSettings.appearance.showContinents = visible;
		this.renderer?.updateAppearance(this.currentSettings.appearance);
		this.invoke(() =>
			this.options.callbacks.onContinentsVisibilityChange(visible),
		);
	}

	private invoke(callback: () => Promise<void> | void): void {
		void Promise.resolve()
			.then(callback)
			.catch((error: unknown) => {
				this.runtimeError = errorMessage(
					error,
					'The requested action failed.',
				);
				this.updateStateOverlay();
			});
	}
}

class RenewConfirmationModal extends Modal {
	constructor(
		app: App,
		private readonly onConfirm: () => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.empty();
		this.contentEl.classList.add('spherical-graph-renew-modal');
		this.contentEl.createEl('h2', {
			text: RENEW_CONFIRMATION_COPY.title,
		});
		this.contentEl.createEl('p', {
			text: RENEW_CONFIRMATION_COPY.body,
		});
		const actions = this.contentEl.createDiv();
		actions.className = 'spherical-graph-modal-actions';
		const cancel = actions.createEl('button');
		cancel.type = 'button';
		cancel.textContent = RENEW_CONFIRMATION_COPY.cancel;
		cancel.addEventListener('click', () => this.close());
		const renew = actions.createEl('button');
		renew.type = 'button';
		renew.className = 'mod-cta';
		renew.textContent = RENEW_CONFIRMATION_COPY.confirm;
		renew.addEventListener('click', () => {
			this.close();
			this.onConfirm();
		});
		actions.append(cancel, renew);
		this.contentEl.append(actions);
		renew.focus();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

function errorMessage(error: unknown, fallback: string): string {
	return error instanceof Error && error.message.length > 0
		? `${fallback} ${error.message}`
		: fallback;
}
