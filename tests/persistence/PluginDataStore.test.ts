import { afterEach, describe, expect, it, vi } from "vitest";

import { GraphDataService } from "../../src/graph/GraphDataService";
import { GraphDataSource } from "../../src/graph/graphTypes";
import {
	deepMergeValidated,
	PersistenceScheduler,
	PluginDataAdapter,
	PluginDataStore,
} from "../../src/persistence/PluginDataStore";
import {
	createCommittedLayoutSnapshot,
	PersistedPluginData,
} from "../../src/persistence/layoutState";

interface TestSettings {
	readonly enabled: boolean;
	readonly nested: {
		readonly count: number;
		readonly label: string;
	};
	readonly excluded: readonly string[];
}

const DEFAULT_SETTINGS: TestSettings = {
	enabled: true,
	nested: {
		count: 5,
		label: "default",
	},
	excluded: [],
};

class MemoryAdapter implements PluginDataAdapter {
	raw: unknown;
	readonly saves: unknown[] = [];
	failNextSave = false;

	constructor(raw?: unknown) {
		this.raw = raw;
	}

	async loadData(): Promise<unknown> {
		return this.raw;
	}

	async saveData(data: unknown): Promise<void> {
		if (this.failNextSave) {
			this.failNextSave = false;
			throw new Error("disk failure");
		}
		this.raw = data;
		this.saves.push(data);
	}
}

class ManualScheduler implements PersistenceScheduler {
	private now = 0;
	private nextId = 1;
	private readonly tasks = new Map<
		number,
		{ readonly due: number; readonly callback: () => void }
	>();

	set(callback: () => void, delayMs: number): unknown {
		const id = this.nextId;
		this.nextId += 1;
		this.tasks.set(id, { due: this.now + delayMs, callback });
		return id;
	}

	clear(handle: unknown): void {
		if (typeof handle === "number") {
			this.tasks.delete(handle);
		}
	}

	advance(milliseconds: number): void {
		this.now += milliseconds;
		const due = [...this.tasks.entries()]
			.filter(([, task]) => task.due <= this.now)
			.sort((left, right) => left[1].due - right[1].due);
		for (const [id, task] of due) {
			this.tasks.delete(id);
			task.callback();
		}
	}
}

function createGraph(paths: readonly string[]) {
	const source: GraphDataSource = {
		getMarkdownFiles: () =>
			paths.map((path) => ({
				path,
				basename: path.replace(/\.md$/, ""),
			})),
		getResolvedLinks: () => ({}),
	};
	return new GraphDataService(source).buildGraph();
}

function createStore(
	adapter: MemoryAdapter,
	scheduler?: PersistenceScheduler,
) {
	return new PluginDataStore(adapter, {
		defaultSettings: DEFAULT_SETTINGS,
		saveDebounceMs: 50,
		scheduler,
	});
}

afterEach(() => {
	vi.useRealTimers();
});

