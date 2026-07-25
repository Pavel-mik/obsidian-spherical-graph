import { describe, expect, it } from 'vitest';
import {
	geodesicClamp,
	geodesicDistance,
	exponentialMap,
	longitudeLatitudeToUnitVector,
	projectToTangent,
	tangentDirection,
} from '../../src/geometry/sphericalGeometry';
import {
	dotVec3,
	lengthVec3,
	normalizeVec3,
	tryNormalizeVec3,
	type Vec3,
} from '../../src/geometry/vector3';

describe('unit-vector geometry', () => {
	it('normalizes valid vectors and rejects zero/non-finite vectors', () => {
		const normalized = normalizeVec3([3, 4, 0]);
		expect(normalized[0]).toBeCloseTo(0.6, 14);
		expect(normalized[1]).toBeCloseTo(0.8, 14);
		expect(normalized[2]).toBe(0);
		expect(tryNormalizeVec3([0, 0, 0])).toBeNull();
		expect(tryNormalizeVec3([Number.NaN, 0, 1])).toBeNull();
		expect(() => normalizeVec3([0, 0, 0])).toThrow(RangeError);
	});

	it('projects forces exactly into the tangent plane', () => {
		const position = normalizeVec3([1, 2, 3]);
		const projected = projectToTangent(position, [4, -2, 8]);
		expect(Math.abs(dotVec3(position, projected))).toBeLessThan(1e-12);
	});

	it('computes stable, symmetric intrinsic distances', () => {
		const first = normalizeVec3([1, 2, 3]);
		const second = normalizeVec3([-2, 5, 1]);
		expect(geodesicDistance(first, second)).toBeCloseTo(
			geodesicDistance(second, first),
			14,
		);
		expect(geodesicDistance(first, first)).toBeCloseTo(0, 14);
		expect(geodesicDistance([1, 0, 0], [-1, 0, 0])).toBeCloseTo(
			Math.PI,
			14,
		);
	});

	it('has no longitude seam', () => {
		const east = longitudeLatitudeToUnitVector(
			(179.5 * Math.PI) / 180,
			0,
		);
		const west = longitudeLatitudeToUnitVector(
			(-179.5 * Math.PI) / 180,
			0,
		);
		expect(geodesicDistance(east, west)).toBeCloseTo(
			Math.PI / 180,
			12,
		);
	});

	it('uses deterministic tangent fallbacks at coincident and antipodal points', () => {
		const coincidentA = tangentDirection([1, 0, 0], [1, 0, 0], 42);
		const coincidentB = tangentDirection([1, 0, 0], [1, 0, 0], 42);
		const antipodal = tangentDirection([1, 0, 0], [-1, 0, 0], 17);
		expect(coincidentA).toEqual(coincidentB);
		expect(Math.abs(dotVec3([1, 0, 0], coincidentA))).toBeLessThan(
			1e-12,
		);
		expect(Math.abs(dotVec3([1, 0, 0], antipodal))).toBeLessThan(
			1e-12,
		);
		expect(lengthVec3(antipodal)).toBeCloseTo(1, 14);
	});

	it('updates intrinsically through the exponential map', () => {
		const start: Vec3 = [0, 0, 1];
		const result = exponentialMap(start, [0.2, 0, 4]);
		expect(lengthVec3(result)).toBeCloseTo(1, 14);
		expect(geodesicDistance(start, result)).toBeCloseTo(0.2, 12);
	});

	it('clamps geodesic displacement to an anchor cone', () => {
		const anchor: Vec3 = [1, 0, 0];
		const position: Vec3 = [0, 1, 0];
		const limit = Math.PI / 12;
		const clamped = geodesicClamp(position, anchor, limit, 3);
		expect(geodesicDistance(anchor, clamped)).toBeCloseTo(limit, 12);
		expect(lengthVec3(clamped)).toBeCloseTo(1, 14);
	});
});
