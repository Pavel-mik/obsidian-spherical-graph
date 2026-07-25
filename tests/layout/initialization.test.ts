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

describe('deterministic spherical initialization', () => {
	it('creates reproducible seed-dependent Fibonacci assignments', () => {
		const first = initializeFullLayout(128, 42);
		const repeated = initializeFullLayout(128, 42);
		const renewed = initializeFullLayout(128, 43);
		expect(first).toEqual(repeated);
		expect(first).not.toEqual(renewed);
		for (let index = 0; index < 128; index += 1) {
			expect(lengthVec3(readVec3(first, index))).toBeCloseTo(1, 6);
		}
	});

	it('covers the whole sphere for at least 500 isolated nodes', () => {
		const positions = initializeFullLayout(500, 1911);
		const coverage = computeSphericalCoverage(positions);
		expect(coverage.meanVectorNorm).toBeLessThan(0.06);
		for (const moment of coverage.covarianceDiagonal) {
			expect(moment).toBeGreaterThan(0.25);
			expect(moment).toBeLessThan(0.42);
		}
	});

	it('keeps old nodes and places a new linked node near old neighbors', () => {
		const committed = new Float32Array([
			1, 0, 0,
			0, 1, 0,
			0, 0, 0,
			0, 0, 0,
		]);
		const result = initializeRefreshLayout({
			nodeCount: 4,
			committedPositions: committed,
			existingNodeMask: new Uint8Array([1, 1, 0, 0]),
			edgeEndpoints: new Uint32Array([0, 2, 1, 2]),
			edgeWeights: new Float32Array([2, 1]),
			effectiveSeed: 99,
		});
		expect(readVec3(result.positions, 0)).toEqual([1, 0, 0]);
		expect(readVec3(result.positions, 1)).toEqual([0, 1, 0]);
		expect(result.newNodeMask).toEqual(new Uint8Array([0, 0, 1, 1]));
		expect(
			geodesicDistance(
				readVec3(result.positions, 2),
				[2 / Math.sqrt(5), 1 / Math.sqrt(5), 0],
			),
		).toBeLessThan(0.25);
	});

	it('gives isolated new nodes deterministic free candidates', () => {
		const input = {
			nodeCount: 3,
			committedPositions: new Float32Array([
				1, 0, 0,
				0, 0, 0,
				0, 0, 0,
			]),
			existingNodeMask: new Uint8Array([1, 0, 0]),
			edgeEndpoints: new Uint32Array(),
			effectiveSeed: 77,
		};
		const first = initializeRefreshLayout(input);
		const second = initializeRefreshLayout(input);
		expect(first.positions).toEqual(second.positions);
		expect(
			geodesicDistance(
				readVec3(first.positions, 1),
				readVec3(first.positions, 2),
			),
		).toBeGreaterThan(0.1);
	});

	it('reclassifies invalid saved coordinates as new', () => {
		const result = initializeRefreshLayout({
			nodeCount: 2,
			committedPositions: new Float32Array([
				1, 0, 0,
				Number.NaN, 0, 0,
			]),
			existingNodeMask: new Uint8Array([1, 1]),
			edgeEndpoints: new Uint32Array(),
			effectiveSeed: 5,
		});
		expect(result.existingNodeMask).toEqual(new Uint8Array([1, 0]));
		expect(result.newNodeMask).toEqual(new Uint8Array([0, 1]));
		expect(lengthVec3(readVec3(result.positions, 1))).toBeCloseTo(1, 6);
	});
});
