import { describe, expect, it } from 'vitest';
import { initializeFullLayout } from '../../src/layout/initialization';
import { buildSparseStressConstraints } from '../../src/layout/sparseStress';

function starGraph(leafCount: number): {
	readonly endpoints: Uint32Array;
	readonly weights: Float32Array;
} {
	const endpoints = new Uint32Array(leafCount * 2);
	const weights = new Float32Array(leafCount);
	weights.fill(1);
	for (let leafIndex = 0; leafIndex < leafCount; leafIndex += 1) {
		endpoints[leafIndex * 2] = 0;
		endpoints[leafIndex * 2 + 1] = leafIndex + 1;
	}
	return { endpoints, weights };
}

function expectGroupsConnected(
	result: ReturnType<typeof buildSparseStressConstraints>,
	groupIndexByNode: Int32Array,
): void {
	const adjacency = Array.from(
		{ length: groupIndexByNode.length },
		(): number[] => [],
	);
	for (
		let edgeIndex = 0;
		edgeIndex < result.edgeWeights.length;
		edgeIndex += 1
	) {
		const source = result.edgeEndpoints[edgeIndex * 2];
		const target = result.edgeEndpoints[edgeIndex * 2 + 1];
		if (
			source === undefined ||
			target === undefined ||
			groupIndexByNode[source] !== groupIndexByNode[target]
		) {
			continue;
		}
		adjacency[source]?.push(target);
		adjacency[target]?.push(source);
	}
	const membersByGroup = new Map<number, number[]>();
	for (
		let nodeIndex = 0;
		nodeIndex < groupIndexByNode.length;
		nodeIndex += 1
	) {
		const groupIndex = groupIndexByNode[nodeIndex] ?? -1;
		if (groupIndex < 0) {
			continue;
		}
		const members = membersByGroup.get(groupIndex) ?? [];
		members.push(nodeIndex);
		membersByGroup.set(groupIndex, members);
	}
	for (const members of membersByGroup.values()) {
		const first = members[0];
		if (first === undefined) {
			continue;
		}
		const visited = new Set<number>([first]);
		const queue = [first];
		for (let readIndex = 0; readIndex < queue.length; readIndex += 1) {
			const current = queue[readIndex];
			if (current === undefined) {
				continue;
			}
			for (const neighbor of adjacency[current] ?? []) {
				if (!visited.has(neighbor)) {
					visited.add(neighbor);
					queue.push(neighbor);
				}
			}
		}
		expect(visited.size).toBe(members.length);
	}
}

function initialAngularDistance(
	positions: Float32Array,
	source: number,
	target: number,
): number {
	const sourceOffset = source * 3;
	const targetOffset = target * 3;
	const sourceLength = Math.hypot(
		positions[sourceOffset] ?? 0,
		positions[sourceOffset + 1] ?? 0,
		positions[sourceOffset + 2] ?? 0,
	);
	const targetLength = Math.hypot(
		positions[targetOffset] ?? 0,
		positions[targetOffset + 1] ?? 0,
		positions[targetOffset + 2] ?? 0,
	);
	const dot =
		((positions[sourceOffset] ?? 0) *
			(positions[targetOffset] ?? 0) +
			(positions[sourceOffset + 1] ?? 0) *
				(positions[targetOffset + 1] ?? 0) +
			(positions[sourceOffset + 2] ?? 0) *
				(positions[targetOffset + 2] ?? 0)) /
		(sourceLength * targetLength);
	return Math.acos(Math.max(-1, Math.min(1, dot)));
}

