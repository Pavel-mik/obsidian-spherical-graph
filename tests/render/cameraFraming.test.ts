import { describe, expect, it } from 'vitest';
import { verticalFovForAspect } from '../../src/render/cameraFraming';

describe('verticalFovForAspect', () => {
	it('retains the desktop framing in square and landscape panes', () => {
		expect(verticalFovForAspect(1)).toBe(45);
		expect(verticalFovForAspect(16 / 9)).toBe(45);
	});

	it('widens the vertical field of view to preserve horizontal framing', () => {
		expect(verticalFovForAspect(430 / 713)).toBeCloseTo(78, 0);
		expect(verticalFovForAspect(0.5)).toBeGreaterThan(80);
	});

	it('falls back safely for invalid dimensions and caps extreme panes', () => {
		expect(verticalFovForAspect(0)).toBe(45);
		expect(verticalFovForAspect(Number.NaN)).toBe(45);
		expect(verticalFovForAspect(0.1)).toBe(85);
	});
});
