import {
	applyRenameMapToDescriptor,
	GraphRename,
} from "../graph/graphDiff";
import {
	createGraphSignature,
	deterministicUint32,
} from "../graph/graphSignature";
import {
	GraphData,
	GraphDescriptor,
	GraphDescriptorEdge,
	GraphEdge,
	GraphNode,
} from "../graph/graphTypes";
import {
	CONTINENTAL_GEOGRAPHY_VERSION,
	CONTINENT_COLOR_COUNT,
	createPersistedContinentalGeography,
	type PersistedContinent,
	type PersistedContinentalGeography,
} from "../geography";

export const CURRENT_SCHEMA_VERSION = 3;
export const CURRENT_ALGORITHM_VERSION = 8;
export const DEFAULT_POSITION_NORM_TOLERANCE = 1e-4;

export type Vector3Tuple = readonly [number, number, number];
export type LayoutSnapshotMode = "initialize" | "refresh" | "renew";

export interface PersistedCameraState {
	readonly position: Vector3Tuple;
	readonly up: Vector3Tuple;
	readonly target: Vector3Tuple;
}

export const DEFAULT_CAMERA_STATE: PersistedCameraState = Object.freeze({
	position: Object.freeze([0, 0, 3] as const),
	up: Object.freeze([0, 1, 0] as const),
	target: Object.freeze([0, 0, 0] as const),
});

export interface PersistedLayoutSnapshot {
	readonly snapshotId: string;
	readonly schemaVersion: number;
	readonly algorithmVersion: number;
	readonly graphSignature: string;
	readonly modeThatCreatedIt: LayoutSnapshotMode;
	readonly effectiveSeed: number;
	readonly renewGeneration: number;
	readonly completedAt: number;
	readonly positionsByPath: Readonly<Record<string, Vector3Tuple>>;
	readonly graphDescriptor: GraphDescriptor;
	readonly geography?: PersistedContinentalGeography;
}

export interface PersistedPluginData<TSettings> {
	readonly schemaVersion: number;
	readonly settings: TSettings;
	readonly committedLayout: PersistedLayoutSnapshot | null;
	readonly camera: PersistedCameraState;
	readonly pinnedNotePaths: readonly string[];
}

export interface CompletedLayoutInput {
	readonly snapshotId: string;
	readonly graph: GraphData;
	readonly mode: LayoutSnapshotMode;
	readonly effectiveSeed: number;
	readonly renewGeneration: number;
	readonly completedAt: number;
	readonly positions: ArrayLike<number>;
	readonly algorithmVersion?: number;
	readonly normTolerance?: number;
	readonly previousGeography?: PersistedContinentalGeography;
}

export interface ValidatedCompletedPositions {
	readonly positionsByPath: Readonly<Record<string, Vector3Tuple>>;
	readonly maxNormError: number;
}

