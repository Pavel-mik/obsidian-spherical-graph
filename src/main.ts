import {
	getAllTags,
	Notice,
	Plugin,
	TFile,
	TFolder,
	type WorkspaceLeaf,
} from 'obsidian';

import { VIEW_TYPE } from './constants';
import {
	GraphChangeTracker,
	type GraphChangeObservation,
} from './graph/GraphChangeTracker';
import {
	createObsidianGraphDataSource,
	GraphDataService,
} from './graph/GraphDataService';
import {
	diffGraphDescriptors,
	graphChangeRatio,
	type GraphDiff,
} from './graph/graphDiff';
import type { GraphData, GraphFilterOptions } from './graph/graphTypes';
import { UI_STRINGS } from './i18n';
import { createRenderGraphSnapshot } from './integration/renderSnapshot';
import {
	LayoutLifecycleController,
	type LayoutLifecycleView,
	type LayoutOperationRunner,
	type LayoutOperationSession,
} from './layout/LayoutLifecycleController';
import { SphericalLayoutPlanner } from './layout/SphericalLayoutPlanner';
import { LayoutSolverRunnerAdapter } from './layout/LayoutWorkerClient';
import {
	DEFAULT_CAMERA_STATE,
	type PersistedCameraState,
	type PersistedLayoutSnapshot,
} from './persistence/layoutState';
import { PluginDataStore } from './persistence/PluginDataStore';
import type {
	CameraState,
	RenderGraphSnapshot,
	RenderNode,
} from './render/renderTypes';
import {
	cloneSphericalGraphSettings,
	DEFAULT_SETTINGS,
	parseSphericalGraphSettings,
	SphericalGraphSettingTab,
	type SettingsChangeScope,
	type SphericalGraphSettings,
	type SurfaceMode,
} from './settings';
import {
	autoGlobeSizeForNodeCount,
	shouldAutoSizeGlobe,
} from './settings/autoGlobeSize';
import { SphericalGraphView } from './view/SphericalGraphView';
import type {
	ViewGraphDiffSummary,
	ViewLifecycleState,
	ViewStatusModel,
} from './view/viewTypes';

const COMMAND_IDS = {
	open: 'open-graph',
	refresh: 'refresh-layout',
	renew: 'renew-layout',
	cancel: 'cancel-calculation',
	resetCamera: 'reset-camera',
	search: 'focus-search',
	route: 'find-route',
	save: 'save-map',
	pin: 'toggle-pin',
	fullscreen: 'toggle-fullscreen',
} as const;

const CANCEL_NOTICE_DURATION_MS = 1_500;
const INITIAL_METADATA_TIMEOUT_MS = 30_000;

function graphFilters(
	settings: SphericalGraphSettings,
): Partial<GraphFilterOptions> {
	return {
		excludedFolderPrefixes: settings.data.excludedFolderPrefixes,
		// Orphans always remain in the committed layout. The graph-view toggle
		// only changes renderer visibility and never starts a solver.
		includeOrphans: true,
	};
}

function cameraForView(camera: PersistedCameraState): CameraState {
	return {
		position: [...camera.position],
		up: [...camera.up],
		target: [...camera.target],
	};
}

function isMarkdownFile(file: unknown): file is TFile {
	return file instanceof TFile && file.extension.toLowerCase() === 'md';
}

/**
 * Composes graph observation, fixed-layout lifecycle, persistence, the
 * short-lived worker, and the Obsidian view. Vault events never invoke the
 * solver directly.
 */
export default class SphericalGraphPlugin extends Plugin {
	private settings: SphericalGraphSettings =
		cloneSphericalGraphSettings(DEFAULT_SETTINGS);
	private dataStore!: PluginDataStore<SphericalGraphSettings>;
	private graphService!: GraphDataService;
	private graphTracker: GraphChangeTracker | undefined;
	private lifecycle: LayoutLifecycleController | undefined;
	private lifecycleView: LayoutLifecycleView = {
		state: { kind: 'no-layout' },
		activeWorkerCount: 0,
	};
	private unsubscribeLifecycle: (() => void) | undefined;
	private runtimePromise: Promise<void> | undefined;
	private currentGraph: GraphData | undefined;
	private currentDiff: GraphDiff | undefined;
	private renderSnapshot: RenderGraphSnapshot | undefined;
	private activeNodeId: string | undefined;
	private compatibilityMode = false;
	private transientCancelled = false;
	private cancelNoticeTimer: number | undefined;
	private runtimeFailure: string | undefined;
	private unloading = false;

