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