export interface ReconciledCommittedLayout {
	readonly nodes: readonly GraphNode[];
	readonly edges: readonly GraphEdge[];
	readonly positions: Float32Array;
	readonly visibleNodeIds: readonly string[];
	readonly pendingNodeIds: readonly string[];
	readonly removedNodeIds: readonly string[];
	readonly positionsByPath: Readonly<Record<string, Vector3Tuple>>;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is unknown[] {
	return Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeInteger(value: unknown): value is number {
	return (
		typeof value === "number" &&
		Number.isSafeInteger(value) &&
		value >= 0
	);
}

function compareCodeUnits(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeVaultPath(value: string): string | undefined {
	const normalized = value
		.trim()
		.replaceAll("\\", "/")
		.replace(/\/+/gu, "/")
		.replace(/^\/|\/$/gu, "");
	if (
		normalized.length === 0 ||
		normalized.split("/").some((segment) => segment === "." || segment === "..")
	) {
		return undefined;
	}
	return normalized;
}

/**
 * Treat pin paths as untrusted vault-relative identifiers. The stable,
 * deterministic ordering avoids noisy writes and Sync conflicts.
 */
export function validatePinnedNotePaths(value: unknown): readonly string[] {
	if (!Array.isArray(value)) {
		return Object.freeze([]);
	}
	const paths = new Set<string>();
	for (const entry of value) {
		if (typeof entry !== "string") {
			continue;
		}
		const normalized = normalizeVaultPath(entry);
		if (normalized !== undefined) {
			paths.add(normalized);
		}
	}
	return Object.freeze([...paths].sort(compareCodeUnits));
}

export function renamePinnedNotePaths(
	pinnedNotePaths: readonly string[],
	renames: readonly GraphRename[],
): readonly string[] {
	if (renames.length === 0 || pinnedNotePaths.length === 0) {
		return validatePinnedNotePaths(pinnedNotePaths);
	}
	const renameMap = new Map<string, string>();
	for (const rename of renames) {
		const oldPath = normalizeVaultPath(rename.oldPath);
		const newPath = normalizeVaultPath(rename.newPath);
		if (
			oldPath !== undefined &&
			newPath !== undefined &&
			oldPath !== newPath &&
			!renameMap.has(oldPath)
		) {
			renameMap.set(oldPath, newPath);
		}
	}
	return validatePinnedNotePaths(
		pinnedNotePaths.map((path) => renameMap.get(path) ?? path),
	);
}

export type PinnedPathRenameScope = "file" | "folder";

/**
 * Applies the path semantics of Obsidian's vault `rename` event. File renames
 * match one exact note path. Folder renames replace only a segment-delimited
 * descendant prefix, so `Books/` never captures `Bookshelf/`.
 */
export function renamePinnedNotePathsFromVault(
	pinnedNotePaths: readonly string[],
	oldPathValue: string,
	newPathValue: string,
	scope: PinnedPathRenameScope,
): readonly string[] {
	const oldPath = normalizeVaultPath(oldPathValue);
	const newPath = normalizeVaultPath(newPathValue);
	if (
		oldPath === undefined ||
		newPath === undefined ||
		oldPath === newPath
	) {
		return validatePinnedNotePaths(pinnedNotePaths);
	}
	const oldPrefix = `${oldPath}/`;
	return validatePinnedNotePaths(
		pinnedNotePaths.map((path) => {
			if (scope === "file") {
				return path === oldPath ? newPath : path;
			}
			return path.startsWith(oldPrefix)
				? `${newPath}/${path.slice(oldPrefix.length)}`
				: path;
		}),
	);
}

export function prunePinnedNotePaths(
	pinnedNotePaths: readonly string[],
	existingPaths: ReadonlySet<string>,
): readonly string[] {
	return Object.freeze(
		validatePinnedNotePaths(pinnedNotePaths).filter((path) =>
			existingPaths.has(path),
		),
	);
}

function finiteTuple(
	value: unknown,
	requireNonZero: boolean,
): Vector3Tuple | undefined {
	if (
		!Array.isArray(value) ||
		value.length !== 3 ||
		!value.every(isFiniteNumber)
	) {
		return undefined;
	}
	const x = value[0];
	const y = value[1];
	const z = value[2];
	if (x === undefined || y === undefined || z === undefined) {
		return undefined;
	}
	if (requireNonZero && Math.hypot(x, y, z) <= Number.EPSILON) {
		return undefined;
	}
	return Object.freeze([x, y, z]);
}

export function validateAndNormalizePosition(
	value: unknown,
): Vector3Tuple | undefined {
	const tuple = finiteTuple(value, true);
	if (tuple === undefined) {
		return undefined;
	}
	const norm = Math.hypot(tuple[0], tuple[1], tuple[2]);
	if (!Number.isFinite(norm) || norm <= Number.EPSILON) {
		return undefined;
	}
	return Object.freeze([
		tuple[0] / norm,
		tuple[1] / norm,
		tuple[2] / norm,
	]);
}

export function validateCameraState(
	value: unknown,
	fallback: PersistedCameraState = DEFAULT_CAMERA_STATE,
): PersistedCameraState {
	if (!isRecord(value)) {
		return fallback;
	}
	const position = finiteTuple(value.position, true);
	const up = finiteTuple(value.up, true);
	const target = finiteTuple(value.target, false);
	if (
		position === undefined ||
		up === undefined ||
		target === undefined
	) {
		return fallback;
	}
	return Object.freeze({ position, up, target });
}

function parseDescriptorEdge(
	value: unknown,
	nodeIds: ReadonlySet<string>,
): GraphDescriptorEdge | undefined {
	if (
		!isRecord(value) ||
		typeof value.sourceId !== "string" ||
		typeof value.targetId !== "string" ||
		value.sourceId === value.targetId ||
		!nodeIds.has(value.sourceId) ||
		!nodeIds.has(value.targetId) ||
		!isFiniteNumber(value.weight) ||
		!isFiniteNumber(value.forwardWeight) ||
		!isFiniteNumber(value.backwardWeight) ||
		value.weight <= 0 ||
		value.forwardWeight < 0 ||
		value.backwardWeight < 0 ||
		Math.abs(
			value.weight - value.forwardWeight - value.backwardWeight,
		) > 1e-8
	) {
		return undefined;
	}

	if (compareCodeUnits(value.sourceId, value.targetId) < 0) {
		return Object.freeze({
			sourceId: value.sourceId,
			targetId: value.targetId,
			weight: value.weight,
			forwardWeight: value.forwardWeight,
			backwardWeight: value.backwardWeight,
		});
	}
	return Object.freeze({
		sourceId: value.targetId,
		targetId: value.sourceId,
		weight: value.weight,
		forwardWeight: value.backwardWeight,
		backwardWeight: value.forwardWeight,
	});
}

export function validateGraphDescriptor(
	value: unknown,
): GraphDescriptor | undefined {
	if (
		!isRecord(value) ||
		!isUnknownArray(value.nodeIds) ||
		!value.nodeIds.every((id) => typeof id === "string" && id.length > 0) ||
		!Array.isArray(value.edges) ||
		typeof value.filterSignature !== "string" ||
		value.filterSignature.length === 0
	) {
		return undefined;
	}
	const rawNodeIds = value.nodeIds.filter(
		(id): id is string => typeof id === "string" && id.length > 0,
	);
	if (rawNodeIds.length !== value.nodeIds.length) {
		return undefined;
	}
	const nodeIds = [...new Set(rawNodeIds)].sort(compareCodeUnits);
	if (nodeIds.length !== value.nodeIds.length) {
		return undefined;
	}
	const nodeSet = new Set(nodeIds);
	const edges: GraphDescriptorEdge[] = [];
	const edgeKeys = new Set<string>();
	for (const rawEdge of value.edges) {
		const edge = parseDescriptorEdge(rawEdge, nodeSet);
		if (edge === undefined) {
			return undefined;
		}
		const key = `${edge.sourceId.length}:${edge.sourceId}${edge.targetId}`;
		if (edgeKeys.has(key)) {
			return undefined;
		}
		edgeKeys.add(key);
		edges.push(edge);
	}
	edges.sort((left, right) => {
		const sourceOrder = compareCodeUnits(left.sourceId, right.sourceId);
		return sourceOrder === 0
			? compareCodeUnits(left.targetId, right.targetId)
			: sourceOrder;
	});
	return Object.freeze({
		nodeIds: Object.freeze(nodeIds),
		edges: Object.freeze(edges),
		filterSignature: value.filterSignature,
	});
}

export function validatePersistedLayoutSnapshot(
	value: unknown,
): PersistedLayoutSnapshot | undefined {
	if (
		!isRecord(value) ||
		typeof value.snapshotId !== "string" ||
		value.snapshotId.length === 0 ||
		value.schemaVersion !== CURRENT_SCHEMA_VERSION ||
		!isNonNegativeInteger(value.algorithmVersion) ||
		value.algorithmVersion === 0 ||
		typeof value.graphSignature !== "string" ||
		value.graphSignature.length === 0 ||
		(value.modeThatCreatedIt !== "initialize" &&
			value.modeThatCreatedIt !== "refresh" &&
			value.modeThatCreatedIt !== "renew") ||
		!isNonNegativeInteger(value.effectiveSeed) ||
		!isNonNegativeInteger(value.renewGeneration) ||
		!isFiniteNumber(value.completedAt) ||
		value.completedAt < 0 ||
		!isRecord(value.positionsByPath)
	) {
		return undefined;
	}
	const descriptor = validateGraphDescriptor(value.graphDescriptor);
	if (
		descriptor === undefined ||
		createGraphSignature(descriptor) !== value.graphSignature
	) {
		return undefined;
	}

	const positionKeys = Object.keys(value.positionsByPath).sort(
		compareCodeUnits,
	);
	if (
		positionKeys.length !== descriptor.nodeIds.length ||
		positionKeys.some(
			(path, index) => path !== descriptor.nodeIds[index],
		)
	) {
		return undefined;
	}
	const positionsByPath: Record<string, Vector3Tuple> = {};
	for (const path of positionKeys) {
		const position = validateAndNormalizePosition(
			value.positionsByPath[path],
		);
		if (position === undefined) {
			return undefined;
		}
		positionsByPath[path] = position;
	}
	const geography =
		value.geography === undefined
			? undefined
			: validateContinentalGeography(value.geography, descriptor);
	if (value.geography !== undefined && geography === undefined) {
		return undefined;
	}

	return Object.freeze({
		snapshotId: value.snapshotId,
		schemaVersion: CURRENT_SCHEMA_VERSION,
		algorithmVersion: value.algorithmVersion,
		graphSignature: value.graphSignature,
		modeThatCreatedIt: value.modeThatCreatedIt,
		effectiveSeed: value.effectiveSeed,
		renewGeneration: value.renewGeneration,
		completedAt: value.completedAt,
		positionsByPath: Object.freeze(positionsByPath),
		graphDescriptor: descriptor,
		...(geography === undefined ? {} : { geography }),
	});
}

function validatePersistedContinent(
	value: unknown,
	validNodeIds: ReadonlySet<string>,
): PersistedContinent | undefined {
	if (
		!isRecord(value) ||
		typeof value.id !== "string" ||
		value.id.length === 0 ||
		typeof value.label !== "string" ||
		value.label.length === 0 ||
		!Array.isArray(value.nodeIds) ||
		value.nodeIds.length === 0 ||
		!value.nodeIds.every(
			(nodeId) =>
				typeof nodeId === "string" &&
				validNodeIds.has(nodeId),
		) ||
		new Set(value.nodeIds).size !== value.nodeIds.length ||
		!isFiniteNumber(value.capRadius) ||
		value.capRadius < 0.1 ||
		value.capRadius > 1.2 ||
		!isNonNegativeInteger(value.colorIndex) ||
		value.colorIndex >= CONTINENT_COLOR_COUNT ||
		!isFiniteNumber(value.stability) ||
		value.stability < 0 ||
		value.stability > 1 ||
		!isFiniteNumber(value.conductance) ||
		value.conductance < 0 ||
		value.conductance > 1
	) {
		return undefined;
	}
	const center = validateAndNormalizePosition(value.center);
	if (center === undefined) {
		return undefined;
	}
	const parsedNodeIds = value.nodeIds.filter(
		(nodeId): nodeId is string => typeof nodeId === "string",
	);
	return Object.freeze({
		id: value.id,
		label: value.label,
		nodeIds: Object.freeze(parsedNodeIds.sort(compareCodeUnits)),
		center,
		capRadius: value.capRadius,
		colorIndex: value.colorIndex,
		stability: value.stability,
		conductance: value.conductance,
	});
}

export function validateContinentalGeography(
	value: unknown,
	descriptor: GraphDescriptor,
): PersistedContinentalGeography | undefined {
	if (
		!isRecord(value) ||
		value.version !== CONTINENTAL_GEOGRAPHY_VERSION ||
		!isUnknownArray(value.continents) ||
		!isUnknownArray(value.islandNodeIds)
	) {
		return undefined;
	}
	const validNodeIds = new Set(descriptor.nodeIds);
	const assigned = new Set<string>();
	const continentIds = new Set<string>();
	const continents: PersistedContinent[] = [];
	for (const rawContinent of value.continents) {
		const continent = validatePersistedContinent(
			rawContinent,
			validNodeIds,
		);
		if (
			continent === undefined ||
			continentIds.has(continent.id) ||
			continent.nodeIds.some((nodeId) => assigned.has(nodeId))
		) {
			return undefined;
		}
		continentIds.add(continent.id);
		for (const nodeId of continent.nodeIds) {
			assigned.add(nodeId);
		}
		continents.push(continent);
	}
	const islandNodeIds = value.islandNodeIds.filter(
		(nodeId): nodeId is string => typeof nodeId === "string",
	);
	if (
		islandNodeIds.length !== value.islandNodeIds.length ||
		!islandNodeIds.every(
			(nodeId) =>
				validNodeIds.has(nodeId) &&
				!assigned.has(nodeId),
		) ||
		new Set(islandNodeIds).size !== islandNodeIds.length
	) {
		return undefined;
	}
	for (const nodeId of islandNodeIds) {
		assigned.add(nodeId);
	}
	const linkedNodeIds = new Set<string>();
	for (const edge of descriptor.edges) {
		linkedNodeIds.add(edge.sourceId);
		linkedNodeIds.add(edge.targetId);
	}
	if (
		descriptor.nodeIds.some(
			(nodeId) =>
				!assigned.has(nodeId) && linkedNodeIds.has(nodeId),
		)
	) {
		return undefined;
	}
	// Geography is intentionally non-exhaustive only for true orphan notes.
	// Any omitted linked node indicates truncated or corrupt persisted data.
	return Object.freeze({
		version: CONTINENTAL_GEOGRAPHY_VERSION,
		continents: Object.freeze(continents),
		islandNodeIds: Object.freeze(islandNodeIds.sort(compareCodeUnits)),
	});
}

export function validateCompletedPositions(
	positions: ArrayLike<number>,
	nodePaths: readonly string[],
	normTolerance = DEFAULT_POSITION_NORM_TOLERANCE,
): ValidatedCompletedPositions | undefined {
	if (
		positions.length !== nodePaths.length * 3 ||
		!Number.isFinite(normTolerance) ||
		normTolerance < 0 ||
		new Set(nodePaths).size !== nodePaths.length
	) {
		return undefined;
	}
	const positionsByPath: Record<string, Vector3Tuple> = {};
	let maxNormError = 0;
	for (let index = 0; index < nodePaths.length; index += 1) {
		const path = nodePaths[index];
		const x = positions[index * 3];
		const y = positions[index * 3 + 1];
		const z = positions[index * 3 + 2];
		if (
			path === undefined ||
			x === undefined ||
			y === undefined ||
			z === undefined ||
			!Number.isFinite(x) ||
			!Number.isFinite(y) ||
			!Number.isFinite(z)
		) {
			return undefined;
		}
		const norm = Math.hypot(x, y, z);
		if (!Number.isFinite(norm) || norm <= Number.EPSILON) {
			return undefined;
		}
		const error = Math.abs(norm - 1);
		maxNormError = Math.max(maxNormError, error);
		if (error > normTolerance) {
			return undefined;
		}
		positionsByPath[path] = Object.freeze([
			x / norm,
			y / norm,
			z / norm,
		]);
	}
	return Object.freeze({
		positionsByPath: Object.freeze(positionsByPath),
		maxNormError,
	});
}

export function createCommittedLayoutSnapshot(
	input: CompletedLayoutInput,
): PersistedLayoutSnapshot | undefined {
	const algorithmVersion =
		input.algorithmVersion ?? CURRENT_ALGORITHM_VERSION;
	const validated = validateCompletedPositions(
		input.positions,
		input.graph.nodes.map((node) => node.path),
		input.normTolerance,
	);
	if (
		validated === undefined ||
		input.snapshotId.length === 0 ||
		!isNonNegativeInteger(input.effectiveSeed) ||
		!isNonNegativeInteger(input.renewGeneration) ||
		!isNonNegativeInteger(algorithmVersion) ||
		algorithmVersion === 0 ||
		!isFiniteNumber(input.completedAt) ||
		input.completedAt < 0
	) {
		return undefined;
	}
	let geography: PersistedContinentalGeography;
	try {
		geography = createPersistedContinentalGeography(
			input.graph,
			input.positions,
			input.effectiveSeed,
			input.previousGeography,
		);
	} catch {
		return undefined;
	}
	return Object.freeze({
		snapshotId: input.snapshotId,
		schemaVersion: CURRENT_SCHEMA_VERSION,
		algorithmVersion,
		graphSignature: input.graph.signature,
		modeThatCreatedIt: input.mode,
		effectiveSeed: input.effectiveSeed,
		renewGeneration: input.renewGeneration,
		completedAt: input.completedAt,
		positionsByPath: validated.positionsByPath,
		graphDescriptor: input.graph.descriptor,
		geography,
	});
}

export function isSnapshotUsable(
	snapshot: PersistedLayoutSnapshot | undefined,
	graph: GraphData,
	algorithmVersion = CURRENT_ALGORITHM_VERSION,
): boolean {
	if (
		snapshot === undefined ||
		snapshot.algorithmVersion !== algorithmVersion
	) {
		return false;
	}
	if (graph.nodes.length === 0) {
		return true;
	}
	return graph.nodes.some(
		(node) => snapshot.positionsByPath[node.path] !== undefined,
	);
}

export function reconcileCommittedLayout(
	snapshot: PersistedLayoutSnapshot,
	graph: GraphData,
	renames: readonly GraphRename[] = [],
): ReconciledCommittedLayout {
	const currentIds = new Set(graph.nodes.map((node) => node.path));
	const renamedFromByCurrentPath = new Map(
		renames.map((rename) => [rename.newPath, rename.oldPath] as const),
	);
	const consumedOldPaths = new Set<string>();
	const visibleNodeIds: string[] = [];
	const pendingNodeIds: string[] = [];
	const visiblePositions: Record<string, Vector3Tuple> = {};
	const oldToVisibleIndex = new Map<number, number>();
	const visibleSourceNodes: GraphNode[] = [];
	for (const node of graph.nodes) {
		const renamedFrom = renamedFromByCurrentPath.get(node.path);
		const position =
			snapshot.positionsByPath[node.path] ??
			(renamedFrom === undefined
				? undefined
				: snapshot.positionsByPath[renamedFrom]);
		if (position === undefined) {
			pendingNodeIds.push(node.path);
		} else {
			if (renamedFrom !== undefined) {
				consumedOldPaths.add(renamedFrom);
			}
			oldToVisibleIndex.set(node.index, visibleSourceNodes.length);
			visibleSourceNodes.push(node);
			visibleNodeIds.push(node.path);
			visiblePositions[node.path] = position;
		}
	}
	const removedNodeIds = Object.keys(snapshot.positionsByPath)
		.filter(
			(path) => !currentIds.has(path) && !consumedOldPaths.has(path),
		)
		.sort(compareCodeUnits);
	const degrees = new Uint32Array(visibleSourceNodes.length);
	const weightedDegrees = new Float64Array(visibleSourceNodes.length);
	const edges: GraphEdge[] = [];
	for (const edge of graph.edges) {
		const source = oldToVisibleIndex.get(edge.source);
		const target = oldToVisibleIndex.get(edge.target);
		if (source === undefined || target === undefined) {
			continue;
		}
		degrees[source] = (degrees[source] ?? 0) + 1;
		degrees[target] = (degrees[target] ?? 0) + 1;
		weightedDegrees[source] =
			(weightedDegrees[source] ?? 0) + edge.weight;
		weightedDegrees[target] =
			(weightedDegrees[target] ?? 0) + edge.weight;
		edges.push(
			Object.freeze({
				source,
				target,
				weight: edge.weight,
				forwardWeight: edge.forwardWeight,
				backwardWeight: edge.backwardWeight,
			}),
		);
	}
	const nodes = visibleSourceNodes.map((node, index) =>
		Object.freeze({
			...node,
			index,
			degree: degrees[index] ?? 0,
			weightedDegree: weightedDegrees[index] ?? 0,
		}),
	);
	const positions = new Float32Array(nodes.length * 3);
	for (const node of nodes) {
		const position = visiblePositions[node.path];
		if (position === undefined) {
			continue;
		}
		positions[node.index * 3] = position[0];
		positions[node.index * 3 + 1] = position[1];
		positions[node.index * 3 + 2] = position[2];
	}
	return Object.freeze({
		nodes: Object.freeze(nodes),
		edges: Object.freeze(edges),
		positions,
		visibleNodeIds: Object.freeze(visibleNodeIds),
		pendingNodeIds: Object.freeze(pendingNodeIds),
		removedNodeIds: Object.freeze(removedNodeIds),
		positionsByPath: Object.freeze(visiblePositions),
	});
}

export function renameSnapshotPaths(
	snapshot: PersistedLayoutSnapshot,
	renames: readonly GraphRename[],
): PersistedLayoutSnapshot | undefined {
	const pathMap = new Map<string, string>();
	const newPaths = new Set<string>();
	for (const rename of renames) {
		if (
			rename.oldPath === rename.newPath ||
			snapshot.positionsByPath[rename.oldPath] === undefined ||
			snapshot.positionsByPath[rename.newPath] !== undefined ||
			pathMap.has(rename.oldPath) ||
			newPaths.has(rename.newPath)
		) {
			return undefined;
		}
		pathMap.set(rename.oldPath, rename.newPath);
		newPaths.add(rename.newPath);
	}
	if (pathMap.size === 0) {
		return snapshot;
	}

	const positionsByPath: Record<string, Vector3Tuple> = {};
	for (const [path, position] of Object.entries(
		snapshot.positionsByPath,
	)) {
		positionsByPath[pathMap.get(path) ?? path] = position;
	}
	const graphDescriptor = applyRenameMapToDescriptor(
		snapshot.graphDescriptor,
		pathMap,
	);
	const geography =
		snapshot.geography === undefined
			? undefined
			: Object.freeze({
					...snapshot.geography,
					continents: Object.freeze(
						snapshot.geography.continents.map((continent) =>
							Object.freeze({
								...continent,
								nodeIds: Object.freeze(
									continent.nodeIds.map(
										(nodeId) => pathMap.get(nodeId) ?? nodeId,
									),
								),
							}),
						),
					),
					islandNodeIds: Object.freeze(
						snapshot.geography.islandNodeIds.map(
							(nodeId) => pathMap.get(nodeId) ?? nodeId,
						),
					),
				});
	return Object.freeze({
		...snapshot,
		graphSignature: createGraphSignature(graphDescriptor),
		positionsByPath: Object.freeze(positionsByPath),
		graphDescriptor,
		...(geography === undefined ? {} : { geography }),
	});
}

export function pruneSnapshotPaths(
	snapshot: PersistedLayoutSnapshot,
	existingPaths: ReadonlySet<string>,
): PersistedLayoutSnapshot {
	const nodeIds = snapshot.graphDescriptor.nodeIds.filter((path) =>
		existingPaths.has(path),
	);
	const retained = new Set(nodeIds);
	const graphDescriptor: GraphDescriptor = Object.freeze({
		nodeIds: Object.freeze([...nodeIds]),
		edges: Object.freeze(
			snapshot.graphDescriptor.edges.filter(
				(edge) =>
					retained.has(edge.sourceId) && retained.has(edge.targetId),
			),
		),
		filterSignature: snapshot.graphDescriptor.filterSignature,
	});
	const positionsByPath: Record<string, Vector3Tuple> = {};
	for (const path of nodeIds) {
		const position = snapshot.positionsByPath[path];
		if (position !== undefined) {
			positionsByPath[path] = position;
		}
	}
	const geography =
		snapshot.geography === undefined
			? undefined
			: Object.freeze({
					...snapshot.geography,
					continents: Object.freeze(
						snapshot.geography.continents
							.map((continent) =>
								Object.freeze({
									...continent,
									nodeIds: Object.freeze(
										continent.nodeIds.filter((nodeId) =>
											retained.has(nodeId),
										),
									),
								}),
							)
							.filter((continent) => continent.nodeIds.length > 0),
					),
					islandNodeIds: Object.freeze(
						snapshot.geography.islandNodeIds.filter((nodeId) =>
							retained.has(nodeId),
						),
					),
				});
	return Object.freeze({
		...snapshot,
		graphSignature: createGraphSignature(graphDescriptor),
		positionsByPath: Object.freeze(positionsByPath),
		graphDescriptor,
		...(geography === undefined ? {} : { geography }),
	});
}

export function deriveEffectiveSeed(
	baseSeed: number,
	renewGeneration: number,
	graphSignature: string,
): number {
	return deterministicUint32([
		Math.trunc(baseSeed).toString(),
		Math.trunc(renewGeneration).toString(),
		graphSignature,
		CURRENT_ALGORITHM_VERSION.toString(),
	]);
}
