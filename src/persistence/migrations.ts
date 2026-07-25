import {
	CURRENT_ALGORITHM_VERSION,
	CURRENT_SCHEMA_VERSION,
	isRecord,
	validateGraphDescriptor,
} from "./layoutState";
import { createGraphSignature } from "../graph/graphSignature";

export interface MigratedPluginData {
	readonly schemaVersion: number;
	readonly settings: unknown;
	readonly committedLayout: unknown;
	readonly camera: unknown;
}

function migrateSnapshot(value: unknown): unknown {
	if (!isRecord(value)) {
		return value;
	}
	const graphDescriptor =
		value.graphDescriptor ?? value.graph ?? value.descriptor;
	const descriptor = validateGraphDescriptor(graphDescriptor);
	const graphSignature =
		typeof value.graphSignature === "string"
			? value.graphSignature
			: descriptor === undefined
				? undefined
				: createGraphSignature(descriptor);
	return {
		...value,
		schemaVersion: CURRENT_SCHEMA_VERSION,
		algorithmVersion:
			value.algorithmVersion ?? CURRENT_ALGORITHM_VERSION,
		positionsByPath: value.positionsByPath ?? value.positions,
		graphDescriptor,
		graphSignature,
		modeThatCreatedIt:
			value.modeThatCreatedIt ?? value.mode ?? "initialize",
		effectiveSeed: value.effectiveSeed ?? 0,
		renewGeneration: value.renewGeneration ?? 0,
	};
}

/**
 * Converts historical envelope names to the current schema. Field validation
 * deliberately remains in layoutState/PluginDataStore after migration.
 */
export function migratePluginData(raw: unknown): MigratedPluginData {
	if (!isRecord(raw)) {
		return {
			schemaVersion: CURRENT_SCHEMA_VERSION,
			settings: undefined,
			committedLayout: null,
			camera: undefined,
		};
	}
	const rawVersion =
		typeof raw.schemaVersion === "number" ? raw.schemaVersion : 0;
	if (rawVersion > CURRENT_SCHEMA_VERSION) {
		return {
			schemaVersion: CURRENT_SCHEMA_VERSION,
			settings: raw.settings,
			committedLayout: null,
			camera: raw.camera,
		};
	}
	const committedLayout =
		raw.committedLayout ??
		raw.layoutSnapshot ??
		raw.layout ??
		null;
	return {
		schemaVersion: CURRENT_SCHEMA_VERSION,
		settings: raw.settings,
		committedLayout:
			committedLayout === null
				? null
				: migrateSnapshot(committedLayout),
		camera: raw.camera ?? raw.cameraState,
	};
}
