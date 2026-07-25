import type { GraphData } from '../graph/graphTypes';
import type { GraphRename } from '../graph/graphDiff';
import {
	reconcileCommittedLayout,
	type PersistedLayoutSnapshot,
} from '../persistence/layoutState';
import type {
	RenderEdge,
	RenderGraphSnapshot,
	RenderNode,
	RenderTag,
} from '../render/renderTypes';
import { hashString } from '../geometry/deterministicHash';

/**
 * Reconciles the current vault graph with the last committed position map.
 *
 * Nodes that do not yet have a committed position are intentionally omitted:
 * they remain pending until Refresh or Renew completes. Deleted nodes and their
 * incident edges disappear immediately without changing any surviving vector.
 */
export function createRenderGraphSnapshot(
	snapshot: PersistedLayoutSnapshot,
	graph: GraphData,
	renames: readonly GraphRename[] = [],
): RenderGraphSnapshot {
	const reconciled = reconcileCommittedLayout(snapshot, graph, renames);
	const visibleNodes: RenderNode[] = reconciled.nodes.map((node) => ({
		index: node.index,
		id: node.id,
		path: node.path,
		basename: node.basename,
		degree: node.degree,
		weightedDegree: node.weightedDegree,
	}));
	const visibleEdges: RenderEdge[] = reconciled.edges.map((edge) => ({
		source: edge.source,
		target: edge.target,
		weight: edge.weight,
	}));
	const tagsById = new Map<
		string,
		{ readonly label: string; readonly nodeIndices: number[] }
	>();
	for (const node of reconciled.nodes) {
		for (const label of node.tags ?? []) {
			const id = label.toLocaleLowerCase();
			const existing = tagsById.get(id);
			if (existing === undefined) {
				tagsById.set(id, { label, nodeIndices: [node.index] });
			} else {
				existing.nodeIndices.push(node.index);
			}
		}
	}
	const tags: RenderTag[] = [...tagsById.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([id, tag]) => ({
			id,
			label: tag.label,
			nodeIndices: Object.freeze([...tag.nodeIndices]),
		}));
	const tagSignature = hashString(
		tags
			.map((tag) => `${tag.id}:${tag.nodeIndices.join(',')}`)
			.join('|'),
	).toString(16);

	return {
		// Include the current topology so metadata-only updates still trigger an
		// atomic renderer refresh while coordinates retain the committed ID.
		snapshotId: `${snapshot.snapshotId}:${graph.signature}:${tagSignature}`,
		nodes: Object.freeze(visibleNodes),
		edges: Object.freeze(visibleEdges),
		tags: Object.freeze(tags),
		positions: reconciled.positions,
	};
}
