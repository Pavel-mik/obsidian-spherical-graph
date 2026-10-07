import { describe, expect, it, vi } from 'vitest';
import { PerspectiveCamera, Quaternion, Vector3 } from 'three';
import {
	DEFAULT_CAMERA_DISTANCE,
	MIN_CAMERA_DISTANCE,
} from '../../src/constants';
import { atmosphereRadiusForHeight } from '../../src/render/AtmosphereLayer';
import { RENDERER_CAMERA_NEAR_PLANE, SphericalGraphRenderer } from '../../src/render/SphericalGraphRenderer';

interface RotationHarness {
	advanceAutoRotation(timestamp: number): boolean;
	setAutoRotation(enabled: boolean): void;
	camera: PerspectiveCamera;
	autoRotationActive: boolean;
	lastAutoRotationTimestamp?: number;
}

describe('SphericalGraphRenderer automatic rotation', () => {
	it.each([
		['equatorial', new Vector3(0, 1, 0), 0],
		['tilted and rolled', new Vector3(1, 0, 1).normalize(), 0.8],
		['upside down', new Vector3(1, 0, 1).normalize(), 2.6],
		['looking along the polar axis', new Vector3(1, 0, 0), Math.PI / 2],
	] as const)('keeps the poles fixed on screen from a %s view while the surface turns', (_, axis, angle) => {
		const renderer = Object.create(SphericalGraphRenderer.prototype) as RotationHarness;
		const camera = new PerspectiveCamera();
		camera.position.set(0, 0, 32);
		const gesture = new Quaternion().setFromAxisAngle(axis, angle);
		camera.position.applyQuaternion(gesture);
		camera.up.applyQuaternion(gesture);
		camera.lookAt(0, 0, 0);
		camera.updateMatrixWorld();
		const north = new Vector3(0, 10, 0);
		const south = new Vector3(0, -10, 0);
		const equator = new Vector3(10, 0, 0);
		const screenNorth = north.clone().project(camera);
		const screenSouth = south.clone().project(camera);
		const screenEquator = equator.clone().project(camera);
		const position = camera.position.clone();
		const orientation = camera.quaternion.clone();
		renderer.camera = camera;
		renderer.autoRotationActive = true;
		Reflect.set(renderer, 'controls', { update: vi.fn() });
		renderer.advanceAutoRotation(3000);
		expect(camera.position.equals(position)).toBe(true);
		expect(camera.quaternion.equals(orientation)).toBe(true);
		for (let frame = 1; frame <= 120; frame += 1) {
			renderer.advanceAutoRotation(3000 + frame * 64);
			camera.updateMatrixWorld();
			expect(north.clone().project(camera).distanceTo(screenNorth)).toBeLessThan(1e-10);
			expect(south.clone().project(camera).distanceTo(screenSouth)).toBeLessThan(1e-10);
			expect(camera.position.y).toBeCloseTo(position.y, 10);
			expect(camera.position.length()).toBeCloseTo(32, 10);
		}
		expect(equator.clone().project(camera).distanceTo(screenEquator)).toBeGreaterThan(0.01);
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
