export interface UnweightedEdge {
	readonly source: number;
	readonly target: number;
}

export interface ShortestPathUnion {
	/**
	 * Minimum number of existing graph edges between the two endpoints.
	 */
	readonly distance: number;
	/**
	 * Every node that belongs to at least one shortest path.
	 */
	readonly nodeIndices: readonly number[];
	/**
	 * Every edge that belongs to at least one shortest path.
	 */
	readonly edges: readonly UnweightedEdge[];
}

/**
 * Finds the union of every unweighted shortest path without enumerating paths.
 *
 * A node is on a shortest path when its distance from the source plus its
 * distance from the target equals the source-target distance. An edge is on a
 * shortest path when traversing it can advance one of those distance layers.
 * This remains O(V + E), even when the number of equally short paths is
 * exponential.
 */
export function findAllShortestPathUnion(
	nodeCount: number,
	edges: readonly UnweightedEdge[],
	source: number,
	target: number,
): ShortestPathUnion | undefined {
	if (
		!Number.isInteger(nodeCount) ||
		nodeCount < 0 ||
		!isValidNodeIndex(source, nodeCount) ||
		!isValidNodeIndex(target, nodeCount)
	) {
		return undefined;
	}
	if (source === target) {
		return {
			distance: 0,
			nodeIndices: [source],
			edges: [],
		};
	}

	const adjacency = Array.from(
		{ length: nodeCount },
		() => new Set<number>(),
	);
	for (const edge of edges) {
		if (
			edge.source === edge.target ||
			!isValidNodeIndex(edge.source, nodeCount) ||
			!isValidNodeIndex(edge.target, nodeCount)
		) {
			continue;
		}
		adjacency[edge.source]?.add(edge.target);
		adjacency[edge.target]?.add(edge.source);
	}

	const fromSource = breadthFirstDistances(adjacency, source);
	const distance = fromSource[target];
	if (distance === undefined || distance < 0) {
		return undefined;
	}
	const fromTarget = breadthFirstDistances(adjacency, target);
	const nodeIndices: number[] = [];
	for (let node = 0; node < nodeCount; node += 1) {
		const sourceDistance = fromSource[node];
		const targetDistance = fromTarget[node];
		if (
			sourceDistance !== undefined &&
			targetDistance !== undefined &&
			sourceDistance >= 0 &&
			targetDistance >= 0 &&
			sourceDistance + targetDistance === distance
		) {
			nodeIndices.push(node);
		}
	}

	const pathEdges: UnweightedEdge[] = [];
	const seenEdges = new Set<string>();
	for (const edge of edges) {
		if (
			edge.source === edge.target ||
			!isValidNodeIndex(edge.source, nodeCount) ||
			!isValidNodeIndex(edge.target, nodeCount)
		) {
			continue;
		}
		const forward =
			fromSource[edge.source] !== undefined &&
			fromTarget[edge.target] !== undefined &&
			(fromSource[edge.source] ?? -1) >= 0 &&
			(fromTarget[edge.target] ?? -1) >= 0 &&
			(fromSource[edge.source] ?? -1) +
				1 +
				(fromTarget[edge.target] ?? -1) ===
				distance;
		const backward =
			fromSource[edge.target] !== undefined &&
			fromTarget[edge.source] !== undefined &&
			(fromSource[edge.target] ?? -1) >= 0 &&
			(fromTarget[edge.source] ?? -1) >= 0 &&
			(fromSource[edge.target] ?? -1) +
				1 +
				(fromTarget[edge.source] ?? -1) ===
				distance;
		if (!forward && !backward) {
			continue;
		}
		const edgeKey = canonicalEdgeKey(edge.source, edge.target);
		if (!seenEdges.has(edgeKey)) {
			seenEdges.add(edgeKey);
			pathEdges.push({
				source: Math.min(edge.source, edge.target),
				target: Math.max(edge.source, edge.target),
			});
		}
	}
	pathEdges.sort(
		(left, right) =>
			left.source - right.source || left.target - right.target,
	);

	return {
		distance,
		nodeIndices,
		edges: pathEdges,
	};
}

export function canonicalEdgeKey(source: number, target: number): string {
	return source < target ? `${source}:${target}` : `${target}:${source}`;
}

function breadthFirstDistances(
	adjacency: readonly ReadonlySet<number>[],
	start: number,
): Int32Array {
	const distances = new Int32Array(adjacency.length);
	distances.fill(-1);
	distances[start] = 0;
	const queue = new Uint32Array(adjacency.length);
	queue[0] = start;
	let readIndex = 0;
	let writeIndex = 1;
	while (readIndex < writeIndex) {
		const node = queue[readIndex];
		readIndex += 1;
		if (node === undefined) {
			continue;
		}
		const nextDistance = (distances[node] ?? -1) + 1;
		for (const neighbor of adjacency[node] ?? []) {
			if (distances[neighbor] !== -1) {
				continue;
			}
			distances[neighbor] = nextDistance;
			queue[writeIndex] = neighbor;
			writeIndex += 1;
		}
	}
	return distances;
}

function isValidNodeIndex(index: number, nodeCount: number): boolean {
	return Number.isInteger(index) && index >= 0 && index < nodeCount;
}
