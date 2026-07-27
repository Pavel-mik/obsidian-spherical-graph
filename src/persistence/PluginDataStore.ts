import { GraphData } from "../graph/graphTypes";
import { GraphRename } from "../graph/graphDiff";
import { migratePluginData } from "./migrations";
import {
	CompletedLayoutInput,
	CURRENT_ALGORITHM_VERSION,
	CURRENT_SCHEMA_VERSION,
	DEFAULT_CAMERA_STATE,
	PersistedCameraState,
	PersistedLayoutSnapshot,
	PersistedPluginData,
	createCommittedLayoutSnapshot,
	isRecord,
	pruneSnapshotPaths,
	renameSnapshotPaths,
	validateCameraState,
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
		camera: data.camera,
	});
}

export class PluginDataStore<TSettings> {
	private readonly adapter: PluginDataAdapter;
	private readonly options: PluginDataStoreOptions<TSettings>;
	private readonly scheduler: PersistenceScheduler;
	private data: PersistedPluginData<TSettings>;
	private writeQueue: Promise<void> = Promise.resolve();
	private pendingSettings: TSettings | undefined;
	private pendingCamera: PersistedCameraState | undefined;
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
			camera: options.defaultCamera ?? DEFAULT_CAMERA_STATE,
		});
	}

	get state(): PersistedPluginData<TSettings> {
		return this.data;
	}

	get committedSnapshot(): PersistedLayoutSnapshot | undefined {
		return this.data.committedLayout ?? undefined;
	}

	async load(): Promise<PersistedPluginData<TSettings>> {
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
			camera: validateCameraState(
				migrated.camera,
				this.options.defaultCamera ?? DEFAULT_CAMERA_STATE,
			),
		});
		return this.data;
	}

	async commitCompletedResult(
		input: CommitCompletedResultInput,
	): Promise<PersistedLayoutSnapshot | undefined> {
		if (this.disposed || input.operationId.length === 0) {
			return undefined;
		}
		return this.enqueue(async () => {
			const current = this.data.committedLayout;
			const currentId = current?.snapshotId ?? null;
			if (currentId !== input.expectedSnapshotId) {
				return undefined;
			}
			if (
				input.mode === "refresh" &&
				current === null
			) {
				return undefined;
			}
			const renewGeneration =
				input.mode === "renew"
					? (current?.renewGeneration ?? 0) + 1
					: (current?.renewGeneration ?? 0);
			const snapshot = createCommittedLayoutSnapshot({
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
			});
			if (snapshot === undefined) {
				return undefined;
			}
			const next = freezeEnvelope({
				...this.data,
				committedLayout: snapshot,
			});
			await this.adapter.saveData(next);
			this.data = next;
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
			if (current === null) {
				return undefined;
			}
			const renamed = renameSnapshotPaths(current, renames);
			if (renamed === undefined || renamed === current) {
				return renamed;
			}
			const next = freezeEnvelope({
				...this.data,
				committedLayout: renamed,
			});
			await this.adapter.saveData(next);
			this.data = next;
			return renamed;
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
			if (current === null) {
				return undefined;
			}
			const pruned = pruneSnapshotPaths(current, existingPaths);
			if (
				pruned.graphDescriptor.nodeIds.length ===
				current.graphDescriptor.nodeIds.length
			) {
				return current;
			}
			const next = freezeEnvelope({
				...this.data,
				committedLayout: pruned,
			});
			await this.adapter.saveData(next);
			this.data = next;
			return pruned;
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

	async flushDebounced(): Promise<void> {
		this.clearDebounceTimer();
		const settings = this.pendingSettings;
		const camera = this.pendingCamera;
		this.pendingSettings = undefined;
		this.pendingCamera = undefined;
		if (settings === undefined && camera === undefined) {
			return;
		}
		await this.enqueue(async () => {
			const next = freezeEnvelope({
				...this.data,
				settings: settings ?? this.data.settings,
				camera: camera ?? this.data.camera,
			});
			await this.adapter.saveData(next);
			this.data = next;
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
	}

	private parseSettings(value: unknown): TSettings {
		return this.options.parseSettings === undefined
			? deepMergeValidated(this.options.defaultSettings, value)
			: this.options.parseSettings(value);
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
