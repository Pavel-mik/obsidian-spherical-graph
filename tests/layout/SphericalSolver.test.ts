import { describe, expect, it } from 'vitest';
import {
	computeSphericalCoverage,
	geodesicDistance,
	sphericalWeightedMean,
} from '../../src/geometry/sphericalGeometry';
import { lengthVec3, readVec3 } from '../../src/geometry/vector3';
import {
	initializeFullLayout,
	initializeRefreshLayout,
} from '../../src/layout/initialization';
import { SphericalSolver } from '../../src/layout/SphericalSolver';
import type {
	LayoutSolverInput,
	RefreshConstraints,
} from '../../src/layout/layoutTypes';

function ringEdges(nodeCount: number): {
	edgeEndpoints: Uint32Array;
	edgeWeights: Float32Array;
} {
	const endpoints = new Uint32Array(nodeCount * 2);
	const weights = new Float32Array(nodeCount);
	weights.fill(1);
	for (let index = 0; index < nodeCount; index += 1) {
		endpoints[index * 2] = index;
		endpoints[index * 2 + 1] = (index + 1) % nodeCount;
	}
	return { edgeEndpoints: endpoints, edgeWeights: weights };
}

function fullInput(
	nodeCount: number,
	seed: number,
	settings: LayoutSolverInput['settings'] = {},
): LayoutSolverInput {
	return {
		operationId: `op-${seed}`,
		mode: 'renew',
		graphSignature: `graph-${nodeCount}`,
		effectiveSeed: seed,
		positions: initializeFullLayout(nodeCount, seed),
		...ringEdges(nodeCount),
		settings,
	};
}

