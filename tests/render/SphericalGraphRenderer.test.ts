import { describe, expect, it, vi } from 'vitest';
import { PerspectiveCamera, Quaternion, Vector3 } from 'three';
import {
	DEFAULT_CAMERA_DISTANCE,
	MIN_CAMERA_DISTANCE,
} from '../../src/constants';
import { atmosphereRadiusForHeight } from '../../src/render/AtmosphereLayer';
import { RENDERER_CAMERA_NEAR_PLANE, SphericalGraphRenderer } from '../../src/render/SphericalGraphRenderer';
import { automaticRotationAngle } from '../../src/render/autoRotation';

interface RotationHarness {
	advanceAutoRotation(timestamp: number): boolean;
	setAutoRotation(enabled: boolean): void;
	camera: PerspectiveCamera;
	autoRotationActive: boolean;
	lastAutoRotationTimestamp?: number;
}

describe('SphericalGraphRenderer automatic rotation', () => {
	it('continues around the axis selected by an arcball gesture without snapping', () => {
		const renderer = Object.create(SphericalGraphRenderer.prototype) as RotationHarness;
		const camera = new PerspectiveCamera();
		camera.position.set(0, 0, 32);
		const gesture = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 1).normalize(), 0.8);
		camera.position.applyQuaternion(gesture);
		camera.up.applyQuaternion(gesture);
		const axis = camera.up.clone();
		const position = camera.position.clone();
		renderer.camera = camera;
		renderer.autoRotationActive = true;
		Reflect.set(renderer, 'controls', { update: vi.fn() });
		renderer.advanceAutoRotation(3000);
		expect(camera.position.equals(position)).toBe(true);
		renderer.advanceAutoRotation(3016);
		const expected = position.applyAxisAngle(axis, automaticRotationAngle(16));
		expect(camera.position.distanceTo(expected)).toBeLessThan(1e-10);
		expect(camera.up.distanceTo(axis)).toBeLessThan(1e-10);
		expect(camera.position.length()).toBeCloseTo(32);
	});

	it('allows phone auto rotation only during presentation', () => {
		const renderer = Object.create(SphericalGraphRenderer.prototype) as RotationHarness;
		const setEnabled = vi.fn();
		Reflect.set(renderer, 'profile', { deviceClass: 'phone', supportsAutoRotation: true });
		Reflect.set(renderer, 'autoRotationRequested', false);
		Reflect.set(renderer, 'presentationMode', false);
		Reflect.set(renderer, 'autoRotationPause', { setEnabled });
		Reflect.set(renderer, 'requestRender', vi.fn());
		renderer.setAutoRotation(true);
		expect(setEnabled).not.toHaveBeenCalled();
		Reflect.set(renderer, 'presentationMode', true);
		renderer.setAutoRotation(true);
		expect(setEnabled).toHaveBeenCalledWith(true);
	});
});

describe('SphericalGraphRenderer camera clipping', () => {
	it('keeps the default atmosphere safely in front of the near plane', () => {
		const closestAtmosphereDistance =
			MIN_CAMERA_DISTANCE - atmosphereRadiusForHeight();

		expect(RENDERER_CAMERA_NEAR_PLANE).toBe(0.25);
		expect(closestAtmosphereDistance).toBeGreaterThan(
			RENDERER_CAMERA_NEAR_PLANE,
		);
	});

	it('frames the complete default atmosphere with visible breathing room', () => {
		const angularDiameterDegrees =
			2 *
			Math.asin(
				atmosphereRadiusForHeight() / DEFAULT_CAMERA_DISTANCE,
			) *
			(180 / Math.PI);

		expect(DEFAULT_CAMERA_DISTANCE).toBe(32);
		expect(angularDiameterDegrees).toBeLessThan(45);
	});
});
