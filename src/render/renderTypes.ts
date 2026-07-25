import { AppearanceSettings } from '../settings/settings';

export interface RenderNode {
	index: number;
	id: string;
	path: string;
	basename: string;
	degree: number;
	weightedDegree: number;
}

export interface RenderEdge {
	source: number;
	target: number;
	weight: number;
}

export interface RenderTag {
	id: string;
	label: string;
	nodeIndices: readonly number[];
}

export interface RenderGraphSnapshot {
	snapshotId: string;
	nodes: readonly RenderNode[];
	edges: readonly RenderEdge[];
	tags?: readonly RenderTag[];
	/**
	 * Packed intrinsic unit vectors in node-index order. Render code copies this
	 * buffer on an atomic swap and never writes to the caller's buffer.
	 */
	positions: Float32Array;
}

export interface CameraState {
	position: [number, number, number];
	up: [number, number, number];
	target: [number, number, number];
}

export interface RenderSelectionState {
	activeNodeId?: string;
	hoveredNodeId?: string;
	selectedNodeId?: string;
}

export interface RenderTheme {
	background: string;
	node: string;
	nodeNeighbor: string;
	nodeActive: string;
	nodeHovered: string;
	nodeSelected: string;
	nodeRoute: string;
	nodeRouteStart: string;
	nodeRouteEnd: string;
	edge: string;
	edgeSelected: string;
	edgeRoute: string;
	graticule: string;
	tag: string;
	tagSoft: string;
	tagEdge: string;
	sphere: string;
}

export interface RenderRouteState {
	startNodeId: string;
	endNodeId?: string;
	nodeIds: readonly string[];
	edges: ReadonlyArray<{
		source: number;
		target: number;
	}>;
}

export interface RendererCallbacks {
	onHover?(node: RenderNode | undefined): void;
	onSelect?(node: RenderNode | undefined): void;
	onSelectTag?(tag: RenderTag | undefined): void;
	onOpenNode?(node: RenderNode, openInNewLeaf: boolean): void;
	onCameraChange?(camera: CameraState): void;
	onContextError?(message: string): void;
	onContextRestored?(): void;
}

export interface RendererOptions {
	appearance: AppearanceSettings;
	camera?: CameraState;
	callbacks?: RendererCallbacks;
}

export interface PreparedRenderSnapshot {
	snapshotId: string;
	nodes: readonly RenderNode[];
	edges: readonly RenderEdge[];
	tags: readonly RenderTag[];
	positions: Float32Array;
	nodeById: ReadonlyMap<string, RenderNode>;
	nodeByIndex: ReadonlyMap<number, RenderNode>;
	neighborsByIndex: ReadonlyMap<number, ReadonlySet<number>>;
	tagById: ReadonlyMap<string, RenderTag>;
	tagsByNodeIndex: ReadonlyMap<number, readonly RenderTag[]>;
}

const MAX_UNIT_NORM_ERROR = 1e-3;

export function prepareRenderSnapshot(
	snapshot: RenderGraphSnapshot,
): PreparedRenderSnapshot {
	if (snapshot.positions.length !== snapshot.nodes.length * 3) {
		throw new Error(
			`Position buffer has ${snapshot.positions.length} values for ${snapshot.nodes.length} nodes.`,
		);
	}

	const nodeById = new Map<string, RenderNode>();
	const nodeByIndex = new Map<number, RenderNode>();
	const neighbors = new Map<number, Set<number>>();
	for (const node of snapshot.nodes) {
		if (
			!Number.isInteger(node.index) ||
			node.index < 0 ||
			node.index >= snapshot.nodes.length ||
			nodeByIndex.has(node.index) ||
			nodeById.has(node.id)
		) {
			throw new Error(`Invalid or duplicate render node: ${node.id}.`);
		}
		const offset = node.index * 3;
		const x = snapshot.positions[offset];
		const y = snapshot.positions[offset + 1];
		const z = snapshot.positions[offset + 2];
		if (
			x === undefined ||
			y === undefined ||
			z === undefined ||
			!Number.isFinite(x) ||
			!Number.isFinite(y) ||
			!Number.isFinite(z)
		) {
			throw new Error(`Node ${node.id} has a non-finite position.`);
		}
		const norm = Math.hypot(x, y, z);
		if (!Number.isFinite(norm) || Math.abs(norm - 1) > MAX_UNIT_NORM_ERROR) {
			throw new Error(`Node ${node.id} is not on the unit sphere.`);
		}
		nodeById.set(node.id, node);
		nodeByIndex.set(node.index, node);
		neighbors.set(node.index, new Set<number>());
	}

	for (const edge of snapshot.edges) {
		if (
			edge.source === edge.target ||
			!nodeByIndex.has(edge.source) ||
			!nodeByIndex.has(edge.target)
		) {
			throw new Error(
				`Edge ${edge.source}–${edge.target} references an invalid node.`,
			);
		}
		neighbors.get(edge.source)?.add(edge.target);
		neighbors.get(edge.target)?.add(edge.source);
	}

	const tagById = new Map<string, RenderTag>();
	const tagsByNodeIndex = new Map<number, RenderTag[]>();
	for (const node of snapshot.nodes) {
		tagsByNodeIndex.set(node.index, []);
	}
	for (const tag of snapshot.tags ?? []) {
		if (
			tag.id.trim().length === 0 ||
			tag.label.trim().length === 0 ||
			tagById.has(tag.id)
		) {
			throw new Error(`Invalid or duplicate render tag: ${tag.id}.`);
		}
		const nodeIndices = [...new Set(tag.nodeIndices)].sort(
			(left, right) => left - right,
		);
		if (
			nodeIndices.length === 0 ||
			nodeIndices.some((index) => !nodeByIndex.has(index))
		) {
			throw new Error(
				`Tag ${tag.id} references an invalid or empty node set.`,
			);
		}
		const preparedTag: RenderTag = {
			id: tag.id,
			label: tag.label,
			nodeIndices,
		};
		tagById.set(tag.id, preparedTag);
		for (const nodeIndex of nodeIndices) {
			tagsByNodeIndex.get(nodeIndex)?.push(preparedTag);
		}
	}

	return {
		snapshotId: snapshot.snapshotId,
		nodes: [...snapshot.nodes],
		edges: [...snapshot.edges],
		tags: [...tagById.values()],
		positions: new Float32Array(snapshot.positions),
		nodeById,
		nodeByIndex,
		neighborsByIndex: neighbors,
		tagById,
		tagsByNodeIndex,
	};
}
