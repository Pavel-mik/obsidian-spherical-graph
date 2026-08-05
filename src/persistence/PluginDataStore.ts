import { GraphData } from "../graph/graphTypes";
import { GraphRename } from "../graph/graphDiff";
import type { DevelopmentDiagnosticSink } from "../diagnostics/DevelopmentLog";
import type {
	DirectoryTerritorySource,
	PersistedContinentalGeography,
} from "../geography";
import { migratePluginData } from "./migrations";
import {
	createPersistedGraphCache,
	PersistedGraphCache,
	validatePersistedGraphCache,
} from "./graphCache";
import {
	CompletedLayoutInput,
	CURRENT_ALGORITHM_VERSION,
	CURRENT_SCHEMA_VERSION,
	DEFAULT_CAMERA_STATE,
	PersistedCameraState,
	PersistedLayoutSnapshot,
	PersistedPluginData,
	PinnedPathRenameScope,
	createCommittedLayoutSnapshot,
	diagnoseCompletedLayoutInput,
	isRecord,
	prunePinnedNotePaths,
	pruneSnapshotPaths,
	renamePinnedNotePaths,
	renamePinnedNotePathsFromVault,
	renameSnapshotPaths,
	validateCameraState,
	validatePinnedNotePaths,
	validatePersistedLayoutSnapshot,
} from "./layoutState";

export interface PluginDataAdapter {
	loadData(): Promise<unknown>;
	saveData(data: unknown): Promise<void>;
}

export interface PersistenceScheduler {
	set(callback: () => void, delayMs: number): unknown;
	clear(handle: unknown): void;
}

export interface PluginDataStoreOptions<TSettings> {
	readonly defaultSettings: TSettings;
	readonly parseSettings?: (value: unknown) => TSettings;
	readonly defaultCamera?: PersistedCameraState;
	readonly saveDebounceMs?: number;
	readonly scheduler?: PersistenceScheduler;
	readonly onAsyncError?: (error: unknown) => void;
	readonly onDiagnostic?: DevelopmentDiagnosticSink;
	readonly createGeography?: (
		graph: GraphData,
		positions: ArrayLike<number>,
		seed: number,
		previous?: PersistedContinentalGeography,
		territory?: DirectoryTerritorySource,
	) => Promise<PersistedContinentalGeography>;
}

function errorDetails(error: unknown): Readonly<Record<string, unknown>> {
	return {
		message:
			error instanceof Error
				? error.message
				: "Unknown non-Error exception",
		name: error instanceof Error ? error.name : typeof error,
	};
}

function geographyDetails(
	geography: PersistedContinentalGeography | undefined,
): Readonly<Record<string, unknown>> {
	if (geography === undefined) {
		return { provided: false };
	}
	let assignedNodeCount = geography.islandNodeIds.length;
	let maximumCapRadius = 0;
	let minimumCapRadius = Number.POSITIVE_INFINITY;
	for (const continent of geography.continents) {
		assignedNodeCount += continent.nodeIds.length;
		maximumCapRadius = Math.max(maximumCapRadius, continent.capRadius);
		minimumCapRadius = Math.min(minimumCapRadius, continent.capRadius);
	}
	return {
		provided: true,
		continentCount: geography.continents.length,
		islandCount: geography.islandNodeIds.length,
		assignedNodeCount,
		minimumCapRadius:
			minimumCapRadius === Number.POSITIVE_INFINITY
				? null
				: minimumCapRadius,
		maximumCapRadius,
	};
}

export interface CommitCompletedResultInput {
	readonly graph: GraphData;
	readonly mode: CompletedLayoutInput["mode"];
	readonly operationId: string;
	readonly effectiveSeed: number;
	readonly completedAt: number;
	readonly positions: ArrayLike<number>;
	readonly expectedSnapshotId: string | null;
	readonly algorithmVersion?: number;
	readonly normTolerance?: number;
	readonly territory?: DirectoryTerritorySource;
}

export interface ReplacePersistedStateInput {
	readonly schemaVersion?: unknown;
	readonly settings: unknown;
	readonly committedLayout: unknown;
	readonly graphCache?: unknown;
	readonly camera: unknown;
	readonly pinnedNotePaths: unknown;
}

