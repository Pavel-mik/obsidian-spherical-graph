import { describe, expect, it } from 'vitest';
import { geodesicDistance } from '../../src/geometry/sphericalGeometry';
import {
	applyMat3,
	determinantMat3,
	findBestProperRotation,
	type Mat3,
} from '../../src/geometry/rotationAlignment';
import { normalizeVec3, type Vec3 } from '../../src/geometry/vector3';

const ROTATE_Z_90: Mat3 = [
	0, -1, 0,
	1, 0, 0,
	0, 0, 1,
];

describe('proper-rotation alignment', () => {
	it('recovers a known 3D rotation without reflection', () => {
		const source: Vec3[] = [
			[1, 0, 0],
			[0, 1, 0],
			[0, 0, 1],
			normalizeVec3([1, 2, 3]),
		];
		const target = source.map((point) =>
			applyMat3(ROTATE_Z_90, point),
		);
		const rotation = findBestProperRotation(source, target);
		expect(determinantMat3(rotation)).toBeCloseTo(1, 12);
		for (let index = 0; index < source.length; index += 1) {
			expect(
				geodesicDistance(
					applyMat3(rotation, source[index] ?? [0, 0, 0]),
					target[index] ?? [0, 0, 0],
				),
			).toBeLessThan(1e-10);
		}
	});

	it('preserves all pairwise geodesic distances', () => {
		const source: Vec3[] = [
			normalizeVec3([1, 2, 3]),
			normalizeVec3([-4, 1, 2]),
			normalizeVec3([2, -3, 5]),
			normalizeVec3([-1, -1, 2]),
		];
		const target = source.map((point) =>
			applyMat3(ROTATE_Z_90, point),
		);
		const rotation = findBestProperRotation(source, target);
		const aligned = source.map((point) => applyMat3(rotation, point));
		for (let first = 0; first < source.length; first += 1) {
			for (
				let second = first + 1;
				second < source.length;
				second += 1
			) {
				expect(
					geodesicDistance(
						aligned[first] ?? [0, 0, 0],
						aligned[second] ?? [0, 0, 0],
					),
				).toBeCloseTo(
					geodesicDistance(
						source[first] ?? [0, 0, 0],
						source[second] ?? [0, 0, 0],
					),
					11,
				);
			}
		}
	});

	it('never returns an improper reflection', () => {
		const source: Vec3[] = [
			normalizeVec3([1, 2, 3]),
			normalizeVec3([-3, 1, 2]),
			normalizeVec3([2, -4, 1]),
			normalizeVec3([1, 1, -2]),
		];
		const reflected = source.map(
			([x, y, z]): Vec3 => [-x, y, z],
		);
		const rotation = findBestProperRotation(source, reflected);
		expect(determinantMat3(rotation)).toBeGreaterThan(0.999999);
	});
});
