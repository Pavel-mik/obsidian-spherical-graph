import { describe, expect, it } from 'vitest';
import {
	computeSphericalCoverage,
	geodesicDistance,
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

	it('keeps continent members inside their reserved intrinsic cap', () => {
		const nodeCount = 12;
		const result = new SphericalSolver({
			...fullInput(nodeCount, 512, {
				maxIterations: 18,
				convergenceWindow: 30,
			}),
			geography: {
				assignmentByNode: new Int32Array(nodeCount).fill(0),
				centers: new Float32Array([1, 0, 0]),
				capRadii: new Float32Array([0.42]),
				boundaryStrength: 0.82,
			},
		}).solveSync();
		expect(result.status).toBe('completed');
		if (result.status !== 'completed') {
			return;
		}
		for (let index = 0; index < nodeCount; index += 1) {
			expect(
				geodesicDistance(
					[1, 0, 0],
					readVec3(result.positions, index),
				),
			).toBeLessThanOrEqual(0.420_001);
		}
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