export interface ReplacePersistedStateOptions {
	readonly existingPaths?: ReadonlySet<string>;
	readonly renames?: readonly GraphRename[];
}

const DEFAULT_SCHEDULER: PersistenceScheduler = {
	set: (callback, delayMs) => window.setTimeout(callback, delayMs),
	clear: (handle) => {
		window.clearTimeout(handle as number);
	},
};

function isUnknownArray(value: unknown): value is unknown[] {
	return Array.isArray(value);
}

function cloneValidatedValue(
	defaultValue: unknown,
	inputValue: unknown,
): unknown {
	if (typeof defaultValue === "number") {
		return typeof inputValue === "number" && Number.isFinite(inputValue)
			? inputValue
			: defaultValue;
	}
	if (
		typeof defaultValue === "string" ||
		typeof defaultValue === "boolean"
	) {
		return typeof inputValue === typeof defaultValue
			? inputValue
			: defaultValue;
	}
	if (defaultValue === null) {
		return inputValue === null ? null : null;
	}
	if (isUnknownArray(defaultValue)) {
		if (!isUnknownArray(inputValue)) {
			return defaultValue.map((item) =>
				cloneValidatedValue(item, item),
			);
		}
		const template = defaultValue[0];
		return inputValue
			.map((item) =>
				template === undefined
					? cloneJsonValue(item)
					: cloneValidatedValue(template, item),
			)
			.filter((item) => item !== undefined);
	}
	if (isRecord(defaultValue)) {
		const source = isRecord(inputValue) ? inputValue : {};
		const merged: Record<string, unknown> = {};
		for (const [key, childDefault] of Object.entries(defaultValue)) {
			merged[key] = cloneValidatedValue(
				childDefault,
				source[key],
			);
		}
		return merged;
	}
	return defaultValue;
}

function cloneJsonValue(value: unknown): unknown {
	if (
		value === null ||
		typeof value === "string" ||
		typeof value === "boolean"
	) {
		return value;
	}
	if (typeof value === "number") {
		return Number.isFinite(value) ? value : undefined;
	}
	if (isUnknownArray(value)) {
		return value
			.map(cloneJsonValue)
			.filter((item) => item !== undefined);
	}
	if (isRecord(value)) {
		const cloned: Record<string, unknown> = {};
		for (const [key, child] of Object.entries(value)) {
			const validChild = cloneJsonValue(child);
			if (validChild !== undefined) {
				cloned[key] = validChild;
			}
		}
		return cloned;
	}
	return undefined;
}

/**
 * Recursively merges persisted values over defaults while preserving the
 * default value's shape and primitive types.
 */
export function deepMergeValidated<TSettings>(
	defaultSettings: TSettings,
	input: unknown,
): TSettings {
	return cloneValidatedValue(defaultSettings, input) as TSettings;
}

function freezeEnvelope<TSettings>(
	data: PersistedPluginData<TSettings>,
): PersistedPluginData<TSettings> {
	return Object.freeze({
		schemaVersion: CURRENT_SCHEMA_VERSION,
		settings: data.settings,
		committedLayout: data.committedLayout,
		graphCache: data.graphCache,
		camera: data.camera,
		pinnedNotePaths: validatePinnedNotePaths(data.pinnedNotePaths),
	});
}

function equalStringArrays(
	left: readonly string[],
	right: readonly string[],
): boolean {
	return (
		left.length === right.length &&
		left.every((value, index) => value === right[index])
	);
}

export class PluginDataStore<TSettings> {
	private readonly adapter: PluginDataAdapter;
	private readonly options: PluginDataStoreOptions<TSettings>;
	private readonly scheduler: PersistenceScheduler;
	private data: PersistedPluginData<TSettings>;
	private writeQueue: Promise<void> = Promise.resolve();
	private pendingSettings: TSettings | undefined;
	private pendingCamera: PersistedCameraState | undefined;
	private pendingPinnedNotePaths: readonly string[] | undefined;
	private pendingGraphCache: PersistedGraphCache | undefined;
	private debounceTimer: unknown;
	private disposed = false;

