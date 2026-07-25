export interface GraphNode {
	readonly index: number;
	readonly id: string;
	readonly path: string;
	readonly basename: string;
	readonly degree: number;
	readonly weightedDegree: number;
	readonly tags?: readonly string[];
	readonly exists: true;
}

export interface GraphEdge {
	readonly source: number;
	readonly target: number;
	readonly weight: number;
	readonly forwardWeight: number;
	readonly backwardWeight: number;
}

/**
 * Serializable, index-independent edge representation used by persistence and
 * graph diffing. `sourceId` is always lexicographically smaller than
 * `targetId`; forward/backward weights are relative to that ordering.
 */
export interface GraphDescriptorEdge {
	readonly sourceId: string;
	readonly targetId: string;
	readonly weight: number;
	readonly forwardWeight: number;
	readonly backwardWeight: number;
}

export interface GraphDescriptor {
	readonly nodeIds: readonly string[];
	readonly edges: readonly GraphDescriptorEdge[];
	readonly filterSignature: string;
}

export interface GraphData {
	readonly nodes: readonly GraphNode[];
	readonly edges: readonly GraphEdge[];
	readonly signature: string;
	readonly filterSignature: string;
	readonly descriptor: GraphDescriptor;
}

export interface GraphFilterOptions {
	readonly excludedFolderPrefixes: readonly string[];
	readonly includeOrphans: boolean;
}

export const DEFAULT_GRAPH_FILTER_OPTIONS: GraphFilterOptions = Object.freeze({
	excludedFolderPrefixes: Object.freeze([]),
	includeOrphans: true,
});

export interface MarkdownGraphFile {
	readonly path: string;
	readonly basename: string;
	readonly tags?: readonly string[];
}

export type ResolvedLinkIndex = Readonly<
	Record<string, Readonly<Record<string, number>>>
>;

export interface GraphDataSource {
	getMarkdownFiles(): readonly MarkdownGraphFile[];
	getResolvedLinks(): ResolvedLinkIndex;
}