	override async onload(): Promise<void> {
		this.dataStore = new PluginDataStore(
			{
				loadData: () => this.loadData(),
				saveData: (data) => this.saveData(data),
			},
			{
				defaultSettings: DEFAULT_SETTINGS,
				parseSettings: parseSphericalGraphSettings,
				defaultCamera: DEFAULT_CAMERA_STATE,
				saveDebounceMs: 300,
				onAsyncError: (error) => {
					this.reportError(
						error,
						'Could not save Spherical Graph data.',
					);
				},
			},
		);
		const persisted = await this.dataStore.load();
		this.settings = cloneSphericalGraphSettings(persisted.settings);
		this.graphService = new GraphDataService(
			createObsidianGraphDataSource(
				this.app.vault,
				this.app.metadataCache,
				(file) => {
					const cache =
						this.app.metadataCache.getFileCache(file);
					return cache === null
						? []
						: (getAllTags(cache) ?? []);
				},
			),
		);

		this.registerView(VIEW_TYPE, (leaf) => this.createView(leaf));
		this.addRibbonIcon('orbit', UI_STRINGS.openGraph, () => {
			void this.runAction(() => this.activateGraphView());
		});
		this.registerCommands();
		this.app.workspace.onLayoutReady(() => {
			if (!this.unloading) {
				this.registerGraphEvents();
			}
		});
		this.addSettingTab(
			new SphericalGraphSettingTab(this.app, this, {
				getSettings: () => this.settings,
				updateSettings: (settings, scope) =>
					this.updateSettings(settings, scope),
			}),
		);
	}

	override onunload(): void {
		this.unloading = true;
		if (this.cancelNoticeTimer !== undefined) {
			window.clearTimeout(this.cancelNoticeTimer);
			this.cancelNoticeTimer = undefined;
		}
		this.graphTracker?.dispose();
		this.graphTracker = undefined;
		this.unsubscribeLifecycle?.();
		this.unsubscribeLifecycle = undefined;
		this.lifecycle?.dispose();
		this.lifecycle = undefined;
		void this.dataStore
			.flushDebounced()
			.catch(() => undefined)
			.finally(() => this.dataStore.dispose());
	}

	private createView(leaf: WorkspaceLeaf): SphericalGraphView {
		const view = new SphericalGraphView(leaf, {
			getSettings: () => this.settings,
			initialCamera: cameraForView(this.dataStore.state.camera),
			callbacks: {
				onRefresh: () =>
					this.runAction(async () => {
						await this.ensureRuntime();
						if (!this.lifecycle?.startRefresh()) {
							new Notice('There are no pending changes to refresh.');
						}
					}),
				onRenew: () =>
					this.runAction(async () => {
						await this.ensureRuntime();
						if (!this.lifecycle?.startRenew()) {
							new Notice(
								'A layout calculation is already running.',
							);
						}
					}),
				onCancel: () => {
					if (this.lifecycle?.cancel()) {
						this.showCancelledNotice();
					}
				},
				onResetCamera: (camera) => {
					this.dataStore.scheduleCameraSave(camera);
				},
				onOpenFile: (node, openInNewLeaf) =>
					this.openFile(node, openInNewLeaf),
				onCameraChange: (camera) => {
					this.dataStore.scheduleCameraSave(camera);
				},
				onSurfaceModeChange: (mode) =>
					this.changeSurfaceMode(mode),
				onContinentsVisibilityChange: (visible) =>
					this.changeContinentsVisibility(visible),
				onAtmosphereVisibilityChange: (visible) =>
					this.changeAtmosphereVisibility(visible),
				onPinChange: (node, pinned) =>
					this.changePin(node, pinned),
				onManualSave: (camera) =>
					this.saveMap(camera),
				onClose: () => {
					window.setTimeout(() => {
						if (
							!this.unloading &&
							this.graphViews().length === 0
						) {
							this.lifecycle?.cancel();
						}
					}, 0);
				},
			},
		});
		this.pushViewModel(view);
		void this.ensureRuntime()
			.then(() => this.pushViewModel(view))
			.catch(() => undefined);
		return view;
	}