describe("PluginDataStore loading", () => {
	it("uses defaults for empty plugin data", async () => {
		const store = createStore(new MemoryAdapter());
		const loaded = await store.load();
		expect(loaded.settings).toEqual(DEFAULT_SETTINGS);
		expect(loaded.committedLayout).toBeNull();
		expect(loaded.camera.position).toEqual([0, 0, 3]);
		expect(loaded.pinnedNotePaths).toEqual([]);
	});

	it("deeply merges persisted settings and validates primitive values", async () => {
		const store = createStore(
			new MemoryAdapter({
				schemaVersion: 2,
				settings: {
					enabled: false,
					nested: {
						count: Number.NaN,
						label: "custom",
					},
					excluded: ["private"],
				},
			}),
		);
		const loaded = await store.load();
		expect(loaded.settings).toEqual({
			enabled: false,
			nested: { count: 5, label: "custom" },
			excluded: ["private"],
		});
		expect(
			deepMergeValidated(DEFAULT_SETTINGS, {
				nested: { count: "invalid" },
			}),
		).toEqual(DEFAULT_SETTINGS);
	});

	it("migrates a version-one envelope and snapshot field names", async () => {
		const currentGraph = createGraph(["a.md"]);
		const snapshot = createCommittedLayoutSnapshot({
			snapshotId: "legacy",
			graph: currentGraph,
			mode: "initialize",
			effectiveSeed: 7,
			renewGeneration: 0,
			completedAt: 1,
			positions: new Float32Array([1, 0, 0]),
		});
		if (snapshot === undefined) {
			throw new Error("Expected snapshot.");
		}
		const legacySnapshot = {
			...snapshot,
			schemaVersion: 1,
			positions: snapshot.positionsByPath,
			positionsByPath: undefined,
		};
		const store = createStore(
			new MemoryAdapter({
				schemaVersion: 1,
				settings: { enabled: false },
				layoutSnapshot: legacySnapshot,
				pins: ["notes\\pinned.md", "notes/pinned.md"],
				cameraState: {
					position: [0, 0, 5],
					up: [0, 1, 0],
					target: [0, 0, 0],
				},
			}),
		);
		const loaded = await store.load();
		expect(loaded.committedLayout?.snapshotId).toBe("legacy");
		expect(loaded.settings.enabled).toBe(false);
		expect(loaded.camera.position).toEqual([0, 0, 5]);
		expect(loaded.pinnedNotePaths).toEqual(["notes/pinned.md"]);
	});

	it("discards the whole committed snapshot when any position is invalid", async () => {
		const currentGraph = createGraph(["a.md"]);
		const snapshot = createCommittedLayoutSnapshot({
			snapshotId: "bad",
			graph: currentGraph,
			mode: "initialize",
			effectiveSeed: 1,
			renewGeneration: 0,
			completedAt: 1,
			positions: new Float32Array([1, 0, 0]),
		});
		const store = createStore(
			new MemoryAdapter({
				schemaVersion: 2,
				settings: DEFAULT_SETTINGS,
				committedLayout: {
					...snapshot,
					positionsByPath: { "a.md": [0, 0, 0] },
				},
			}),
		);
		expect((await store.load()).committedLayout).toBeNull();
	});
});