function median(values: readonly number[]): number {
	if (values.length === 0) {
		throw new RangeError('Median requires at least one value.');
	}
	const sorted = [...values].sort((left, right) => left - right);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1
		? (sorted[middle] ?? 0)
		: ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

describe('SphericalSolver full layout', () => {
	it('keeps every result on S² after hundreds of intrinsic steps', () => {
		const result = new SphericalSolver(
			fullInput(40, 123, {
				maxIterations: 220,
				convergenceWindow: 30,
			}),
		).solveSync();
		expect(result.status).toBe('completed');
		if (result.status !== 'completed') {
			return;
		}
		expect(result.diagnostics.maximumNormError).toBeLessThan(1e-5);
		for (let index = 0; index < 40; index += 1) {
			expect(lengthVec3(readVec3(result.positions, index))).toBeCloseTo(
				1,
				5,
			);
		}
	});

	it('lets the intrinsic topology use the full sphere without geography caps', () => {
		const nodeCount = 12;
		const result = new SphericalSolver(
			fullInput(nodeCount, 512, {
				maxIterations: 18,
				convergenceWindow: 30,
			}),
		).solveSync();
		expect(result.status).toBe('completed');
		if (result.status !== 'completed') {
			return;
		}
		let maximumDistance = 0;
		for (let index = 0; index < nodeCount; index += 1) {
			maximumDistance = Math.max(
				maximumDistance,
				geodesicDistance(
					[1, 0, 0],
					readVec3(result.positions, index),
				),
			);
		}
		expect(maximumDistance).toBeGreaterThan(1);
		expect(result.diagnostics.cappedNodeCount).toBe(0);
	});

	it('keeps dense clusters distinct across sparse bridge links', () => {
		const clusterSize = 9;
		const clusterCount = 3;
		const nodeCount = clusterSize * clusterCount;
		const endpoints: number[] = [];
		const weights: number[] = [];
		const groups = Array.from(
			{ length: clusterCount },
			(_, clusterIndex) =>
				Array.from(
					{ length: clusterSize },
					(_, localIndex) =>
						clusterIndex * clusterSize + localIndex,
				),
		);
		for (const group of groups) {
			for (let left = 0; left < group.length; left += 1) {
				for (
					let right = left + 1;
					right < group.length;
					right += 1
				) {
					const source = group[left];
					const target = group[right];
					if (source === undefined || target === undefined) {
						continue;
					}
					endpoints.push(source, target);
					weights.push(1);
				}
			}
		}
		for (
			let clusterIndex = 0;
			clusterIndex + 1 < clusterCount;
			clusterIndex += 1
		) {
			endpoints.push(
				clusterIndex * clusterSize,
				(clusterIndex + 1) * clusterSize,
			);
			weights.push(1);
		}
		const input: LayoutSolverInput = {
			operationId: 'cluster-separation',
			mode: 'renew',
			graphSignature: 'three-dense-clusters-two-bridges',
			effectiveSeed: 991,
			positions: initializeFullLayout(nodeCount, 991),
			edgeEndpoints: new Uint32Array(endpoints),
			edgeWeights: new Float32Array(weights),
			settings: {
				maxIterations: 900,
				convergenceWindow: 40,
			},
		};
		const first = new SphericalSolver(input).solveSync();
		const repeated = new SphericalSolver(input).solveSync();
		expect(first.status).toBe('completed');
		expect(repeated.status).toBe('completed');
		if (
			first.status !== 'completed' ||
			repeated.status !== 'completed'
		) {
			return;
		}
		expect(first.positions).toEqual(repeated.positions);

		const intraClusterDistances: number[] = [];
		for (const group of groups) {
			for (let left = 0; left < group.length; left += 1) {
				for (
					let right = left + 1;
					right < group.length;
					right += 1
				) {
					const source = group[left];
					const target = group[right];
					if (source === undefined || target === undefined) {
						continue;
					}
					intraClusterDistances.push(
						geodesicDistance(
							readVec3(first.positions, source),
							readVec3(first.positions, target),
						),
					);
				}
			}
		}

		const interClusterDistances: number[] = [];
		for (
			let leftGroup = 0;
			leftGroup < groups.length;
			leftGroup += 1
		) {
			for (
				let rightGroup = leftGroup + 1;
				rightGroup < groups.length;
				rightGroup += 1
			) {
				for (const source of groups[leftGroup] ?? []) {
					for (const target of groups[rightGroup] ?? []) {
						interClusterDistances.push(
							geodesicDistance(
								readVec3(first.positions, source),
								readVec3(first.positions, target),
							),
						);
					}
				}
			}
		}

		const centers = groups.map((group) =>
			sphericalWeightedMean(
				group.map((nodeIndex) =>
					readVec3(first.positions, nodeIndex),
				),
			),
		);
		expect(centers.every((center) => center !== null)).toBe(true);
		const centerDistances: number[] = [];
		for (let left = 0; left < centers.length; left += 1) {
			for (
				let right = left + 1;
				right < centers.length;
				right += 1
			) {
				const source = centers[left];
				const target = centers[right];
				if (source === null || source === undefined ||
					target === null || target === undefined) {
					continue;
				}
				centerDistances.push(geodesicDistance(source, target));
			}
		}

		const typicalIntraDistance = median(intraClusterDistances);
		expect(typicalIntraDistance).toBeLessThan(
			median(interClusterDistances) * 0.55,
		);
		expect(typicalIntraDistance).toBeLessThan(
			median(centerDistances) * 0.55,
		);
	});

	it('is deterministic for the same graph, seed, and settings', () => {
		const input = fullInput(24, 808, {
			maxIterations: 80,
			convergenceWindow: 100,
		});
		const first = new SphericalSolver(input).solveSync();
		const second = new SphericalSolver(input).solveSync();
		expect(first.status).toBe('completed');
		expect(second.status).toBe('completed');
		if (first.status === 'completed' && second.status === 'completed') {
			expect(first.positions).toEqual(second.positions);
		}
	});

	it('handles empty, one-node, and two-node graphs', () => {
		for (const count of [0, 1, 2]) {
			const result = new SphericalSolver({
				operationId: `small-${count}`,
				mode: 'initialize',
				graphSignature: `small-${count}`,
				effectiveSeed: 9,
				positions: initializeFullLayout(count, 9),
				edgeEndpoints:
					count === 2
						? new Uint32Array([0, 1])
						: new Uint32Array(),
				edgeWeights:
					count === 2
						? new Float32Array([1])
						: new Float32Array(),
				settings: { maxIterations: 20 },
			}).solveSync();
			expect(result.status).toBe('completed');
		}
	});

	it('keeps an edge-free graph globally distributed', () => {
		const result = new SphericalSolver({
			operationId: 'orphans',
			mode: 'initialize',
			graphSignature: 'orphans',
			effectiveSeed: 444,
			positions: initializeFullLayout(500, 444),
			edgeEndpoints: new Uint32Array(),
			edgeWeights: new Float32Array(),
			settings: {
				maxIterations: 12,
				exactRepulsionThreshold: 100,
				negativeSamplesPerNode: 8,
				localRepulsionAngle: 0.08,
				convergenceWindow: 100,
			},
		}).solveSync();
		expect(result.status).toBe('completed');
		if (result.status !== 'completed') {
			return;
		}
		const coverage = computeSphericalCoverage(result.positions);
		expect(coverage.meanVectorNorm).toBeLessThan(0.06);
		for (const moment of coverage.covarianceDiagonal) {
			expect(moment).toBeGreaterThan(0.25);
			expect(moment).toBeLessThan(0.42);
		}
		expect(result.diagnostics.repulsionMode).toBe('sampled');
	});

	it('uses O(nk) sampled global pairs above the exact threshold', () => {
		const nodeCount = 5_000;
		const iterations = 2;
		const samples = 4;
		const result = new SphericalSolver({
			operationId: 'large',
			mode: 'renew',
			graphSignature: 'large',
			effectiveSeed: 51,
			positions: initializeFullLayout(nodeCount, 51),
			edgeEndpoints: new Uint32Array(),
			edgeWeights: new Float32Array(),
			settings: {
				maxIterations: iterations,
				convergenceWindow: 10,
				exactRepulsionThreshold: 100,
				negativeSamplesPerNode: samples,
				localRepulsionAngle: 0,
			},
		}).solveSync();
		expect(result.status).toBe('completed');
		expect(result.diagnostics.repulsionMode).toBe('sampled');
		expect(result.diagnostics.evaluatedRepulsionPairs).toBe(
			nodeCount * samples * iterations,
		);
		expect(result.diagnostics.evaluatedRepulsionPairs).toBeLessThan(
			nodeCount * nodeCount * 0.01,
		);
	});

	it('cancels between asynchronous iteration batches', async () => {
		const solver = new SphericalSolver(
			fullInput(80, 303, {
				maxIterations: 500,
				batchSize: 2,
				convergenceWindow: 600,
			}),
		);
		let yields = 0;
		const result = await solver.solveAsync({
			yieldControl: async () => {
				yields += 1;
				solver.cancel();
				await Promise.resolve();
			},
		});
		expect(yields).toBe(1);
		expect(result.status).toBe('cancelled');
	});
});

describe('SphericalSolver refresh preservation', () => {
	function refreshFixture(
		anchorStrength: number,
		maximumDistance = 0.12,
	): LayoutSolverInput {
		const committed = new Float32Array([
			1, 0, 0,
			0, 1, 0,
			0, 0, 0,
		]);
		const initialized = initializeRefreshLayout({
			nodeCount: 3,
			committedPositions: committed,
			existingNodeMask: new Uint8Array([1, 1, 0]),
			edgeEndpoints: new Uint32Array([0, 2]),
			edgeWeights: new Float32Array([8]),
			effectiveSeed: 77,
		});
		const refresh: RefreshConstraints = {
			existingNodeMask: initialized.existingNodeMask,
			newNodeMask: initialized.newNodeMask,
			relaxationMovableMask: new Uint8Array([1, 0, 1]),
			anchorPositions: committed,
			anchorStrengths: new Float32Array([anchorStrength, 0, 0]),
			maxAnchorDistances: new Float32Array([
				maximumDistance,
				0,
				0,
			]),
			alignToAnchors: false,
		};
		return {
			operationId: `refresh-${anchorStrength}`,
			mode: 'refresh',
			graphSignature: 'refresh-graph',
			effectiveSeed: 77,
			positions: initialized.positions,
			edgeEndpoints: new Uint32Array([0, 2]),
			edgeWeights: new Float32Array([8]),
			refresh,
			settings: {
				maxIterations: 80,
				refreshWarmupIterations: 8,
				convergenceWindow: 100,
				springStrength: 0.35,
			},
		};
	}

	it('does not move any old node during new-node warm-up', () => {
		const input = refreshFixture(0.2);
		const solver = new SphericalSolver(input);
		const before = solver.getPositionsSnapshot();
		solver.step(8);
		const after = solver.getPositionsSnapshot();
		expect(readVec3(after, 0)).toEqual(readVec3(before, 0));
		expect(readVec3(after, 1)).toEqual(readVec3(before, 1));
	});

	it('keeps unaffected old nodes bitwise fixed and caps affected drift', () => {
		const result = new SphericalSolver(refreshFixture(0.15)).solveSync();
		expect(result.status).toBe('completed');
		if (result.status !== 'completed') {
			return;
		}
		expect(readVec3(result.positions, 1)).toEqual([0, 1, 0]);
		expect(
			geodesicDistance([1, 0, 0], readVec3(result.positions, 0)),
		).toBeLessThanOrEqual(0.120002);
		expect(result.diagnostics.hardFixedNodeCount).toBe(1);
	});

	it('anchor energy reduces drift compared with an unanchored refresh', () => {
		const anchored = new SphericalSolver(
			refreshFixture(0.8, 1),
		).solveSync();
		const unanchored = new SphericalSolver(
			refreshFixture(0, 1),
		).solveSync();
		expect(anchored.status).toBe('completed');
		expect(unanchored.status).toBe('completed');
		if (
			anchored.status === 'completed' &&
			unanchored.status === 'completed'
		) {
			const anchoredDrift = geodesicDistance(
				[1, 0, 0],
				readVec3(anchored.positions, 0),
			);
			const unanchoredDrift = geodesicDistance(
				[1, 0, 0],
				readVec3(unanchored.positions, 0),
			);
			expect(anchoredDrift).toBeLessThan(unanchoredDrift);
		}
	});

	it('renew ignores supplied refresh anchors', () => {
		const base = fullInput(12, 717, {
			maxIterations: 30,
			convergenceWindow: 100,
		});
		const positions = base.positions;
		const existing = new Uint8Array(12);
		existing.fill(1);
		const movable = new Uint8Array(12);
		movable.fill(1);
		const anchorPositions = initializeFullLayout(12, 999);
		const strengths = new Float32Array(12);
		strengths.fill(100);
		const limits = new Float32Array(12);
		limits.fill(0.01);
		const withIgnoredAnchors = new SphericalSolver({
			...base,
			positions,
			refresh: {
				existingNodeMask: existing,
				newNodeMask: new Uint8Array(12),
				relaxationMovableMask: movable,
				anchorPositions,
				anchorStrengths: strengths,
				maxAnchorDistances: limits,
			},
		}).solveSync();
		const ordinary = new SphericalSolver(base).solveSync();
		expect(withIgnoredAnchors.status).toBe('completed');
		expect(ordinary.status).toBe('completed');
		if (
			withIgnoredAnchors.status === 'completed' &&
			ordinary.status === 'completed'
		) {
			expect(withIgnoredAnchors.positions).toEqual(ordinary.positions);
		}
	});
});
