import { describe, expect, it } from 'vitest';
import { edgesVisibleAtCameraDistance } from '../../src/render/edgeVisibility';

describe('edgesVisibleAtCameraDistance', () => {
	it('starts showing edges at the inclusive zoom-in threshold', () => {
		expect(edgesVisibleAtCameraDistance(37, 50)).toBe(false);
		expect(edgesVisibleAtCameraDistance(36, 50)).toBe(true);
		expect(edgesVisibleAtCameraDistance(35, 50)).toBe(true);
	});

	it('clamps thresholds and rejects invalid camera distances', () => {
		expect(edgesVisibleAtCameraDistance(60, -20)).toBe(true);
		expect(edgesVisibleAtCameraDistance(12, 500)).toBe(true);
		expect(edgesVisibleAtCameraDistance(Number.NaN, 0)).toBe(false);
	});
});
