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
import { auxiliaryDirectionFromAnchors } from '../render/auxiliaryGeometry';
import type { Vec3 } from '../geometry/vector3';

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
		kind: 'note',
		isOrphan: node.degree === 0,
	}));
	const visibleEdges: RenderEdge[] = reconciled.edges.map((edge) => ({
		source: edge.source,
		target: edge.target,
		weight: edge.weight,
	}));
	const renderIndexById = new Map(
		visibleNodes.map((node) => [node.id, node.index] as const),
	);
	const positionByNodeId = new Map<string, Vec3>();
	for (const node of visibleNodes) {
		const offset = node.index * 3;
		const x = reconciled.positions[offset];
		const y = reconciled.positions[offset + 1];
		const z = reconciled.positions[offset + 2];
		if (x !== undefined && y !== undefined && z !== undefined) {
			positionByNodeId.set(node.id, [x, y, z]);
		}
	}
	const auxiliaryEdgesByTarget = new Map<
		string,
		ReadonlyArray<{ readonly sourceId: string; readonly weight: number }>
	>();
	for (const edge of graph.auxiliaryEdges ?? []) {
		const existing = auxiliaryEdgesByTarget.get(edge.targetId) ?? [];
		auxiliaryEdgesByTarget.set(edge.targetId, [
			...existing,
			{ sourceId: edge.sourceId, weight: edge.weight },
		]);
	}
	const auxiliaryPositions: number[] = [];
	for (const auxiliary of graph.auxiliaryNodes ?? []) {
		const references = auxiliaryEdgesByTarget.get(auxiliary.id) ?? [];
		const anchors = references
			.map((edge) => positionByNodeId.get(edge.sourceId))
			.filter((position): position is Vec3 => position !== undefined);
		const direction = auxiliaryDirectionFromAnchors(
			auxiliary.id,
			anchors,
		);
		const index = visibleNodes.length;
		visibleNodes.push({
			index,
			id: auxiliary.id,
			path: auxiliary.path,
			basename: auxiliary.basename,
			degree: auxiliary.degree,
			weightedDegree: auxiliary.weightedDegree,
			kind: auxiliary.kind,
			isOrphan: auxiliary.degree === 0,
		});
		renderIndexById.set(auxiliary.id, index);
		auxiliaryPositions.push(...direction);
	}
	for (const edge of graph.auxiliaryEdges ?? []) {
		const source = renderIndexById.get(edge.sourceId);
		const target = renderIndexById.get(edge.targetId);
		if (source !== undefined && target !== undefined) {
			visibleEdges.push({ source, target, weight: edge.weight });
		}
	}
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
	const renderMetadataSignature = hashString(
		[
			tags
				.map((tag) => `${tag.id}:${tag.nodeIndices.join(',')}`)
				.join('|'),
			...(graph.auxiliaryNodes ?? []).map(
				(node) =>
					`${node.kind}:${node.id}:${node.degree}:${node.weightedDegree}`,
			),
			...(graph.auxiliaryEdges ?? []).map(
				(edge) =>
					`${edge.sourceId}>${edge.targetId}:${edge.weight}`,
			),
		].join('|'),
	).toString(16);
	const positions =
		auxiliaryPositions.length === 0
			? reconciled.positions
			: new Float32Array([
					...reconciled.positions,
					...auxiliaryPositions,
				]);

	return {
		// Include the current topology so metadata-only updates still trigger an
		// atomic renderer refresh while coordinates retain the committed ID.
		snapshotId: `${snapshot.snapshotId}:${graph.signature}:${renderMetadataSignature}`,
		nodes: Object.freeze(visibleNodes),
		edges: Object.freeze(visibleEdges),
		tags: Object.freeze(tags),
		positions,
	};
}
