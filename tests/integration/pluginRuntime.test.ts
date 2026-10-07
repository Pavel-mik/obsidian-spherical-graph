import type { App, PluginManifest } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import { GraphChangeTracker } from '../../src/graph/GraphChangeTracker';
import { GraphDataService } from '../../src/graph/GraphDataService';
import type { GraphDataWorkerClient } from '../../src/graph/GraphDataWorkerClient';
import type { LayoutLifecycleController } from '../../src/layout/LayoutLifecycleController';
import { PluginDataStore } from '../../src/persistence/PluginDataStore';
import { createCommittedLayoutSnapshot, CURRENT_SCHEMA_VERSION } from '../../src/persistence/layoutState';
import { DEFAULT_SETTINGS, type SphericalGraphSettings } from '../../src/settings/settings';

vi.mock('obsidian', () => {
	class Base {}
	class Plugin {
		constructor(readonly app: unknown) {}
		registerEvent(): void {}
	}
	class TFile {
		extension = 'md';
		constructor(readonly path: string) {}
	}
	class TFolder {
		constructor(readonly path: string) {}
	}
	return { Plugin, TFile, TFolder, PluginSettingTab: Base, ItemView: Base, Modal: Base, Scope: Base, Notice: Base };
});

import SphericalGraphPlugin from '../../src/main';
import { TFile, TFolder } from 'obsidian';

interface Runtime {
	registerGraphEvents(): void;
	initializeRuntime(): Promise<void>;
	loadMap(): Promise<void>;
	disposeGraphTracker(): void;
	migrateRenamedPins: (...args: unknown[]) => void;
	graphTracker?: GraphChangeTracker;
	graphService: GraphDataService;
	graphWorker: GraphDataWorkerClient;
	dataStore: PluginDataStore<SphericalGraphSettings>;
	lifecycle?: LayoutLifecycleController;
}

function runtimeHarness() {
	const events = new Map<string, (...args: unknown[]) => void>();
	const listen = (prefix: string) => (name: string, callback: (...args: unknown[]) => void) => events.set(`${prefix}:${name}`, callback);
	const app = {
		vault: { on: listen('vault'), getMarkdownFiles: () => [{ path: 'a.md' }] },
		metadataCache: { on: listen('metadata'), offref: vi.fn(), resolvedLinks: { 'a.md': {} } },
		workspace: { on: listen('workspace'), layoutReady: true, getLeavesOfType: () => [], getActiveFile: () => null },
	};
	const plugin = new SphericalGraphPlugin(app as unknown as App, {} as PluginManifest);
	return { plugin, runtime: plugin as unknown as Runtime, events };
}

describe('plugin runtime wiring', () => {
	it('rebuilds after resolved even if the earlier metadata event has already been consumed', async () => {
		const { runtime, events } = runtimeHarness();
		let links: Record<string, Record<string, number>> = {};
		const service = new GraphDataService({ getMarkdownFiles: () => ['a.md', 'b.md'].map((path) => ({ path, basename: path })), getResolvedLinks: () => links });
		const saved = service.buildGraph();
		const observed = vi.fn();
		const tracker = new GraphChangeTracker({ graphService: service, getFilters: () => ({}), getCommittedDescriptor: () => saved.descriptor, onDiff: observed, onObservation: observed, debounceMs: 100, scheduler: { set: () => 1, clear: () => {} } });
		runtime.graphTracker = tracker;
		runtime.registerGraphEvents();
		const file = Object.assign(new TFile(), { path: 'a.md' });
		events.get('metadata:changed')?.(file);
		await tracker.flush();
		expect(tracker.hasQueuedGraphChange).toBe(false);
		links = { 'a.md': { 'b.md': 1 } };
		events.get('metadata:resolved')?.();
		const result = await tracker.flush();
		expect(result?.graph.edges).toHaveLength(1);
		expect(observed).toHaveBeenCalledTimes(2);
		tracker.dispose();
	});

	it('routes folder rename events to the graph as well as pinned notes', () => {
		const { runtime, events } = runtimeHarness();
		const tracker = { markRenamed: vi.fn() };
		runtime.graphTracker = tracker as unknown as GraphChangeTracker;
		runtime.migrateRenamedPins = vi.fn();
		runtime.registerGraphEvents();
		events.get('vault:rename')?.(Object.assign(new TFolder(), { path: 'New' }), 'Old');
		expect(tracker.markRenamed).toHaveBeenCalledWith('Old', 'New', 'folder');
	});

	it('reindexes a compacted map at startup and Load map without starting a layout', async () => {
		const { runtime } = runtimeHarness();
		const service = new GraphDataService({ getMarkdownFiles: () => [{ path: 'a.md', basename: 'A', tags: ['#restored'] }], getResolvedLinks: () => ({}) });
		const graph = service.buildGraph();
		const snapshot = createCommittedLayoutSnapshot({ graph, snapshotId: 'saved', mode: 'initialize', positions: new Float32Array([1, 0, 0]), effectiveSeed: 1, renewGeneration: 0, completedAt: 1 });
		if (snapshot === undefined) throw new Error('Invalid fixture');
		const raw = { schemaVersion: CURRENT_SCHEMA_VERSION, settings: DEFAULT_SETTINGS, committedLayout: snapshot, graphCache: null };
		runtime.dataStore = new PluginDataStore({ loadData: async () => raw, saveData: vi.fn() }, { defaultSettings: DEFAULT_SETTINGS });
		await runtime.dataStore.load();
		runtime.graphService = service;
		const build = vi.spyOn(runtime.graphWorker, 'build').mockResolvedValue(graph);
		await runtime.initializeRuntime();
		expect(build).toHaveBeenCalledOnce();
		expect(runtime.lifecycle?.state.kind).toBe('fixed-clean');
		expect(runtime.lifecycle?.isBusy).toBe(false);
		expect(runtime.lifecycle?.committedSnapshot?.positionsByPath).toEqual(snapshot.positionsByPath);
		await runtime.loadMap();
		expect(build).toHaveBeenCalledTimes(2);
		expect(runtime.lifecycle?.isBusy).toBe(false);
		expect(runtime.lifecycle?.committedSnapshot?.positionsByPath).toEqual(snapshot.positionsByPath);
		runtime.disposeGraphTracker();
		runtime.lifecycle?.dispose();
		runtime.dataStore.dispose();
	});
});
