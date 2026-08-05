import { compareGraphIds } from '../graph/graphFilters';
import { normalizeGraphTags } from '../graph/GraphDataService';
import type {
	GraphAuxiliaryEdge,
	GraphAuxiliaryNode,
	GraphData,
	GraphDescriptor,
	GraphEdge,
	GraphNode,
} from '../graph/graphTypes';
import { isRecord } from './layoutState';

export const PERSISTED_GRAPH_CACHE_VERSION = 1;

export interface PersistedGraphNodeMetadata {
	readonly id: string;
	readonly basename: string;
	readonly tags: readonly string[];
}

/**
 * Metadata that is not part of the solver descriptor but is required to
 * render a saved map without scanning the vault first. The descriptor and
 * continent geography remain owned by PersistedLayoutSnapshot.
 */
export interface PersistedGraphCache {
	readonly version: number;
	readonly graphSignature: string;
	readonly nodes: readonly PersistedGraphNodeMetadata[];
	readonly auxiliaryNodes: readonly GraphAuxiliaryNode[];
	readonly auxiliaryEdges: readonly GraphAuxiliaryEdge[];
}

function basenameFromPath(path: string): string {
	const filename = path.slice(path.lastIndexOf('/') + 1);
	return filename.toLowerCase().endsWith('.md')
		? filename.slice(0, -3)
		: filename;
}

function finiteNonNegative(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function validId(value: unknown): value is string {
	return typeof value === 'string' && value.trim().length > 0;
}

export function createPersistedGraphCache(graph: GraphData): PersistedGraphCache {
	return Object.freeze({
		version: PERSISTED_GRAPH_CACHE_VERSION,
		graphSignature: graph.signature,
		nodes: Object.freeze(
			graph.nodes.map((node) =>
				Object.freeze({
					id: node.id,
					basename: node.basename,
					tags: normalizeGraphTags(node.tags),
				}),
			),
		),
		auxiliaryNodes: Object.freeze(
			(graph.auxiliaryNodes ?? []).map((node) => Object.freeze({ ...node })),
		),
		auxiliaryEdges: Object.freeze(
			(graph.auxiliaryEdges ?? []).map((edge) => Object.freeze({ ...edge })),
		),
	});
}

export function validatePersistedGraphCache(
	value: unknown,
): PersistedGraphCache | undefined {
	if (
		!isRecord(value) ||
		value.version !== PERSISTED_GRAPH_CACHE_VERSION ||
		!validId(value.graphSignature) ||
		!Array.isArray(value.nodes) ||
		!Array.isArray(value.auxiliaryNodes) ||
		!Array.isArray(value.auxiliaryEdges)
	) {
		return undefined;
	}
	const nodeIds = new Set<string>();
	const nodes: PersistedGraphNodeMetadata[] = [];
	for (const raw of value.nodes) {
		if (
			!isRecord(raw) ||
			!validId(raw.id) ||
			typeof raw.basename !== 'string' ||
			!Array.isArray(raw.tags) ||
			raw.tags.some((tag) => typeof tag !== 'string') ||
			nodeIds.has(raw.id)
		) {
			return undefined;
		}
		nodeIds.add(raw.id);
		nodes.push(
			Object.freeze({
				id: raw.id,
				basename:
					raw.basename.trim().length > 0
						? raw.basename
						: basenameFromPath(raw.id),
				tags: normalizeGraphTags(raw.tags as string[]),
			}),
		);
	}
	const auxiliaryIds = new Set<string>();
	const auxiliaryNodes: GraphAuxiliaryNode[] = [];
	for (const raw of value.auxiliaryNodes) {
		if (
			!isRecord(raw) ||
			!validId(raw.id) ||
			!validId(raw.path) ||
			typeof raw.basename !== 'string' ||
			(raw.kind !== 'attachment' && raw.kind !== 'unresolved') ||
			!finiteNonNegative(raw.degree) ||
			!finiteNonNegative(raw.weightedDegree) ||
			auxiliaryIds.has(raw.id)
		) {
			return undefined;
		}
		auxiliaryIds.add(raw.id);
		auxiliaryNodes.push(
			Object.freeze({
				id: raw.id,
				path: raw.path,
				basename: raw.basename,
				kind: raw.kind,
				degree: raw.degree,
				weightedDegree: raw.weightedDegree,
			}),
		);
	}
	const auxiliaryEdges: GraphAuxiliaryEdge[] = [];
	for (const raw of value.auxiliaryEdges) {
		if (
			!isRecord(raw) ||
			!validId(raw.sourceId) ||
			!validId(raw.targetId) ||
			!finiteNonNegative(raw.weight) ||
			!nodeIds.has(raw.sourceId) ||
			!auxiliaryIds.has(raw.targetId)
		) {
			return undefined;
		}
		auxiliaryEdges.push(
			Object.freeze({
				sourceId: raw.sourceId,
				targetId: raw.targetId,
				weight: raw.weight,
			}),
		);
	}
	return Object.freeze({
		version: PERSISTED_GRAPH_CACHE_VERSION,
		graphSignature: value.graphSignature,
		nodes: Object.freeze(nodes.sort((a, b) => compareGraphIds(a.id, b.id))),
		auxiliaryNodes: Object.freeze(
			auxiliaryNodes.sort((a, b) => compareGraphIds(a.id, b.id)),
		),
		auxiliaryEdges: Object.freeze(auxiliaryEdges),
	});
}

/** Restores the exact saved render graph without touching the live vault. */
export function restoreGraphData(
	descriptor: GraphDescriptor,
	graphSignature: string,
	cache: PersistedGraphCache | undefined,
): GraphData {
	const usableCache =
		cache?.graphSignature === graphSignature ? cache : undefined;
	const metadataById = new Map(
		(usableCache?.nodes ?? []).map((node) => [node.id, node] as const),
	);
	const indexById = new Map(
		descriptor.nodeIds.map((id, index) => [id, index] as const),
	);
	const degree = new Uint32Array(descriptor.nodeIds.length);
	const weightedDegree = new Float64Array(descriptor.nodeIds.length);
	const edges: GraphEdge[] = [];
	for (const edge of descriptor.edges) {
		const source = indexById.get(edge.sourceId);
		const target = indexById.get(edge.targetId);
		if (source === undefined || target === undefined) {
			continue;
		}
		degree[source] = (degree[source] ?? 0) + 1;
		degree[target] = (degree[target] ?? 0) + 1;
		weightedDegree[source] =
			(weightedDegree[source] ?? 0) + edge.weight;
		weightedDegree[target] =
			(weightedDegree[target] ?? 0) + edge.weight;
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
	const nodes: GraphNode[] = descriptor.nodeIds.map((id, index) => {
		const metadata = metadataById.get(id);
		return Object.freeze({
			index,
			id,
			path: id,
			basename: metadata?.basename ?? basenameFromPath(id),
			degree: degree[index] ?? 0,
			weightedDegree: weightedDegree[index] ?? 0,
			tags: metadata?.tags ?? Object.freeze([]),
			exists: true as const,
		});
	});
	return Object.freeze({
		nodes: Object.freeze(nodes),
		edges: Object.freeze(edges),
		auxiliaryNodes: usableCache?.auxiliaryNodes ?? Object.freeze([]),
		auxiliaryEdges: usableCache?.auxiliaryEdges ?? Object.freeze([]),
		signature: graphSignature,
		filterSignature: descriptor.filterSignature,
		descriptor,
	});
}
