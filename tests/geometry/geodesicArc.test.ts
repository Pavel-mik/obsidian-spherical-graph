import { describe, expect, it } from 'vitest';
import {
	sampleGeodesicArc,
	slerp,
} from '../../src/geometry/geodesicArc';
import { geodesicDistance } from '../../src/geometry/sphericalGeometry';
import { lengthVec3, type Vec3 } from '../../src/geometry/vector3';

describe('geodesic arcs', () => {
	it('returns exact endpoints and unit samples for ordinary SLERP', () => {
		const start: Vec3 = [1, 0, 0];
		const end: Vec3 = [0, 1, 0];
		expect(slerp(start, end, 0)).toEqual(start);
		expect(slerp(start, end, 1)).toEqual(end);
		for (let step = 0; step <= 20; step += 1) {
			expect(lengthVec3(slerp(start, end, step / 20))).toBeCloseTo(
				1,
				13,
			);
		}
		expect(geodesicDistance(start, slerp(start, end, 0.5))).toBeCloseTo(
			Math.PI / 4,
			12,
		);
	});

	it('chooses a deterministic ID-keyed antipodal plane', () => {
		const start: Vec3 = [1, 0, 0];
		const end: Vec3 = [-1, 0, 0];
		const first = sampleGeodesicArc(
			start,
			end,
			16,
			1,
			'alpha',
			'beta',
		);
		const second = sampleGeodesicArc(
			start,
			end,
			16,
			1,
			'alpha',
			'beta',
		);
		expect(first).toEqual(second);
		for (const sample of first) {
			expect(lengthVec3(sample)).toBeCloseTo(1, 12);
		}
	});

	it('uses the same antipodal arc when traversed in reverse', () => {
		const forward = sampleGeodesicArc(
			[1, 0, 0],
			[-1, 0, 0],
			12,
			1,
			'a',
			'b',
		);
		const reverse = sampleGeodesicArc(
			[-1, 0, 0],
			[1, 0, 0],
			12,
			1,
			'b',
			'a',
		).reverse();
		for (let index = 0; index < forward.length; index += 1) {
			expect(
				geodesicDistance(
					forward[index] ?? [0, 0, 0],
					reverse[index] ?? [0, 0, 0],
				),
			).toBeLessThan(1e-10);
		}
	});

	it('places every rendered sample at the requested constant radius', () => {
		const samples = sampleGeodesicArc(
			[0, 0, 1],
			[0, 1, 0],
			9,
			3.125,
			'n1',
			'n2',
		);
		expect(samples).toHaveLength(10);
		for (const sample of samples) {
			expect(lengthVec3(sample)).toBeCloseTo(3.125, 12);
		}
	});
});