	constructor(
		adapter: PluginDataAdapter,
		options: PluginDataStoreOptions<TSettings>,
	) {
		this.adapter = adapter;
		this.options = options;
		this.scheduler = options.scheduler ?? DEFAULT_SCHEDULER;
		this.data = freezeEnvelope({
			schemaVersion: CURRENT_SCHEMA_VERSION,
			settings: this.parseSettings(undefined),
			committedLayout: null,
			graphCache: null,
			camera: options.defaultCamera ?? DEFAULT_CAMERA_STATE,
			pinnedNotePaths: [],
		});
	}

	get state(): PersistedPluginData<TSettings> {
		return this.data;
	}

	get committedSnapshot(): PersistedLayoutSnapshot | undefined {
		return this.data.committedLayout ?? undefined;
	}

	get graphCache(): PersistedGraphCache | undefined {
		return this.data.graphCache ?? undefined;
	}

	get pinnedNotePaths(): readonly string[] {
		return this.data.pinnedNotePaths;
	}

	/**
	 * Returns the complete versioned data.json envelope. It contains the
	 * committed positions, camera, validated settings, and pins required for
	 * a stable restart or a manual copy through Obsidian Sync.
	 */
	exportState(): PersistedPluginData<TSettings> {
		return cloneJsonValue(this.data) as PersistedPluginData<TSettings>;
	}

	async load(): Promise<PersistedPluginData<TSettings>> {
		return this.loadFromAdapter();
	}

	/**
	 * Re-reads data.json after Obsidian Sync has delivered a newer map. Pending
	 * debounced writes are discarded so they cannot overwrite the synced file.
	 */
	async reload(): Promise<PersistedPluginData<TSettings>> {
		this.clearDebounceTimer();
		this.pendingSettings = undefined;
		this.pendingCamera = undefined;
		this.pendingPinnedNotePaths = undefined;
		this.pendingGraphCache = undefined;
		await this.writeQueue;
		return this.loadFromAdapter();
	}

	private async loadFromAdapter(): Promise<PersistedPluginData<TSettings>> {
		const migrated = migratePluginData(await this.adapter.loadData());
		const snapshot =
			migrated.committedLayout === null
				? undefined
				: validatePersistedLayoutSnapshot(
						migrated.committedLayout,
					);
		this.data = freezeEnvelope({
			schemaVersion: CURRENT_SCHEMA_VERSION,
			settings: this.parseSettings(migrated.settings),
			committedLayout: snapshot ?? null,
			graphCache:
				snapshot === undefined
					? null
					: (validatePersistedGraphCache(migrated.graphCache) ?? null),
			camera: validateCameraState(
				migrated.camera,
				this.options.defaultCamera ?? DEFAULT_CAMERA_STATE,
			),
			pinnedNotePaths: validatePinnedNotePaths(
				migrated.pinnedNotePaths,
			),
		});
		return this.data;
	}