describe('sparse spherical stress constraints', () => {
	it('is byte-for-byte deterministic for the same seed', () => {
		const graph = starGraph(12);
		const input = {
			nodeCount: 13,
			edgeEndpoints: graph.endpoints,
			edgeWeights: graph.weights,
			positions: initializeFullLayout(13, 17),
			folderIndexByNode: new Int32Array(13).fill(4),
			regionIndexByNode: new Int32Array(13).fill(8),
			seed: 91,
		};
		const first = buildSparseStressConstraints(input);
		const repeated = buildSparseStressConstraints(input);

		expect(first.edgeEndpoints).toEqual(repeated.edgeEndpoints);
		expect(first.edgeWeights).toEqual(repeated.edgeWeights);
		expect(first.targetAngles).toEqual(repeated.targetAngles);
		expect(first.addedPairCount).toBe(repeated.addedPairCount);
	});

	it('preserves original edges and keeps augmentation linearly bounded', () => {
		const nodeCount = 80;
		const endpoints: number[] = [];
		for (let nodeIndex = 1; nodeIndex < nodeCount; nodeIndex += 1) {
			endpoints.push(nodeIndex - 1, nodeIndex);
		}
		const originalEndpoints = new Uint32Array(endpoints);
		const originalWeights = new Float32Array(nodeCount - 1).fill(0.75);
		const pairsPerNode = 2;
		const result = buildSparseStressConstraints({
			nodeCount,
			edgeEndpoints: originalEndpoints,
			edgeWeights: originalWeights,
			positions: initializeFullLayout(nodeCount, 2),
			seed: 71,
			options: {
				maxLandmarksPerGroup: 6,
				pairsPerNode,
			},
		});

		expect(
			result.edgeEndpoints.slice(0, originalEndpoints.length),
		).toEqual(originalEndpoints);
		expect(result.edgeWeights.slice(0, originalWeights.length)).toEqual(
			originalWeights,
		);
		expect(
			result.targetAngles.slice(0, originalWeights.length),
		).toEqual(new Float32Array(originalWeights.length));
		expect(result.addedPairCount).toBeLessThanOrEqual(
			nodeCount * pairsPerNode,
		);
		expect(result.edgeWeights.length).toBe(
			originalWeights.length + result.addedPairCount,
		);
	});

	it('gives star leaves non-uniform distance targets instead of one hub ring', () => {
		const leafCount = 18;
		const graph = starGraph(leafCount);
		const result = buildSparseStressConstraints({
			nodeCount: leafCount + 1,
			edgeEndpoints: graph.endpoints,
			edgeWeights: graph.weights,
			positions: initializeFullLayout(leafCount + 1, 43),
			folderIndexByNode: new Int32Array(leafCount + 1).fill(0),
			regionIndexByNode: new Int32Array(leafCount + 1).fill(3),
			seed: 184,
		});
		const originalEdgeCount = graph.weights.length;
		const leafTargets = new Set(
			Array.from(result.targetAngles.slice(originalEdgeCount)).map(
				(value) => value.toFixed(5),
			),
		);

		expect(result.addedPairCount).toBeGreaterThan(leafCount / 2);
		expect(leafTargets.size).toBeGreaterThan(4);
		for (
			let edgeIndex = originalEdgeCount;
			edgeIndex < result.edgeWeights.length;
			edgeIndex += 1
		) {
			const source = result.edgeEndpoints[edgeIndex * 2];
			const target = result.edgeEndpoints[edgeIndex * 2 + 1];
			expect(source).toBeGreaterThan(0);
			expect(target).toBeGreaterThan(0);
		}
	});

	it('never creates a sparse pair across top-level folders', () => {
		const nodeCount = 10;
		const endpoints = new Uint32Array([
			0, 1,
			1, 2,
			2, 3,
			3, 4,
			4, 5,
			5, 6,
			6, 7,
			7, 8,
			8, 9,
		]);
		const weights = new Float32Array(endpoints.length / 2).fill(1);
		const folders = new Int32Array([
			0, 0, 0, 0, 0,
			1, 1, 1, 1, 1,
		]);
		const result = buildSparseStressConstraints({
			nodeCount,
			edgeEndpoints: endpoints,
			edgeWeights: weights,
			positions: initializeFullLayout(nodeCount, 6),
			folderIndexByNode: folders,
			seed: 16,
		});
		for (
			let edgeIndex = weights.length;
			edgeIndex < result.edgeWeights.length;
			edgeIndex += 1
		) {
			const source = result.edgeEndpoints[edgeIndex * 2] ?? 0;
			const target = result.edgeEndpoints[edgeIndex * 2 + 1] ?? 0;
			expect(folders[source]).toBe(folders[target]);
		}
	});

	it('adds a deterministic bounded local mesh that connects folders without radial targets', () => {
		const nodeCount = 24;
		const folders = new Int32Array(nodeCount);
		folders.fill(1, 12);
		const regions = new Int32Array([
			0, 0, 0, 0,
			1, 1, 1, 1,
			2, 2, 2, 2,
			3, 3, 3, 3,
			4, 4, 4, 4,
			5, 5, 5, 5,
		]);
		const endpoints = new Uint32Array([
			0, 1,
			4, 5,
			8, 9,
			12, 13,
			16, 17,
			20, 21,
			2, 14,
		]);
		const weights = new Float32Array(
			endpoints.length / 2,
		).fill(1);
		const input = {
			nodeCount,
			edgeEndpoints: endpoints,
			edgeWeights: weights,
			positions: initializeFullLayout(nodeCount, 118),
			folderIndexByNode: folders,
			regionIndexByNode: regions,
			seed: 913,
			options: {
				maxLandmarksPerGroup: 0,
				pairsPerNode: 0,
			},
		};
		const result = buildSparseStressConstraints(input);
		const repeated = buildSparseStressConstraints(input);

		expect(result.edgeEndpoints).toEqual(repeated.edgeEndpoints);
		expect(result.edgeWeights).toEqual(repeated.edgeWeights);
		expect(result.targetAngles).toEqual(repeated.targetAngles);
		expectGroupsConnected(result, regions);
		expectGroupsConnected(result, folders);

		let regionalBridgeCount = 0;
		const generatedTargets = new Set<string>();
		const intraRegionDegree = new Uint8Array(nodeCount);
		for (
			let edgeIndex = 0;
			edgeIndex < result.edgeWeights.length;
			edgeIndex += 1
		) {
			const source = result.edgeEndpoints[edgeIndex * 2] ?? 0;
			const target = result.edgeEndpoints[edgeIndex * 2 + 1] ?? 0;
			if (regions[source] === regions[target]) {
				intraRegionDegree[source] =
					(intraRegionDegree[source] ?? 0) + 1;
				intraRegionDegree[target] =
					(intraRegionDegree[target] ?? 0) + 1;
			}
		}
		expect(Math.min(...intraRegionDegree)).toBeGreaterThanOrEqual(
			3,
		);
		for (
			let edgeIndex = weights.length;
			edgeIndex < result.edgeWeights.length;
			edgeIndex += 1
		) {
			const source = result.edgeEndpoints[edgeIndex * 2] ?? 0;
			const target = result.edgeEndpoints[edgeIndex * 2 + 1] ?? 0;
			expect(folders[source]).toBe(folders[target]);
			if (regions[source] !== regions[target]) {
				regionalBridgeCount += 1;
			}
			const expectedTarget = Math.max(
				0.055,
				Math.min(
					1.35,
					initialAngularDistance(
						input.positions,
						source,
						target,
					),
				),
			);
			expect(result.targetAngles[edgeIndex]).toBeCloseTo(
				expectedTarget,
				5,
			);
			generatedTargets.add(
				(result.targetAngles[edgeIndex] ?? 0).toFixed(5),
			);
		}
		expect(regionalBridgeCount).toBeGreaterThanOrEqual(4);
		expect(regionalBridgeCount).toBeLessThanOrEqual(6);
		expect(generatedTargets.size).toBeGreaterThan(8);
		expect(result.addedPairCount).toBeLessThanOrEqual(
			nodeCount * 6,
		);
	});

	it('emits finite positive normalized targets only for added pairs', () => {
		const graph = starGraph(9);
		const result = buildSparseStressConstraints({
			nodeCount: 10,
			edgeEndpoints: graph.endpoints,
			edgeWeights: graph.weights,
			positions: initializeFullLayout(10, 12),
			seed: 31,
			options: {
				minimumTargetAngle: 0.08,
				maximumTargetAngle: 0.72,
			},
		});

		for (let edgeIndex = 0; edgeIndex < graph.weights.length; edgeIndex += 1) {
			expect(result.targetAngles[edgeIndex]).toBe(0);
		}
		for (
			let edgeIndex = graph.weights.length;
			edgeIndex < result.targetAngles.length;
			edgeIndex += 1
		) {
			const target = result.targetAngles[edgeIndex] ?? 0;
			expect(Number.isFinite(target)).toBe(true);
			expect(target).toBeGreaterThanOrEqual(0.08 - 1e-6);
			expect(target).toBeLessThanOrEqual(0.72 + 1e-6);
			expect(target).toBeLessThanOrEqual(Math.PI);
		}
	});
});