	private registerCommands(): void {
		this.addCommand({
			id: COMMAND_IDS.open,
			name: UI_STRINGS.openGraph,
			callback: () => {
				void this.runAction(() => this.activateGraphView());
			},
		});
		this.addCommand({
			id: COMMAND_IDS.refresh,
			name: UI_STRINGS.refreshLayout,
			checkCallback: (checking) => {
				const canRun =
					this.lifecycle === undefined ||
					this.lifecycle.state.kind === 'fixed-dirty';
				if (!checking && canRun) {
					void this.runAction(async () => {
						await this.ensureRuntime();
						if (!this.lifecycle?.startRefresh()) {
							new Notice(
								'There are no pending changes to refresh.',
							);
						}
					});
				}
				return canRun;
			},
		});
		this.addCommand({
			id: COMMAND_IDS.renew,
			name: UI_STRINGS.renewLayout,
			callback: () => {
				void this.runAction(async () => {
					const view = await this.activateGraphView();
					view.promptRenew();
				});
			},
		});
		this.addCommand({
			id: COMMAND_IDS.cancel,
			name: UI_STRINGS.cancelCalculation,
			checkCallback: (checking) => {
				const canRun =
					this.lifecycle?.activeWorkerCount === 1;
				if (!checking && canRun && this.lifecycle?.cancel()) {
					this.showCancelledNotice();
				}
				return canRun;
			},
		});
		this.addCommand({
			id: COMMAND_IDS.resetCamera,
			name: UI_STRINGS.resetCamera,
			checkCallback: (checking) => {
				const view = this.preferredView();
				if (!checking) {
					view?.resetCamera();
				}
				return view !== undefined;
			},
		});
		this.addCommand({
			id: COMMAND_IDS.search,
			name: 'Focus graph search',
			checkCallback: (checking) => {
				const view = this.preferredView();
				if (!checking) {
					view?.focusSearch();
				}
				return view !== undefined;
			},
		});
		this.addCommand({
			id: COMMAND_IDS.route,
			name: UI_STRINGS.findRoute,
			callback: () => {
				void this.runAction(async () => {
					const view = await this.activateGraphView();
					if (!view.toggleRouteSelection()) {
						new Notice(
							'At least two visible notes are required to find a route.',
						);
					}
				});
			},
		});
		this.addCommand({
			id: COMMAND_IDS.save,
			name: 'Save spherical map',
			checkCallback: (checking) => {
				const view = this.preferredView();
				if (!checking) {
					view?.saveMap();
				}
				return view !== undefined;
			},
		});
		this.addCommand({
			id: COMMAND_IDS.pin,
			name: 'Pin or unpin selected note',
			checkCallback: (checking) => {
				const view = this.preferredView();
				const canRun = view?.canToggleSelectedPin() ?? false;
				if (!checking && canRun) {
					view?.toggleSelectedPin();
				}
				return canRun;
			},
		});
		this.addCommand({
			id: COMMAND_IDS.fullscreen,
			name: 'Toggle fullscreen globe',
			callback: () => {
				const activeView = this.preferredView();
				if (activeView !== undefined) {
					activeView.toggleFullscreen();
					return;
				}
				void this.runAction(async () => {
					const view = await this.activateGraphView();
					view.toggleFullscreen();
				});
			},
		});
	}

