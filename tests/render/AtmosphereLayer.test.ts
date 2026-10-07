import {
	Color,
	FrontSide,
	Group,
	Mesh,
	Quaternion,
	ShaderMaterial,
	SphereGeometry,
	Vector3,
} from 'three';
import { describe, expect, it } from 'vitest';
import { SPHERE_RADIUS } from '../../src/constants';
import {
	AtmosphereLayer,
	ATMOSPHERE_ROTATION_PERIOD_MS,
	DEFAULT_ATMOSPHERE_HEIGHT_PERCENT,
	atmosphereRadiusForHeight,
	atmosphereRotationAngle,
} from '../../src/render/AtmosphereLayer';

describe('AtmosphereLayer', () => {
	it('creates a thin, procedural cloud shell without external textures', () => {
		const group = new Group();
		const layer = new AtmosphereLayer(group);
		const atmosphere = group.getObjectByName(
			'spherical-graph-atmosphere',
		);

		expect(atmosphere).toBeInstanceOf(Mesh);
		const mesh = atmosphere as Mesh;
		expect(mesh.geometry).toBeInstanceOf(SphereGeometry);
		expect(mesh.scale.x).toBeCloseTo(SPHERE_RADIUS * 1.1, 10);
		expect(layer.radius).toBeCloseTo(SPHERE_RADIUS * 1.1, 10);
		const material = mesh.material as ShaderMaterial;
		expect(material).toBeInstanceOf(ShaderMaterial);
		expect(material.transparent).toBe(true);
		expect(material.depthTest).toBe(true);
		expect(material.depthWrite).toBe(false);
		expect(material.side).toBe(FrontSide);
		expect(material.uniforms.map).toBeUndefined();
		expect(material.fragmentShader).toContain('atmosphereFbm');
		expect(material.fragmentShader).toContain('cloudMask');
		expect(material.fragmentShader).toContain('brokenRim');
		expect(material.fragmentShader).toContain('discard');

		layer.dispose();
		expect(
			group.getObjectByName('spherical-graph-atmosphere'),
		).toBeUndefined();
	});

	it('drifts in the apparent globe direction around the fixed north-south axis', () => {
		const group = new Group();
		const layer = new AtmosphereLayer(group);
		const y = new Vector3(0, 1, 0);
		expect(ATMOSPHERE_ROTATION_PERIOD_MS).toBe(450_000);
		layer.render(1000);
		layer.render(1032);
		const expected = new Quaternion().setFromAxisAngle(y, -atmosphereRotationAngle(32));
		expect(layer.object.quaternion.angleTo(expected)).toBeLessThan(1e-7);
		layer.render(1064);
		expected.premultiply(new Quaternion().setFromAxisAngle(y, -atmosphereRotationAngle(32)));
		expect(layer.object.quaternion.angleTo(expected)).toBeLessThan(1e-7);
		expect(y.clone().applyQuaternion(layer.object.quaternion).distanceTo(y)).toBeLessThan(1e-10);
		layer.setVisible(false);
		expect(layer.isVisible).toBe(false);
		expect(layer.object.visible).toBe(false);
		expect(layer.render(10_000)).toBe(false);
		layer.setVisible(true);
		layer.render(20_000);
		expect(layer.object.quaternion.angleTo(expected)).toBeLessThan(1e-7);
		layer.dispose();
	});

	it('supports configurable shell height, tint, and opacity', () => {
		const group = new Group();
		const layer = new AtmosphereLayer(group, {
			heightPercent: 25,
			color: '#91a8b5',
			opacity: 0.5,
		});
		const material = layer.object.material as ShaderMaterial;

		expect(layer.radius).toBeCloseTo(SPHERE_RADIUS * 1.25, 10);
		expect(
			(
				material.uniforms.atmosphereColor?.value as Color
			).getHexString(),
		).toBe('91a8b5');
		expect(material.uniforms.atmosphereOpacity?.value).toBe(0.5);

		layer.setHeightPercent(40);
		expect(layer.radius).toBeCloseTo(SPHERE_RADIUS * 1.3, 10);
		expect(layer.object.scale.x).toBeCloseTo(
			SPHERE_RADIUS * 1.3,
			10,
		);
		layer.setColor('#ffffff');
		expect(
			(
				material.uniforms.atmosphereColor?.value as Color
			).getHexString(),
		).toBe('ffffff');
		layer.setOpacity(2);
		expect(material.uniforms.atmosphereOpacity?.value).toBe(1);
		layer.setOpacity(-1);
		expect(material.uniforms.atmosphereOpacity?.value).toBe(0);
		layer.dispose();
	});
});

describe('atmosphere geometry helpers', () => {
	it('uses a ten-percent default height and safely normalizes input', () => {
		expect(DEFAULT_ATMOSPHERE_HEIGHT_PERCENT).toBe(10);
		expect(atmosphereRadiusForHeight()).toBeCloseTo(
			SPHERE_RADIUS * 1.1,
			10,
		);
		expect(atmosphereRadiusForHeight(Number.NaN)).toBeCloseTo(
			SPHERE_RADIUS * 1.1,
			10,
		);
		expect(atmosphereRadiusForHeight(-10)).toBeCloseTo(
			SPHERE_RADIUS * 1.1,
			10,
		);
	});

	it('wraps finite timestamps into a stable rotation angle', () => {
		expect(atmosphereRotationAngle(0)).toBe(0);
		expect(
			atmosphereRotationAngle(
				ATMOSPHERE_ROTATION_PERIOD_MS / 4,
			),
		).toBeCloseTo(Math.PI / 2, 10);
		expect(atmosphereRotationAngle(Number.NaN)).toBe(0);
		expect(
			atmosphereRotationAngle(
				-ATMOSPHERE_ROTATION_PERIOD_MS / 4,
			),
		).toBeCloseTo((Math.PI * 3) / 2, 10);
	});
});