	/**
	 * Applies a manually loaded Sync document with one validated plugin-data
	 * write. A malformed non-null snapshot is rejected instead of erasing the
	 * last good layout.
	 */
	async replaceState(
		input: ReplacePersistedStateInput,
		options: ReplacePersistedStateOptions = {},
	): Promise<PersistedPluginData<TSettings> | undefined> {
		if (
			this.disposed ||
			(typeof input.schemaVersion === "number" &&
				input.schemaVersion > CURRENT_SCHEMA_VERSION)
		) {
			return undefined;
		}
		const migrated = migratePluginData(input);
		const parsedSnapshot =
			migrated.committedLayout === null
				? null
				: validatePersistedLayoutSnapshot(
						migrated.committedLayout,
					);
		if (
			migrated.committedLayout !== null &&
			parsedSnapshot === undefined
		) {
			return undefined;
		}
		let snapshot: PersistedLayoutSnapshot | null =
			parsedSnapshot ?? null;
		let graphCache =
			snapshot === null
				? null
				: (validatePersistedGraphCache(migrated.graphCache) ?? null);
		const settings = this.parseSettings(migrated.settings);
		const camera = validateCameraState(
			migrated.camera,
			this.options.defaultCamera ?? DEFAULT_CAMERA_STATE,
		);
		let pinnedNotePaths = validatePinnedNotePaths(
			migrated.pinnedNotePaths,
		);
		for (const rename of options.renames ?? []) {
			if (snapshot !== null) {
				snapshot =
					renameSnapshotPaths(snapshot, [rename]) ?? snapshot;
			}
			pinnedNotePaths = renamePinnedNotePaths(
				pinnedNotePaths,
				[rename],
			);
		}
		if (options.existingPaths !== undefined) {
			snapshot =
				snapshot === null
					? null
					: pruneSnapshotPaths(
							snapshot,
							options.existingPaths,
						);
			pinnedNotePaths = prunePinnedNotePaths(
				pinnedNotePaths,
				options.existingPaths,
			);
		}
		if (
			(options.renames?.length ?? 0) > 0 ||
			options.existingPaths !== undefined ||
			graphCache?.graphSignature !== snapshot?.graphSignature
		) {
			graphCache = null;
		}
		return this.enqueue(async () => {
			const next = freezeEnvelope({
				schemaVersion: CURRENT_SCHEMA_VERSION,
				settings,
				committedLayout: snapshot ?? null,
				graphCache,
				camera,
				pinnedNotePaths,
			});
			await this.adapter.saveData(next);
			this.data = next;
			return next;
		});
	}

	async commitCompletedResult(
		input: CommitCompletedResultInput,
	): Promise<PersistedLayoutSnapshot | undefined> {
		this.diagnostic("commit.requested", {
			mode: input.mode,
			nodeCount: input.graph.nodes.length,
			edgeCount: input.graph.edges.length,
			positionCount: input.positions.length,
			expectedSnapshotPresent: input.expectedSnapshotId !== null,
		});
		if (this.disposed) {
			this.diagnostic("commit.rejected", { reason: "store-disposed" });
			return undefined;
		}
		if (input.operationId.length === 0) {
			this.diagnostic("commit.rejected", { reason: "empty-operation-id" });
			return undefined;
		}
		return this.enqueue(async () => {
			const current = this.data.committedLayout;
			const currentId = current?.snapshotId ?? null;
			if (currentId !== input.expectedSnapshotId) {
				this.diagnostic("commit.rejected", {
					reason: "snapshot-race",
					currentSnapshotPresent: currentId !== null,
					expectedSnapshotPresent:
						input.expectedSnapshotId !== null,
				});
				return undefined;
			}
			if (
				input.mode === "refresh" &&
				current === null
			) {
				this.diagnostic("commit.rejected", {
					reason: "refresh-without-snapshot",
				});
				return undefined;
			}
			const renewGeneration =
				input.mode === "renew"
					? (current?.renewGeneration ?? 0) + 1
					: (current?.renewGeneration ?? 0);
			this.diagnostic("geography.started", {
				nodeCount: input.graph.nodes.length,
				edgeCount: input.graph.edges.length,
				hasPreviousGeography:
					input.mode === "refresh" && current?.geography !== undefined,
			});
			let geography: PersistedContinentalGeography | undefined;
			try {
				geography = await this.options.createGeography?.(
					input.graph,
					input.positions,
					input.effectiveSeed,
					input.mode === "refresh"
						? current?.geography
						: undefined,
					input.territory,
				);
			} catch (error: unknown) {
				this.diagnostic("geography.failed", errorDetails(error));
				throw error;
			}
			this.diagnostic("geography.completed", geographyDetails(geography));
			const completedInput = {
				snapshotId: `layout-${input.operationId}`,
				graph: input.graph,
				mode: input.mode,
				effectiveSeed: input.effectiveSeed,
				renewGeneration,
				completedAt: input.completedAt,
				positions: input.positions,
				algorithmVersion:
					input.algorithmVersion ??
					CURRENT_ALGORITHM_VERSION,
				normTolerance: input.normTolerance,
				previousGeography:
					input.mode === "refresh"
						? current?.geography
						: undefined,
				geography,
			} satisfies CompletedLayoutInput;
			const snapshot = createCommittedLayoutSnapshot(completedInput);
			if (snapshot === undefined) {
				const failure = diagnoseCompletedLayoutInput(completedInput);
				this.diagnostic("commit.rejected", {
					reason: "snapshot-validation",
					stage: failure.stage,
					code: failure.code,
					...failure.details,
				});
				return undefined;
			}
			const next = freezeEnvelope({
				...this.data,
				committedLayout: snapshot,
				graphCache: createPersistedGraphCache(input.graph),
			});
			await this.adapter.saveData(next);
			this.data = next;
			this.diagnostic("commit.persisted", {
				mode: input.mode,
				nodeCount: input.graph.nodes.length,
				edgeCount: input.graph.edges.length,
				...geographyDetails(snapshot.geography),
			});
			return snapshot;
		});
	}

