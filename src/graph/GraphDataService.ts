import type { MetadataCache, TFile, Vault } from "obsidian";

import {
	compareGraphIds,
	isPathExcluded,
	normalizeGraphFilterOptions,
	normalizeVaultPath,
} from "./graphFilters";
import {
	createFilterSignature,
	createGraphSignature,
} from "./graphSignature";
import {
	GraphData,
	GraphDataSource,
	GraphAuxiliaryEdge,
	GraphAuxiliaryNode,
	GraphDescriptorEdge,
	GraphEdge,
	GraphFilterOptions,
	GraphNode,
	MarkdownGraphFile,
} from "./graphTypes";

interface EdgeAccumulator {
	readonly sourceId: string;
	readonly targetId: string;
	forwardWeight: number;
	backwardWeight: number;
}

interface AuxiliaryEdgeAccumulator {
	readonly sourceId: string;
	readonly targetId: string;
	weight: number;
}

function basenameFromPath(path: string): string {
	const filename = path.slice(path.lastIndexOf("/") + 1);
	return filename.toLowerCase().endsWith(".md")
		? filename.slice(0, -3)
		: filename;
}

function validLinkWeight(value: number): boolean {
	return Number.isFinite(value) && value > 0;
}

function canonicalEdgeKey(sourceId: string, targetId: string): string {
	return `${sourceId.length}:${sourceId}${targetId}`;
}

function auxiliaryEdgeKey(sourceId: string, targetId: string): string {
	return `${sourceId.length}:${sourceId}${targetId.length}:${targetId}`;
}

function unresolvedNodeId(path: string): string {
	return `unresolved:${path}`;
}