	private registerGraphEvents(): void {
		this.registerEvent(
			this.app.vault.on('create', (file) => {
				if (isMarkdownFile(file)) {
					this.graphTracker?.markVaultChanged('create');
				}
			}),
		);
		this.registerEvent(
			this.app.vault.on('delete', (file) => {
				if (isMarkdownFile(file)) {
					this.graphTracker?.markVaultChanged('delete');
					this.removeDeletedPin(file.path);
				}
			}),
		);
		this.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => {
				if (file instanceof TFile) {
					this.migrateRenamedPins(oldPath, file.path, 'file');
				} else if (file instanceof TFolder) {
					this.migrateRenamedPins(oldPath, file.path, 'folder');
				}
				if (isMarkdownFile(file)) {
					this.graphTracker?.markRenamed(oldPath, file.path);
				}
			}),
		);
		this.registerEvent(
			this.app.metadataCache.on('changed', (file) => {
				if (isMarkdownFile(file)) {
					this.graphTracker?.markVaultChanged('metadata');
				}
			}),
		);
		this.registerEvent(
			this.app.metadataCache.on('resolved', () => {
				this.graphTracker?.markVaultChanged('resolved-links');
			}),
		);
		this.registerEvent(
			this.app.workspace.on('file-open', (file) => {
				const path = isMarkdownFile(file) ? file.path : undefined;
				this.graphTracker?.markActiveFileChanged(path);
				if (this.graphTracker === undefined) {
					this.setActiveNode(path);
				}
			}),
		);
	}

	private async activateGraphView(): Promise<SphericalGraphView> {
		const activeView =
			this.app.workspace.getActiveViewOfType(SphericalGraphView);
		const existing =
			activeView?.leaf ??
			this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
		const leaf = existing ?? this.app.workspace.getLeaf('tab');
		if (existing === undefined) {
			await leaf.setViewState({
				type: VIEW_TYPE,
				active: true,
			});
		}
		await this.app.workspace.revealLeaf(leaf);
		await this.ensureRuntime();
		const view = leaf.view;
		if (!(view instanceof SphericalGraphView)) {
			throw new Error('Could not open the Spherical Graph view.');
		}
		this.pushViewModel(view);
		return view;
	}

	private firstView(): SphericalGraphView | undefined {
		return this.graphViews()[0];
	}

	private preferredView(): SphericalGraphView | undefined {
		return (
			this.app.workspace.getActiveViewOfType(SphericalGraphView) ??
			this.firstView()
		);
	}

	private graphViews(): SphericalGraphView[] {
		return this.app.workspace
			.getLeavesOfType(VIEW_TYPE)
			.map((leaf) => leaf.view)
			.filter(
				(view): view is SphericalGraphView =>
					view instanceof SphericalGraphView,
			);
	}

	private ensureRuntime(): Promise<void> {
		this.runtimePromise ??= this.initializeRuntime().catch(
			(error: unknown) => {
				this.reportError(
					error,
					'Could not initialize Spherical Graph.',
					true,
				);
				throw error;
			},
		);
		return this.runtimePromise;
	}

	private async initializeRuntime(): Promise<void> {
		await this.waitForWorkspaceReady();
		if (this.unloading) {
			return;
		}
		await this.waitForInitialMetadataResolution();
		if (this.unloading) {
			return;
		}
		this.currentGraph = this.graphService.buildGraph(
			graphFilters(this.settings),
		);
		const planner = new SphericalLayoutPlanner(() => this.settings);
		const solverRunner = new LayoutSolverRunnerAdapter();
		const runner: LayoutOperationRunner = {
			start: (input, onMessage): LayoutOperationSession => {
				const handle = solverRunner.start(input, onMessage);
				this.compatibilityMode =
					handle.executionMode === 'fallback';
				queueMicrotask(() => this.broadcastStatus());
				return {
					cancel: (operationId) => handle.cancel(operationId),
					dispose: () => handle.dispose(),
				};
			},
			dispose: () => solverRunner.dispose(),
		};
		const sink = {
			restore: (
				snapshot: PersistedLayoutSnapshot,
				graph: GraphData,
			) => this.applyCommittedSnapshot(snapshot, graph),
			commit: (
				snapshot: PersistedLayoutSnapshot,
				graph: GraphData,
			) => this.applyCommittedSnapshot(snapshot, graph, [], true),
			updateVisibleGraph: (
				snapshot: PersistedLayoutSnapshot,
				graph: GraphData,
				diff?: GraphDiff,
			) =>
				this.applyCommittedSnapshot(
					snapshot,
					graph,
					diff?.renamedNodes,
				),
		};

		const lifecycle = new LayoutLifecycleController({
			planner,
			runner,
			persistence: this.dataStore,
			sink,
			getBaseSeed: () => this.settings.layout.baseSeed,
		});
		this.lifecycle = lifecycle;
		this.unsubscribeLifecycle = lifecycle.subscribe((view) => {
			this.lifecycleView = view;
			this.reconcileCurrentDiff();
			this.broadcastStatus();
		});
		this.createGraphTracker();
		lifecycle.open(
			this.currentGraph,
			this.dataStore.committedSnapshot,
		);
		const active = this.app.workspace.getActiveFile();
		this.setActiveNode(active?.path);
	}

	private async waitForWorkspaceReady(): Promise<void> {
		if (this.app.workspace.layoutReady) {
			return;
		}
		await new Promise<void>((resolve) => {
			this.app.workspace.onLayoutReady(resolve);
		});
	}

	private async waitForInitialMetadataResolution(): Promise<void> {
		const markdownCount = this.app.vault.getMarkdownFiles().length;
		const resolvedSourceCount = Object.keys(
			this.app.metadataCache.resolvedLinks,
		).length;
		if (
			markdownCount === 0 ||
			resolvedSourceCount >= markdownCount
		) {
			return;
		}

		await new Promise<void>((resolve) => {
			let settled = false;
			let timeout: number | undefined;
			const finish = (): void => {
				if (settled) {
					return;
				}
				settled = true;
				if (timeout !== undefined) {
					window.clearTimeout(timeout);
				}
				this.app.metadataCache.offref(eventRef);
				resolve();
			};
			const eventRef = this.app.metadataCache.on(
				'resolved',
				finish,
			);
			timeout = window.setTimeout(
				finish,
				INITIAL_METADATA_TIMEOUT_MS,
			);
		});
	}

	private createGraphTracker(): void {
		this.graphTracker?.dispose();
		this.graphTracker = new GraphChangeTracker({
			graphService: this.graphService,
			getFilters: () => graphFilters(this.settings),
			getCommittedDescriptor: () =>
				this.lifecycle?.committedSnapshot?.graphDescriptor,
			getCommittedSignature: () =>
				this.lifecycle?.committedSnapshot?.graphSignature,
			onDiff: (observation) =>
				this.handleGraphObservation(observation),
			onObservation: (observation) =>
				this.handleGraphObservation(observation),
			onActiveFileChange: (path) => this.setActiveNode(path),
			debounceMs: this.settings.data.graphChangeDebounceMs,
			onError: (error) => {
				this.reportError(
					error,
					'Could not update the vault graph.',
				);
			},
		});
	}

	private async handleGraphObservation(
		observation: GraphChangeObservation,
	): Promise<void> {
		this.currentGraph = observation.graph;
		this.currentDiff = observation.diff;
		const committedSnapshot = this.lifecycle?.committedSnapshot;
		if (committedSnapshot !== undefined) {
			this.renderSnapshot = createRenderGraphSnapshot(
				committedSnapshot,
				observation.graph,
				observation.diff.renamedNodes,
			);
			for (const view of this.graphViews()) {
				view.setSnapshot(this.renderSnapshot);
			}
		}
		await this.lifecycle?.markGraphChanged(
			observation.graph,
			observation.diff,
		);
		this.broadcastPinnedNotes();
		this.broadcastStatus();
	}

	private applyCommittedSnapshot(
		snapshot: PersistedLayoutSnapshot,
		graph: GraphData,
		renames: GraphDiff['renamedNodes'] = [],
		autoSize = false,
	): void {
		this.currentGraph = graph;
		if (
			autoSize &&
			shouldAutoSizeGlobe(snapshot.modeThatCreatedIt)
		) {
			const globeSize = autoGlobeSizeForNodeCount(
				graph.nodes.length,
			);
			if (globeSize !== this.settings.appearance.globeSize) {
				const next = cloneSphericalGraphSettings(this.settings);
				next.appearance.globeSize = globeSize;
				this.settings = parseSphericalGraphSettings(next);
				this.dataStore.scheduleSettingsSave(this.settings);
				for (const view of this.graphViews()) {
					view.updateSettings(this.settings);
				}
			}
		}
		this.renderSnapshot = createRenderGraphSnapshot(
			snapshot,
			graph,
			renames,
		);
		this.reconcileCurrentDiff(snapshot);
		for (const view of this.graphViews()) {
			view.setSnapshot(this.renderSnapshot);
		}
		this.broadcastStatus();
	}

	private reconcileCurrentDiff(
		snapshot = this.lifecycle?.committedSnapshot,
	): void {
		const graph = this.currentGraph;
		if (snapshot === undefined || graph === undefined) {
			return;
		}
		if (
			this.lifecycleView.state.kind === 'fixed-clean' ||
			this.lifecycleView.state.kind === 'fixed-dirty'
		) {
			this.currentDiff = diffGraphDescriptors(
				snapshot.graphDescriptor,
				graph.descriptor,
				graph.signature,
				[],
				snapshot.graphSignature,
			);
		}
	}

	private buildStatus(): ViewStatusModel {
		const graph = this.currentGraph;
		return {
			state: this.buildViewState(),
			nodeCount: graph?.nodes.length ?? 0,
			edgeCount: graph?.edges.length ?? 0,
			continentCount:
				this.renderSnapshot?.geography?.continents.length ?? 0,
			progress:
				this.lifecycleView.progress === undefined
					? undefined
					: {
							phase: this.lifecycleView.progress.phase,
							iteration:
								this.lifecycleView.progress.iteration,
							maxAngularDisplacement:
								this.lifecycleView.progress
									.maxAngularDisplacement,
							elapsedMs:
								this.lifecycleView.progress.elapsedMs,
						},
			compatibilityMode:
				this.compatibilityMode &&
				this.lifecycleView.activeWorkerCount === 1,
			transientNotice: this.transientCancelled
				? 'cancelled'
				: undefined,
		};
	}

	private buildViewState(): ViewLifecycleState {
		const state = this.lifecycleView.state;
		if (state.kind !== 'fixed-dirty') {
			return state;
		}
		const summary: ViewGraphDiffSummary = {
			...state.diff,
			largeChangeWarning: this.isLargePendingChange(),
		};
		return {
			...state,
			diff: summary,
		};
	}

	private isLargePendingChange(): boolean {
		const graph = this.currentGraph;
		const diff = this.currentDiff;
		const snapshot = this.lifecycle?.committedSnapshot;
		if (
			graph === undefined ||
			diff === undefined ||
			snapshot === undefined
		) {
			return false;
		}
		return (
			graphChangeRatio(
				diff,
				snapshot.graphDescriptor,
				graph.descriptor,
			) >= this.settings.refresh.largeChangeWarningRatio
		);
	}

	private broadcastStatus(): void {
		const status = this.buildStatus();
		for (const view of this.graphViews()) {
			view.setStatus(status);
		}
	}

	private pushViewModel(view: SphericalGraphView): void {
		view.setModel({
			snapshot: this.renderSnapshot,
			status: this.runtimeFailure
				? {
						state: {
							kind: 'error',
							message: this.runtimeFailure,
						},
						nodeCount: this.currentGraph?.nodes.length ?? 0,
						edgeCount: this.currentGraph?.edges.length ?? 0,
					}
				: this.buildStatus(),
			activeNodeId: this.activeNodeId,
			pinnedNodeIds: this.dataStore.pinnedNotePaths,
		});
	}

	private setActiveNode(path: string | undefined): void {
		this.activeNodeId = path;
		for (const view of this.graphViews()) {
			view.setActiveNode(path);
		}
	}

	private async updateSettings(
		settings: SphericalGraphSettings,
		scope: SettingsChangeScope,
	): Promise<void> {
		this.settings = parseSphericalGraphSettings(settings);
		this.dataStore.scheduleSettingsSave(this.settings);
		for (const view of this.graphViews()) {
			view.updateSettings(this.settings);
		}
		if (scope === 'data' && this.lifecycle !== undefined) {
			this.createGraphTracker();
			this.graphTracker?.markVaultChanged('filter');
			await this.graphTracker?.flush();
		}
	}

	private changeSurfaceMode(mode: SurfaceMode): void {
		const next = cloneSphericalGraphSettings(this.settings);
		next.appearance.surfaceMode = mode;
		void this.updateSettings(next, 'appearance');
	}

	private changeContinentsVisibility(visible: boolean): void {
		const next = cloneSphericalGraphSettings(this.settings);
		next.appearance.showContinents = visible;
		void this.updateSettings(next, 'appearance');
	}

	private changeAtmosphereVisibility(visible: boolean): void {
		const next = cloneSphericalGraphSettings(this.settings);
		next.appearance.showAtmosphere = visible;
		void this.updateSettings(next, 'appearance');
	}

	private async changePin(
		node: RenderNode,
		pinned: boolean,
	): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(node.path);
		if (!(file instanceof TFile) || file.extension.toLowerCase() !== 'md') {
			throw new Error(`The note "${node.path}" no longer exists.`);
		}
		await this.dataStore.setPinnedNotePath(file.path, pinned);
		this.broadcastPinnedNotes();
	}

	private async saveMap(camera: CameraState): Promise<void> {
		this.dataStore.scheduleCameraSave(camera);
		await this.dataStore.saveNow();
		new Notice('Spherical map saved.');
	}

	private broadcastPinnedNotes(): void {
		const pinned = this.dataStore.pinnedNotePaths;
		for (const view of this.graphViews()) {
			view.setPinnedNodeIds(pinned);
		}
	}

	private migrateRenamedPins(
		oldPath: string,
		newPath: string,
		scope: 'file' | 'folder',
	): void {
		void this.dataStore
			.renamePinnedNotePathsFromVault(oldPath, newPath, scope)
			.then(() => this.broadcastPinnedNotes())
			.catch((error: unknown) => {
				this.reportError(
					error,
					'Could not update pinned notes after rename.',
				);
			});
	}

	private removeDeletedPin(path: string): void {
		void this.dataStore
			.setPinnedNotePath(path, false)
			.then(() => this.broadcastPinnedNotes())
			.catch((error: unknown) => {
				this.reportError(
					error,
					'Could not update pinned notes after deletion.',
				);
			});
	}

	private async openFile(
		node: RenderNode,
		openInNewLeaf: boolean,
	): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(node.path);
		if (!(file instanceof TFile)) {
			throw new Error(`The note "${node.path}" no longer exists.`);
		}
		await this.app.workspace.getLeaf(openInNewLeaf).openFile(file);
	}

	private showCancelledNotice(): void {
		this.transientCancelled = true;
		this.broadcastStatus();
		if (this.cancelNoticeTimer !== undefined) {
			window.clearTimeout(this.cancelNoticeTimer);
		}
		this.cancelNoticeTimer = window.setTimeout(() => {
			this.cancelNoticeTimer = undefined;
			this.transientCancelled = false;
			this.broadcastStatus();
		}, CANCEL_NOTICE_DURATION_MS);
	}

	private async runAction(
		action: () => unknown,
	): Promise<void> {
		try {
			await action();
		} catch (error: unknown) {
			this.reportError(error, 'Spherical Graph action failed.');
		}
	}

	private reportError(
		error: unknown,
		fallback: string,
		fatal = false,
	): void {
		const detail =
			error instanceof Error && error.message.length > 0
				? error.message
				: fallback;
		if (fatal) {
			this.runtimeFailure = detail;
		}
		new Notice(`${fallback} ${detail === fallback ? '' : detail}`.trim());
		if (fatal) {
			for (const view of this.graphViews()) {
				this.pushViewModel(view);
			}
		}
	}
}