describe("PluginDataStore transactional writes", () => {
	it("does not save an invalid completed result", async () => {
		const adapter = new MemoryAdapter();
		const store = createStore(adapter);
		await store.load();
		const result = await store.commitCompletedResult({
			graph: createGraph(["a.md"]),
			mode: "initialize",
			operationId: "invalid",
			effectiveSeed: 1,
			completedAt: 1,
			positions: new Float32Array([Number.NaN, 0, 0]),
			expectedSnapshotId: null,
		});
		expect(result).toBeUndefined();
		expect(adapter.saves).toHaveLength(0);
		expect(store.committedSnapshot).toBeUndefined();
	});

	it("commits a valid completed result in exactly one logical save", async () => {
		const adapter = new MemoryAdapter();
		const store = createStore(adapter);
		await store.load();
		const result = await store.commitCompletedResult({
			graph: createGraph(["a.md", "b.md"]),
			mode: "initialize",
			operationId: "one",
			effectiveSeed: 1,
			completedAt: 1,
			positions: new Float32Array([1, 0, 0, 0, 1, 0]),
			expectedSnapshotId: null,
		});
		expect(result?.snapshotId).toBe("layout-one");
		expect(adapter.saves).toHaveLength(1);
		expect(store.committedSnapshot).toBe(result);
	});

	it("can atomically initialize over a known unusable snapshot id", async () => {
		const adapter = new MemoryAdapter();
		const store = createStore(adapter);
		await store.load();
		const original = await store.commitCompletedResult({
			graph: createGraph(["old.md"]),
			mode: "initialize",
			operationId: "old",
			effectiveSeed: 1,
			completedAt: 1,
			positions: new Float32Array([1, 0, 0]),
			expectedSnapshotId: null,
		});
		const replacement = await store.commitCompletedResult({
			graph: createGraph(["new.md"]),
			mode: "initialize",
			operationId: "replacement",
			effectiveSeed: 2,
			completedAt: 2,
			positions: new Float32Array([0, 1, 0]),
			expectedSnapshotId: original?.snapshotId ?? null,
		});
		expect(replacement?.snapshotId).toBe("layout-replacement");
		expect(store.committedSnapshot).toBe(replacement);
		expect(adapter.saves).toHaveLength(2);
	});

	it("increments renew generation only after a successful renew commit", async () => {
		const adapter = new MemoryAdapter();
		const store = createStore(adapter);
		await store.load();
		const initial = await store.commitCompletedResult({
			graph: createGraph(["a.md"]),
			mode: "initialize",
			operationId: "initial",
			effectiveSeed: 1,
			completedAt: 1,
			positions: new Float32Array([1, 0, 0]),
			expectedSnapshotId: null,
		});
		const failed = await store.commitCompletedResult({
			graph: createGraph(["a.md"]),
			mode: "renew",
			operationId: "failed",
			effectiveSeed: 2,
			completedAt: 2,
			positions: new Float32Array([0, 0, 0]),
			expectedSnapshotId: initial?.snapshotId ?? null,
		});
		expect(failed).toBeUndefined();
		expect(store.committedSnapshot?.renewGeneration).toBe(0);

		const renewed = await store.commitCompletedResult({
			graph: createGraph(["a.md"]),
			mode: "renew",
			operationId: "renewed",
			effectiveSeed: 2,
			completedAt: 3,
			positions: new Float32Array([0, 1, 0]),
			expectedSnapshotId: initial?.snapshotId ?? null,
		});
		expect(renewed?.renewGeneration).toBe(1);
	});

	it("leaves in-memory committed state untouched when atomic save fails", async () => {
		const adapter = new MemoryAdapter();
		const store = createStore(adapter);
		await store.load();
		adapter.failNextSave = true;
		await expect(
			store.commitCompletedResult({
				graph: createGraph(["a.md"]),
				mode: "initialize",
				operationId: "failure",
				effectiveSeed: 1,
				completedAt: 1,
				positions: new Float32Array([1, 0, 0]),
				expectedSnapshotId: null,
			}),
		).rejects.toThrow("disk failure");
		expect(store.committedSnapshot).toBeUndefined();
	});

	it("renames and prunes persisted paths through controlled atomic saves", async () => {
		const adapter = new MemoryAdapter();
		const store = createStore(adapter);
		await store.load();
		const initial = await store.commitCompletedResult({
			graph: createGraph(["a.md", "b.md"]),
			mode: "initialize",
			operationId: "initial",
			effectiveSeed: 1,
			completedAt: 1,
			positions: new Float32Array([1, 0, 0, 0, 1, 0]),
			expectedSnapshotId: null,
		});
		await store.renameCommittedPaths([
			{ oldPath: "a.md", newPath: "renamed.md" },
		]);
		expect(store.committedSnapshot?.positionsByPath["renamed.md"]).toEqual(
			initial?.positionsByPath["a.md"],
		);
		await store.pruneCommittedPaths(new Set(["renamed.md"]));
		expect(store.committedSnapshot?.graphDescriptor.nodeIds).toEqual([
			"renamed.md",
		]);
		expect(adapter.saves).toHaveLength(3);
	});

	it("keeps pins in the canonical envelope and follows rename/delete events", async () => {
		const adapter = new MemoryAdapter();
		const store = createStore(adapter);
		await store.load();
		await store.savePinnedNotePaths([
			"folder\\old.md",
			"folder/peer.md",
		]);
		expect(store.pinnedNotePaths).toEqual([
			"folder/old.md",
			"folder/peer.md",
		]);

		await store.renameCommittedPaths([
			{
				oldPath: "folder/old.md",
				newPath: "folder/renamed.md",
			},
		]);
		expect(store.pinnedNotePaths).toEqual([
			"folder/peer.md",
			"folder/renamed.md",
		]);

		await store.pruneCommittedPaths(
			new Set(["folder/renamed.md"]),
		);
		expect(store.pinnedNotePaths).toEqual(["folder/renamed.md"]);
		expect(
			(
				adapter.saves.at(-1) as
					| PersistedPluginData<TestSettings>
					| undefined
			)?.pinnedNotePaths,
		).toEqual(["folder/renamed.md"]);
	});

	it("toggles a pin and ignores an unsafe path", async () => {
		const adapter = new MemoryAdapter();
		const store = createStore(adapter);
		await store.load();
		await store.togglePinnedNotePath("folder\\note.md");
		expect(store.pinnedNotePaths).toEqual(["folder/note.md"]);
		await store.togglePinnedNotePath("folder/note.md");
		expect(store.pinnedNotePaths).toEqual([]);
		await store.togglePinnedNotePath("../outside.md");
		expect(store.pinnedNotePaths).toEqual([]);
		expect(adapter.saves).toHaveLength(2);
	});

	it("atomically migrates an exact file pin without a committed layout", async () => {
		const adapter = new MemoryAdapter();
		const store = createStore(adapter);
		await store.load();
		await store.savePinnedNotePaths([
			"Folder/old.md",
			"Folder/new.md",
			"Folder/other.md",
		]);
		const saveCount = adapter.saves.length;

		const pins = await store.renamePinnedNotePathsFromVault(
			"Folder/old.md",
			"Folder/new.md",
			"file",
		);

		expect(pins).toEqual([
			"Folder/new.md",
			"Folder/other.md",
		]);
		expect(store.committedSnapshot).toBeUndefined();
		expect(adapter.saves).toHaveLength(saveCount + 1);
		expect(
			(
				adapter.saves.at(-1) as
					| PersistedPluginData<TestSettings>
					| undefined
			)?.pinnedNotePaths,
		).toEqual(pins);
	});

	it("atomically migrates every descendant pin for a folder rename", async () => {
		const adapter = new MemoryAdapter();
		const store = createStore(adapter);
		await store.load();
		await store.savePinnedNotePaths([
			"Old/a.md",
			"Old/sub/b.md",
			"Oldish/c.md",
			"New/a.md",
		]);
		const saveCount = adapter.saves.length;

		const pins = await store.renamePinnedNotePathsFromVault(
			"Old",
			"New",
			"folder",
		);

		expect(pins).toEqual([
			"New/a.md",
			"New/sub/b.md",
			"Oldish/c.md",
		]);
		expect(adapter.saves).toHaveLength(saveCount + 1);
	});

	it("keeps pin state untouched when a vault-rename save fails", async () => {
		const adapter = new MemoryAdapter();
		const store = createStore(adapter);
		await store.load();
		await store.savePinnedNotePaths(["Old/note.md"]);
		adapter.failNextSave = true;

		await expect(
			store.renamePinnedNotePathsFromVault(
				"Old/note.md",
				"New/note.md",
				"file",
			),
		).rejects.toThrow("disk failure");
		expect(store.pinnedNotePaths).toEqual(["Old/note.md"]);
	});

	it("serializes concurrent desired pin mutations without losing either pin", async () => {
		const adapter = new MemoryAdapter();
		const store = createStore(adapter);
		await store.load();

		await Promise.all([
			store.setPinnedNotePath("A.md", true),
			store.setPinnedNotePath("B.md", true),
		]);

		expect(store.pinnedNotePaths).toEqual(["A.md", "B.md"]);
		expect(
			(
				adapter.saves.at(-1) as
					| PersistedPluginData<TestSettings>
					| undefined
			)?.pinnedNotePaths,
		).toEqual(["A.md", "B.md"]);
	});

	it("preserves call order for opposite pin mutations while other fields are pending", async () => {
		const adapter = new MemoryAdapter();
		const scheduler = new ManualScheduler();
		const store = createStore(adapter, scheduler);
		await store.load();
		store.scheduleSettingsSave({
			...DEFAULT_SETTINGS,
			enabled: false,
		});
		store.scheduleCameraSave({
			position: [0, 0, 7],
			up: [0, 1, 0],
			target: [0, 0, 0],
		});

		await Promise.all([
			store.setPinnedNotePath("A.md", true),
			store.setPinnedNotePath("A.md", false),
		]);
		scheduler.advance(100);
		await store.saveNow();

		expect(store.pinnedNotePaths).toEqual([]);
		expect(store.state.settings.enabled).toBe(false);
		expect(store.state.camera.position).toEqual([0, 0, 7]);
	});

	it("imports a complete state in one write and reconciles paths", async () => {
		const sourceGraph = createGraph([
			"old.md",
			"deleted.md",
		]);
		const snapshot = createCommittedLayoutSnapshot({
			snapshotId: "sync",
			graph: sourceGraph,
			mode: "initialize",
			effectiveSeed: 7,
			renewGeneration: 0,
			completedAt: 1,
			positions: new Float32Array([1, 0, 0, 0, 1, 0]),
		});
		if (snapshot === undefined) {
			throw new Error("Expected snapshot.");
		}
		const adapter = new MemoryAdapter();
		const store = createStore(adapter);
		await store.load();
		const loaded = await store.replaceState(
			{
				settings: {
					...DEFAULT_SETTINGS,
					enabled: false,
				},
				committedLayout: snapshot,
				camera: {
					position: [0, 0, 6],
					up: [0, 1, 0],
					target: [0, 0, 0],
				},
				pinnedNotePaths: ["old.md", "deleted.md"],
			},
			{
				renames: [
					{ oldPath: "old.md", newPath: "renamed.md" },
				],
				existingPaths: new Set(["renamed.md"]),
			},
		);

		expect(adapter.saves).toHaveLength(1);
		expect(loaded?.settings.enabled).toBe(false);
		expect(loaded?.camera.position).toEqual([0, 0, 6]);
		expect(loaded?.committedLayout?.graphDescriptor.nodeIds).toEqual([
			"renamed.md",
		]);
		expect(loaded?.pinnedNotePaths).toEqual(["renamed.md"]);
		expect(store.exportState()).toEqual(loaded);
		expect(store.exportState()).not.toBe(loaded);
	});

	it("rejects an imported corrupt snapshot without overwriting data", async () => {
		const adapter = new MemoryAdapter();
		const store = createStore(adapter);
		await store.load();
		const loaded = await store.replaceState({
			settings: DEFAULT_SETTINGS,
			committedLayout: { snapshotId: "corrupt" },
			camera: {
				position: [0, 0, 3],
				up: [0, 1, 0],
				target: [0, 0, 0],
			},
			pinnedNotePaths: [],
		});
		expect(loaded).toBeUndefined();
		expect(adapter.saves).toHaveLength(0);
	});

	it("saves camera independently without changing the position map", async () => {
		const adapter = new MemoryAdapter();
		const store = createStore(adapter);
		await store.load();
		await store.commitCompletedResult({
			graph: createGraph(["a.md"]),
			mode: "initialize",
			operationId: "initial",
			effectiveSeed: 1,
			completedAt: 1,
			positions: new Float32Array([1, 0, 0]),
			expectedSnapshotId: null,
		});
		const positions = store.committedSnapshot?.positionsByPath;
		await store.saveCamera({
			position: [0, 0, 6],
			up: [0, 1, 0],
			target: [0, 0, 0],
		});
		expect(store.committedSnapshot?.positionsByPath).toBe(positions);
		const saved = adapter.saves.at(-1) as
			| PersistedPluginData<TestSettings>
			| undefined;
		expect(saved?.committedLayout?.positionsByPath).toBe(positions);
	});

	it("debounces settings and camera into one save with fake timers", async () => {
		const adapter = new MemoryAdapter();
		const scheduler = new ManualScheduler();
		const store = createStore(adapter, scheduler);
		await store.load();
		store.scheduleSettingsSave({
			...DEFAULT_SETTINGS,
			enabled: false,
		});
		store.scheduleCameraSave({
			position: [0, 0, 4],
			up: [0, 1, 0],
			target: [0, 0, 0],
		});
		scheduler.advance(49);
		expect(adapter.saves).toHaveLength(0);
		scheduler.advance(1);
		await vi.waitFor(() => {
			expect(adapter.saves).toHaveLength(1);
		});
		expect(store.state.settings.enabled).toBe(false);
		expect(store.state.camera.position).toEqual([0, 0, 4]);
	});

	it("manually saves camera, settings, and pins in one complete envelope", async () => {
		const adapter = new MemoryAdapter();
		const scheduler = new ManualScheduler();
		const store = createStore(adapter, scheduler);
		await store.load();
		store.scheduleSettingsSave({
			...DEFAULT_SETTINGS,
			enabled: false,
		});
		store.scheduleCameraSave({
			position: [0, 0, 7],
			up: [0, 1, 0],
			target: [0, 0, 0],
		});
		store.schedulePinnedNotePathsSave(["favorite.md"]);

		const saved = await store.saveNow();
		scheduler.advance(100);
		expect(adapter.saves).toHaveLength(1);
		expect(saved.settings.enabled).toBe(false);
		expect(saved.camera.position).toEqual([0, 0, 7]);
		expect(saved.pinnedNotePaths).toEqual(["favorite.md"]);
	});
});