export function normalizeGraphTags(
	values: readonly string[] | null | undefined,
): readonly string[] {
	const tagsByKey = new Map<string, string>();
	for (const value of values ?? []) {
		const body = value.trim().replace(/^#+/, "");
		if (body.length === 0) {
			continue;
		}
		const tag = `#${body}`;
		const key = tag.toLocaleLowerCase();
		if (!tagsByKey.has(key)) {
			tagsByKey.set(key, tag);
		}
	}
	return Object.freeze(
		[...tagsByKey.values()].sort(compareGraphIds),
	);
}

function compareDescriptorEdges(
	left: GraphDescriptorEdge,
	right: GraphDescriptorEdge,
): number {
	const sourceOrder = compareGraphIds(left.sourceId, right.sourceId);
	return sourceOrder !== 0
		? sourceOrder
		: compareGraphIds(left.targetId, right.targetId);
}

export function createObsidianGraphDataSource(
	vault: Pick<Vault, "getFiles" | "getMarkdownFiles">,
	metadataCache: Pick<
		MetadataCache,
		"resolvedLinks" | "unresolvedLinks"
	>,
	getTags?: (file: TFile) => readonly string[] | null,
): GraphDataSource {
	return {
		getMarkdownFiles: (): readonly MarkdownGraphFile[] =>
			vault.getMarkdownFiles().map((file) => ({
				path: file.path,
				basename: file.basename,
				tags: normalizeGraphTags(getTags?.(file)),
			})),
		getAttachmentFiles: () =>
			vault
				.getFiles()
				.filter((file) => file.extension.toLowerCase() !== "md")
				.map((file) => ({
					path: file.path,
					basename: file.basename,
				})),
		getResolvedLinks: () => metadataCache.resolvedLinks,
		getUnresolvedLinks: () => metadataCache.unresolvedLinks,
	};
}

export class GraphDataService {
	private readonly source: GraphDataSource;

	constructor(source: GraphDataSource) {
		this.source = source;
	}

	buildGraph(options?: Partial<GraphFilterOptions>): GraphData {
		const filters = normalizeGraphFilterOptions(options);
		const filterSignature = createFilterSignature(
			filters.includeOrphans,
			filters.excludedFolderPrefixes,
		);

		const filesByPath = new Map<string, MarkdownGraphFile>();
		for (const file of this.source.getMarkdownFiles()) {
			const path = normalizeVaultPath(file.path);
			if (
				path.length === 0 ||
				isPathExcluded(path, filters.excludedFolderPrefixes)
			) {
				continue;
			}
			filesByPath.set(path, {
				path,
				basename:
					file.basename.trim().length > 0
						? file.basename
						: basenameFromPath(path),
				tags: normalizeGraphTags(file.tags),
			});
		}

		const attachmentsByPath = new Map<
			string,
			{ readonly path: string; readonly basename: string }
		>();
		for (const file of this.source.getAttachmentFiles?.() ?? []) {
			const path = normalizeVaultPath(file.path);
			if (
				path.length === 0 ||
				isPathExcluded(path, filters.excludedFolderPrefixes)
			) {
				continue;
			}
			attachmentsByPath.set(path, {
				path,
				basename:
					file.basename.trim().length > 0
						? file.basename
						: basenameFromPath(path),
			});
		}

		const edgeAccumulators = new Map<string, EdgeAccumulator>();
		const auxiliaryEdgeAccumulators = new Map<
			string,
			AuxiliaryEdgeAccumulator
		>();
		const accumulateAuxiliaryEdge = (
			sourceId: string,
			targetId: string,
			weight: number,
		): void => {
			const key = auxiliaryEdgeKey(sourceId, targetId);
			const existing = auxiliaryEdgeAccumulators.get(key);
			if (existing === undefined) {
				auxiliaryEdgeAccumulators.set(key, {
					sourceId,
					targetId,
					weight,
				});
			} else {
				existing.weight += weight;
			}
		};
		const resolvedLinks = this.source.getResolvedLinks();
		const sourcePaths = Object.keys(resolvedLinks).sort(compareGraphIds);

		for (const rawSourcePath of sourcePaths) {
			const sourcePath = normalizeVaultPath(rawSourcePath);
			if (!filesByPath.has(sourcePath)) {
				continue;
			}

			const targets = resolvedLinks[rawSourcePath];
			if (targets === undefined) {
				continue;
			}

			for (const rawTargetPath of Object.keys(targets).sort(compareGraphIds)) {
				const targetPath = normalizeVaultPath(rawTargetPath);
				const weight = targets[rawTargetPath];
				if (
					sourcePath === targetPath ||
					weight === undefined ||
					!validLinkWeight(weight)
				) {
					continue;
				}
				if (!filesByPath.has(targetPath)) {
					if (attachmentsByPath.has(targetPath)) {
						accumulateAuxiliaryEdge(
							sourcePath,
							targetPath,
							weight,
						);
					}
					continue;
				}

				const sourceIsFirst =
					compareGraphIds(sourcePath, targetPath) < 0;
				const first = sourceIsFirst ? sourcePath : targetPath;
				const second = sourceIsFirst ? targetPath : sourcePath;
				const key = canonicalEdgeKey(first, second);
				let accumulator = edgeAccumulators.get(key);
				if (accumulator === undefined) {
					accumulator = {
						sourceId: first,
						targetId: second,
						forwardWeight: 0,
						backwardWeight: 0,
					};
					edgeAccumulators.set(key, accumulator);
				}

				if (sourceIsFirst) {
					accumulator.forwardWeight += weight;
				} else {
					accumulator.backwardWeight += weight;
				}
			}
		}

		const unresolvedLabelsById = new Map<string, string>();
		const unresolvedLinks = this.source.getUnresolvedLinks?.() ?? {};
		for (const rawSourcePath of Object.keys(unresolvedLinks).sort(
			compareGraphIds,
		)) {
			const sourcePath = normalizeVaultPath(rawSourcePath);
			if (!filesByPath.has(sourcePath)) {
				continue;
			}
			const targets = unresolvedLinks[rawSourcePath];
			if (targets === undefined) {
				continue;
			}
			for (const rawTargetPath of Object.keys(targets).sort(
				compareGraphIds,
			)) {
				const targetPath = normalizeVaultPath(rawTargetPath);
				const weight = targets[rawTargetPath];
				if (
					targetPath.length === 0 ||
					isPathExcluded(
						targetPath,
						filters.excludedFolderPrefixes,
					) ||
					weight === undefined ||
					!validLinkWeight(weight)
				) {
					continue;
				}
				const targetId = unresolvedNodeId(targetPath);
				unresolvedLabelsById.set(targetId, targetPath);
				accumulateAuxiliaryEdge(sourcePath, targetId, weight);
			}
		}

		const descriptorEdges: GraphDescriptorEdge[] = [
			...edgeAccumulators.values(),
		]
			.map((edge) => ({
				sourceId: edge.sourceId,
				targetId: edge.targetId,
				weight: edge.forwardWeight + edge.backwardWeight,
				forwardWeight: edge.forwardWeight,
				backwardWeight: edge.backwardWeight,
			}))
			.sort(compareDescriptorEdges);

		const connectedIds = new Set<string>();
		for (const edge of descriptorEdges) {
			connectedIds.add(edge.sourceId);
			connectedIds.add(edge.targetId);
		}

		const nodeIds = [...filesByPath.keys()]
			.filter((id) => filters.includeOrphans || connectedIds.has(id))
			.sort(compareGraphIds);
		const includedIds = new Set(nodeIds);
		const includedDescriptorEdges = descriptorEdges.filter(
			(edge) =>
				includedIds.has(edge.sourceId) && includedIds.has(edge.targetId),
		);
		const indexById = new Map(
			nodeIds.map((id, index) => [id, index] as const),
		);

		const degree = new Uint32Array(nodeIds.length);
		const weightedDegree = new Float64Array(nodeIds.length);
		const edges: GraphEdge[] = [];
		for (const edge of includedDescriptorEdges) {
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

		const nodes: GraphNode[] = nodeIds.map((id, index) => {
			const file = filesByPath.get(id);
			return Object.freeze({
				index,
				id,
				path: id,
				basename: file?.basename ?? basenameFromPath(id),
				degree: degree[index] ?? 0,
				weightedDegree: weightedDegree[index] ?? 0,
				tags: file?.tags ?? Object.freeze([]),
				exists: true as const,
			});
		});
		const includedAuxiliaryEdges: GraphAuxiliaryEdge[] = [
			...auxiliaryEdgeAccumulators.values(),
		]
			.filter((edge) => includedIds.has(edge.sourceId))
			.map((edge) =>
				Object.freeze({
					sourceId: edge.sourceId,
					targetId: edge.targetId,
					weight: edge.weight,
				}),
			)
			.sort(
				(left, right) =>
					compareGraphIds(left.targetId, right.targetId) ||
					compareGraphIds(left.sourceId, right.sourceId),
			);
		const auxiliaryDegree = new Map<
			string,
			{ degree: number; weightedDegree: number }
		>();
		for (const edge of includedAuxiliaryEdges) {
			const current = auxiliaryDegree.get(edge.targetId) ?? {
				degree: 0,
				weightedDegree: 0,
			};
			current.degree += 1;
			current.weightedDegree += edge.weight;
			auxiliaryDegree.set(edge.targetId, current);
		}
		const auxiliaryNodes: GraphAuxiliaryNode[] = [
			...[...attachmentsByPath.values()].map((file) => {
				const metrics = auxiliaryDegree.get(file.path);
				return Object.freeze({
					id: file.path,
					path: file.path,
					basename: file.basename,
					kind: "attachment" as const,
					degree: metrics?.degree ?? 0,
					weightedDegree: metrics?.weightedDegree ?? 0,
				});
			}),
			...[...unresolvedLabelsById.entries()].map(([id, path]) => {
				const metrics = auxiliaryDegree.get(id);
				return Object.freeze({
					id,
					path,
					basename: basenameFromPath(path),
					kind: "unresolved" as const,
					degree: metrics?.degree ?? 0,
					weightedDegree: metrics?.weightedDegree ?? 0,
				});
			}),
		].sort((left, right) => compareGraphIds(left.id, right.id));
		const descriptor = Object.freeze({
			nodeIds: Object.freeze([...nodeIds]),
			edges: Object.freeze(
				includedDescriptorEdges.map((edge) => Object.freeze({ ...edge })),
			),
			filterSignature,
		});

		return Object.freeze({
			nodes: Object.freeze(nodes),
			edges: Object.freeze(edges),
			auxiliaryNodes: Object.freeze(auxiliaryNodes),
			auxiliaryEdges: Object.freeze(includedAuxiliaryEdges),
			signature: createGraphSignature(descriptor),
			filterSignature,
			descriptor,
		});
	}
}
