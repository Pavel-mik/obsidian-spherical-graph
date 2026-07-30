import { describe, expect, it } from 'vitest';
import { MIN_CAMERA_DISTANCE } from '../../src/constants';
import { atmosphereRadiusForHeight } from '../../src/render/AtmosphereLayer';
import { RENDERER_CAMERA_NEAR_PLANE } from '../../src/render/SphericalGraphRenderer';

describe('SphericalGraphRenderer camera clipping', () => {
	it('keeps the default atmosphere safely in front of the near plane', () => {
		const closestAtmosphereDistance =
			MIN_CAMERA_DISTANCE - atmosphereRadiusForHeight();

		expect(RENDERER_CAMERA_NEAR_PLANE).toBe(0.25);
		expect(closestAtmosphereDistance).toBeGreaterThan(
			RENDERER_CAMERA_NEAR_PLANE,
		);
	});
});