	async replaceCommittedSnapshot(
		value: unknown,
		expectedSnapshotId: string | null,
	): Promise<PersistedLayoutSnapshot | undefined> {
		const snapshot = validatePersistedLayoutSnapshot(value);
		if (snapshot === undefined || this.disposed) {
			return undefined;
		}
		return this.enqueue(async () => {
			if (
				(this.data.committedLayout?.snapshotId ?? null) !==
				expectedSnapshotId
			) {
				return undefined;
			}
			const next = freezeEnvelope({
				...this.data,
				committedLayout: snapshot,
				graphCache:
					this.data.graphCache?.graphSignature ===
					snapshot.graphSignature
						? this.data.graphCache
						: null,
			});
			await this.adapter.saveData(next);
			this.data = next;
			return snapshot;
		});
	}

	async renameCommittedPaths(
		renames: readonly GraphRename[],
	): Promise<PersistedLayoutSnapshot | undefined> {
		if (this.disposed || renames.length === 0) {
			return this.committedSnapshot;
		}
		return this.enqueue(async () => {
			const current = this.data.committedLayout;
			let renamed = current;
			for (const rename of renames) {
				if (renamed === null) {
					break;
				}
				renamed =
					renameSnapshotPaths(renamed, [rename]) ?? renamed;
			}
			const renamedPins = renamePinnedNotePaths(
				this.data.pinnedNotePaths,
				renames,
			);
			if (
				renamed === current &&
				equalStringArrays(renamedPins, this.data.pinnedNotePaths)
			) {
				return renamed ?? undefined;
			}
			const next = freezeEnvelope({
				...this.data,
				committedLayout: renamed,
				graphCache: null,
				pinnedNotePaths: renamedPins,
			});
			await this.adapter.saveData(next);
			this.data = next;
			return renamed ?? undefined;
		});
	}

	async pruneCommittedPaths(
		existingPaths: ReadonlySet<string>,
	): Promise<PersistedLayoutSnapshot | undefined> {
		if (this.disposed) {
			return undefined;
		}
		return this.enqueue(async () => {
			const current = this.data.committedLayout;
			const pruned =
				current === null
					? null
					: pruneSnapshotPaths(current, existingPaths);
			const prunedPins = prunePinnedNotePaths(
				this.data.pinnedNotePaths,
				existingPaths,
			);
			if (
				(pruned === null ||
					pruned.graphDescriptor.nodeIds.length ===
						current?.graphDescriptor.nodeIds.length) &&
				equalStringArrays(prunedPins, this.data.pinnedNotePaths)
			) {
				return current ?? undefined;
			}
			const next = freezeEnvelope({
				...this.data,
				committedLayout: pruned,
				graphCache: null,
				pinnedNotePaths: prunedPins,
			});
			await this.adapter.saveData(next);
			this.data = next;
			return pruned ?? undefined;
		});
	}

	async saveSettings(settings: unknown): Promise<TSettings> {
		const parsed = this.parseSettings(settings);
		await this.enqueue(async () => {
			const next = freezeEnvelope({
				...this.data,
				settings: parsed,
			});
			await this.adapter.saveData(next);
			this.data = next;
		});
		return parsed;
	}

	async saveCamera(
		camera: unknown,
	): Promise<PersistedCameraState> {
		const parsed = validateCameraState(camera, this.data.camera);
		await this.enqueue(async () => {
			const next = freezeEnvelope({
				...this.data,
				camera: parsed,
			});
			await this.adapter.saveData(next);
			this.data = next;
		});
		return parsed;
	}

