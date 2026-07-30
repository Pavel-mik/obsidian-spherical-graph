import { describe, expect, it } from 'vitest';
import {
	geodesicDistance,
	longitudeLatitudeToUnitVector,
} from '../../src/geometry/sphericalGeometry';
import { lengthVec3, readVec3 } from '../../src/geometry/vector3';
import { projectSphericalCollisions } from '../../src/layout/collisionProjection';

function positionBuffer(
	positions: readonly (readonly [number, number, number])[],
): Float32Array {
	return new Float32Array(positions.flat());
}

describe('intrinsic spherical collision projection', () => {
	it('separates overlapping movable nodes without mutating the input', () => {
		const positions = positionBuffer([
			longitudeLatitudeToUnitVector(0, 0),
			longitudeLatitudeToUnitVector(0.04, 0),
		]);
		const original = positions.slice();
		const result = projectSphericalCollisions({
			positions,
			angularRadii: new Float32Array([0.08, 0.08]),
			movableMask: new Uint8Array([1, 1]),
			deterministicSeed: 41,
		});

		expect(positions).toEqual(original);
		expect(result.converged).toBe(true);
		expect(result.passes).toBeGreaterThan(0);
		expect(result.remainingOverlapCount).toBe(0);
		expect(result.maximumPenetration).toBeLessThanOrEqual(1e-5);
		expect(
			geodesicDistance(
				readVec3(result.positions, 0),
				readVec3(result.positions, 1),
			),
		).toBeGreaterThanOrEqual(0.16 - 1e-5);
		for (let index = 0; index < 2; index += 1) {
			expect(lengthVec3(readVec3(result.positions, index))).toBeCloseTo(
				1,
				6,
			);
		}
	});

	it('keeps a fixed node unchanged and moves only its movable neighbor', () => {
		const positions = positionBuffer([
			[1, 0, 0],
			longitudeLatitudeToUnitVector(0.03, 0),
		]);
		const result = projectSphericalCollisions({
			positions,
			angularRadii: new Float32Array([0.06, 0.06]),
			movableMask: new Uint8Array([0, 1]),
			deterministicSeed: 5,
		});

		expect(readVec3(result.positions, 0)).toEqual([1, 0, 0]);
		expect(
			geodesicDistance(
				readVec3(result.positions, 0),
				readVec3(result.positions, 1),
			),
		).toBeGreaterThanOrEqual(0.12 - 1e-5);
	});

	it('reports an overlap that cannot move because both nodes are fixed', () => {
		const result = projectSphericalCollisions({
			positions: positionBuffer([
				[1, 0, 0],
				longitudeLatitudeToUnitVector(0.02, 0),
			]),
			angularRadii: new Float32Array([0.05, 0.05]),
			movableMask: new Uint8Array([0, 0]),
			deterministicSeed: 9,
		});

		expect(result.converged).toBe(false);
		expect(result.remainingOverlapCount).toBe(1);
		expect(result.maximumPenetration).toBeCloseTo(0.08, 5);
		expect(result.passes).toBe(1);
	});

	it('resolves coincident nodes reproducibly with a seeded fallback', () => {
		const options = {
			positions: positionBuffer([
				[0, 1, 0],
				[0, 1, 0],
				[0, 1, 0],
			]),
			angularRadii: new Float32Array([0.035, 0.035, 0.035]),
			movableMask: new Uint8Array([1, 1, 1]),
			deterministicSeed: 122,
			maxPasses: 96,
		};
		const first = projectSphericalCollisions(options);
		const repeated = projectSphericalCollisions(options);

		expect(first.positions).toEqual(repeated.positions);
		expect(first.converged).toBe(true);
		for (let index = 0; index < 3; index += 1) {
			expect(lengthVec3(readVec3(first.positions, index))).toBeCloseTo(
				1,
				6,
			);
		}
	});

	it('honors per-node geodesic anchor displacement caps', () => {
		const anchors = positionBuffer([
			[1, 0, 0],
			longitudeLatitudeToUnitVector(0.04, 0),
		]);
		const result = projectSphericalCollisions({
			positions: anchors.slice(),
			angularRadii: new Float32Array([0.08, 0.08]),
			movableMask: new Uint8Array([0, 1]),
			deterministicSeed: 63,
			anchorPositions: anchors,
			maximumAngularDisplacements: new Float32Array([0, 0.025]),
			maxPasses: 12,
		});

		expect(readVec3(result.positions, 0)).toEqual([1, 0, 0]);
		expect(
			geodesicDistance(
				readVec3(anchors, 1),
				readVec3(result.positions, 1),
			),
		).toBeLessThanOrEqual(0.025 + 1e-6);
		expect(result.converged).toBe(false);
		expect(result.remainingOverlapCount).toBe(1);
	});

	it('uses spatially local candidate pairs for separated nodes', () => {
		const positions: number[] = [];
		const nodeCount = 240;
		const goldenAngle = Math.PI * (3 - Math.sqrt(5));
		for (let index = 0; index < nodeCount; index += 1) {
			const y = 1 - (2 * (index + 0.5)) / nodeCount;
			const radial = Math.sqrt(1 - y * y);
			const phase = index * goldenAngle;
			positions.push(
				radial * Math.cos(phase),
				y,
				radial * Math.sin(phase),
			);
		}
		const result = projectSphericalCollisions({
			positions: new Float32Array(positions),
			angularRadii: new Float32Array(nodeCount).fill(0.008),
			movableMask: new Uint8Array(nodeCount).fill(1),
			deterministicSeed: 18,
		});

		expect(result.converged).toBe(true);
		expect(result.passes).toBe(0);
		expect(result.evaluatedPairCount).toBeLessThan(nodeCount * 4);
	});

	it('rejects incomplete anchor constraints', () => {
		expect(() =>
			projectSphericalCollisions({
				positions: positionBuffer([[1, 0, 0]]),
				angularRadii: new Float32Array([0.01]),
				movableMask: new Uint8Array([1]),
				deterministicSeed: 2,
				anchorPositions: positionBuffer([[1, 0, 0]]),
			}),
		).toThrow(/provided together/u);
	});
});
