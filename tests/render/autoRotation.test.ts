import { describe, expect, it } from 'vitest';
import {
	AUTO_ROTATION_RADIANS_PER_SECOND,
	automaticRotationAngle,
} from '../../src/render/autoRotation';

describe('automatic globe rotation', () => {
	it('advances at a slow deterministic speed', () => {
		expect(automaticRotationAngle(16)).toBeCloseTo(
			AUTO_ROTATION_RADIANS_PER_SECOND * 0.016,
			10,
		);
	});

	it('ignores invalid time and caps background-tab jumps', () => {
		expect(automaticRotationAngle(0)).toBe(0);
		expect(automaticRotationAngle(Number.NaN)).toBe(0);
		expect(automaticRotationAngle(10_000)).toBeCloseTo(
			AUTO_ROTATION_RADIANS_PER_SECOND * 0.064,
			10,
		);
	});
});