	async savePinnedNotePaths(value: unknown): Promise<readonly string[]> {
		const pinnedNotePaths = validatePinnedNotePaths(value);
		await this.enqueue(async () => {
			if (
				equalStringArrays(
					pinnedNotePaths,
					this.data.pinnedNotePaths,
				)
			) {
				return;
			}
			const next = freezeEnvelope({
				...this.data,
				pinnedNotePaths,
			});
			await this.adapter.saveData(next);
			this.data = next;
		});
		return pinnedNotePaths;
	}

	async setPinnedNotePath(
		path: string,
		pinned: boolean,
	): Promise<readonly string[]> {
		const normalized = validatePinnedNotePaths([path])[0];
		if (normalized === undefined || this.disposed) {
			return this.data.pinnedNotePaths;
		}
		return this.enqueue(async () => {
			const next = new Set(this.data.pinnedNotePaths);
			if (pinned) {
				next.add(normalized);
			} else {
				next.delete(normalized);
			}
			const pinnedNotePaths = validatePinnedNotePaths([...next]);
			if (
				equalStringArrays(
					pinnedNotePaths,
					this.data.pinnedNotePaths,
				)
			) {
				return this.data.pinnedNotePaths;
			}
			const envelope = freezeEnvelope({
				...this.data,
				pinnedNotePaths,
			});
			await this.adapter.saveData(envelope);
			this.data = envelope;
			return pinnedNotePaths;
		});
	}

	/**
	 * Migrates pins immediately from a public vault rename event. This write
	 * is independent of graph diffing and layout lifecycle reconciliation.
	 */
	async renamePinnedNotePathsFromVault(
		oldPath: string,
		newPath: string,
		scope: PinnedPathRenameScope,
	): Promise<readonly string[]> {
		if (this.disposed) {
			return this.data.pinnedNotePaths;
		}
		if (this.pendingPinnedNotePaths !== undefined) {
			this.pendingPinnedNotePaths =
				renamePinnedNotePathsFromVault(
					this.pendingPinnedNotePaths,
					oldPath,
					newPath,
					scope,
				);
		}
		return this.enqueue(async () => {
			const pinnedNotePaths =
				renamePinnedNotePathsFromVault(
					this.data.pinnedNotePaths,
					oldPath,
					newPath,
					scope,
				);
			if (
				equalStringArrays(
					pinnedNotePaths,
					this.data.pinnedNotePaths,
				)
			) {
				return this.data.pinnedNotePaths;
			}
			const envelope = freezeEnvelope({
				...this.data,
				pinnedNotePaths,
			});
			await this.adapter.saveData(envelope);
			this.data = envelope;
			return pinnedNotePaths;
		});
	}

	async togglePinnedNotePath(path: string): Promise<readonly string[]> {
		const normalized = validatePinnedNotePaths([path])[0];
		if (normalized === undefined || this.disposed) {
			return this.data.pinnedNotePaths;
		}
		return this.enqueue(async () => {
			const next = new Set(this.data.pinnedNotePaths);
			const pinned = !next.has(normalized);
			if (pinned) {
				next.add(normalized);
			} else {
				next.delete(normalized);
			}
			const pinnedNotePaths = validatePinnedNotePaths([...next]);
			const envelope = freezeEnvelope({
				...this.data,
				pinnedNotePaths,
			});
			await this.adapter.saveData(envelope);
			this.data = envelope;
			return pinnedNotePaths;
		});
	}

	scheduleSettingsSave(settings: unknown): void {
		if (this.disposed) {
			return;
		}
		this.pendingSettings = this.parseSettings(settings);
		this.scheduleDebouncedSave();
	}

	scheduleCameraSave(camera: unknown): void {
		if (this.disposed) {
			return;
		}
		this.pendingCamera = validateCameraState(camera, this.data.camera);
		this.scheduleDebouncedSave();
	}

	schedulePinnedNotePathsSave(value: unknown): void {
		if (this.disposed) {
			return;
		}
		this.pendingPinnedNotePaths = validatePinnedNotePaths(value);
		this.scheduleDebouncedSave();
	}

	scheduleGraphCacheSave(graph: GraphData): void {
		if (
			this.disposed ||
			graph.signature !== this.data.committedLayout?.graphSignature
		) {
			return;
		}
		this.pendingGraphCache = createPersistedGraphCache(graph);
		this.scheduleDebouncedSave();
	}

	async flushDebounced(): Promise<void> {
		this.clearDebounceTimer();
		const settings = this.pendingSettings;
		const camera = this.pendingCamera;
		const pinnedNotePaths = this.pendingPinnedNotePaths;
		const graphCache = this.pendingGraphCache;
		this.pendingSettings = undefined;
		this.pendingCamera = undefined;
		this.pendingPinnedNotePaths = undefined;
		this.pendingGraphCache = undefined;
		if (
			settings === undefined &&
			camera === undefined &&
			pinnedNotePaths === undefined &&
			graphCache === undefined
		) {
			return;
		}
		await this.enqueue(async () => {
			const next = freezeEnvelope({
				...this.data,
				settings: settings ?? this.data.settings,
				camera: camera ?? this.data.camera,
				pinnedNotePaths:
					pinnedNotePaths ?? this.data.pinnedNotePaths,
				graphCache: graphCache ?? this.data.graphCache,
			});
			await this.adapter.saveData(next);
			this.data = next;
		});
	}

	/**
	 * Manual save primitive. It folds all pending automatic changes into one
	 * adapter write; with no pending changes it still persists the current
	 * complete envelope.
	 */
	async saveNow(graph?: GraphData): Promise<PersistedPluginData<TSettings>> {
		this.clearDebounceTimer();
		const settings = this.pendingSettings;
		const camera = this.pendingCamera;
		const pinnedNotePaths = this.pendingPinnedNotePaths;
		const pendingGraphCache = this.pendingGraphCache;
		this.pendingSettings = undefined;
		this.pendingCamera = undefined;
		this.pendingPinnedNotePaths = undefined;
		this.pendingGraphCache = undefined;
		return this.enqueue(async () => {
			const graphCache =
				graph !== undefined &&
				graph.signature === this.data.committedLayout?.graphSignature
					? createPersistedGraphCache(graph)
					: (pendingGraphCache ?? this.data.graphCache);
			const next = freezeEnvelope({
				...this.data,
				graphCache,
				settings: settings ?? this.data.settings,
				camera: camera ?? this.data.camera,
				pinnedNotePaths:
					pinnedNotePaths ?? this.data.pinnedNotePaths,
			});
			await this.adapter.saveData(next);
			this.data = next;
			return next;
		});
	}

	dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		this.clearDebounceTimer();
		this.pendingSettings = undefined;
		this.pendingCamera = undefined;
		this.pendingPinnedNotePaths = undefined;
		this.pendingGraphCache = undefined;
	}

	private parseSettings(value: unknown): TSettings {
		return this.options.parseSettings === undefined
			? deepMergeValidated(this.options.defaultSettings, value)
			: this.options.parseSettings(value);
	}

	private diagnostic(
		event: string,
		details: Readonly<Record<string, unknown>> = {},
	): void {
		try {
			this.options.onDiagnostic?.(event, details);
		} catch {
			// Diagnostics must never alter persistence behavior.
		}
	}

	private enqueue<TResult>(
		task: () => Promise<TResult>,
	): Promise<TResult> {
		const result = this.writeQueue.then(task, task);
		this.writeQueue = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}

	private scheduleDebouncedSave(): void {
		this.clearDebounceTimer();
		this.debounceTimer = this.scheduler.set(() => {
			this.debounceTimer = undefined;
			void this.flushDebounced().catch((error: unknown) => {
				this.options.onAsyncError?.(error);
			});
		}, Math.max(0, this.options.saveDebounceMs ?? 250));
	}

	private clearDebounceTimer(): void {
		if (this.debounceTimer !== undefined) {
			this.scheduler.clear(this.debounceTimer);
			this.debounceTimer = undefined;
		}
	}
}
