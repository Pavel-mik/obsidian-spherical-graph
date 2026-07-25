import {
	AdditiveBlending,
	BufferAttribute,
	BufferGeometry,
	Color,
	FrontSide,
	Group,
	LineDashedMaterial,
	LineSegments,
	Mesh,
	MeshBasicMaterial,
	ShaderMaterial,
	SphereGeometry,
} from 'three';
import { SPHERE_RADIUS } from '../constants';
import { AppearanceSettings } from '../settings/settings';
import { RenderTheme } from './renderTypes';

export class SphereLayer {
	private readonly geometry = new SphereGeometry(SPHERE_RADIUS, 64, 40);
	private readonly material = new MeshBasicMaterial({
		depthTest: true,
		side: FrontSide,
		toneMapped: false,
	});
	private readonly mesh = new Mesh(this.geometry, this.material);
	private readonly gridGeometry = createGridGeometry(
		SPHERE_RADIUS + 0.008,
	);
	private readonly gridMaterial = new LineDashedMaterial({
		dashSize: 0.13,
		gapSize: 0.09,
		depthTest: true,
		depthWrite: false,
		opacity: 0.18,
		scale: 1,
		toneMapped: false,
		transparent: true,
	});
	private readonly grid = new LineSegments(
		this.gridGeometry,
		this.gridMaterial,
	);
	private readonly rimColor = new Color();
	private readonly rimMaterial = new ShaderMaterial({
		blending: AdditiveBlending,
		depthTest: true,
		depthWrite: false,
		fragmentShader: `
			uniform vec3 rimColor;
			uniform float rimOpacity;
			varying vec3 viewNormal;
			varying vec3 viewDirection;

			void main() {
				float facing = abs(dot(normalize(viewNormal), normalize(viewDirection)));
				float rim = pow(max(0.0, 1.0 - facing), 2.35);
				gl_FragColor = vec4(rimColor, rim * rimOpacity);
			}
		`,
		side: FrontSide,
		toneMapped: false,
		transparent: true,
		uniforms: {
			rimColor: { value: this.rimColor },
			rimOpacity: { value: 0.3 },
		},
		vertexShader: `
			varying vec3 viewNormal;
			varying vec3 viewDirection;

			void main() {
				vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
				viewNormal = normalize(normalMatrix * normal);
				viewDirection = -viewPosition.xyz;
				gl_Position = projectionMatrix * viewPosition;
			}
		`,
	});
	private readonly rim = new Mesh(this.geometry, this.rimMaterial);

	constructor(
		private readonly group: Group,
		appearance: AppearanceSettings,
		theme: RenderTheme,
	) {
		this.mesh.name = 'spherical-graph-surface';
		this.mesh.renderOrder = -1;
		this.grid.name = 'spherical-graph-surface-grid';
		this.grid.renderOrder = 0;
		this.grid.computeLineDistances();
		this.rim.name = 'spherical-graph-surface-rim';
		this.rim.renderOrder = 0;
		this.group.add(this.mesh, this.grid, this.rim);
		this.update(appearance, theme);
	}

	update(appearance: AppearanceSettings, theme: RenderTheme): void {
		const visible = appearance.surfaceMode !== 'hidden';
		this.mesh.visible = visible;
		this.grid.visible = visible;
		this.rim.visible = visible;
		this.material.color.set(theme.sphere);
		this.gridMaterial.color.set(theme.graticule);
		this.rimColor.set(theme.node);

		if (appearance.surfaceMode === 'transparent') {
			this.material.transparent = true;
			this.material.opacity = Math.min(0.24, appearance.surfaceOpacity);
			this.material.depthWrite = false;
			this.gridMaterial.opacity = 0.2;
			if (this.rimMaterial.uniforms.rimOpacity !== undefined) {
				this.rimMaterial.uniforms.rimOpacity.value = 0.42;
			}
		} else {
			this.material.transparent = appearance.surfaceOpacity < 1;
			this.material.opacity = appearance.surfaceOpacity;
			this.material.depthWrite = true;
			this.gridMaterial.opacity = 0.14;
			if (this.rimMaterial.uniforms.rimOpacity !== undefined) {
				this.rimMaterial.uniforms.rimOpacity.value = 0.32;
			}
		}
		this.material.needsUpdate = true;
		this.gridMaterial.needsUpdate = true;
		this.rimMaterial.needsUpdate = true;
	}

	dispose(): void {
		this.group.remove(this.mesh, this.grid, this.rim);
		this.geometry.dispose();
		this.gridGeometry.dispose();
		this.material.dispose();
		this.gridMaterial.dispose();
		this.rimMaterial.dispose();
	}
}

function createGridGeometry(radius: number): BufferGeometry {
	const positions: number[] = [];
	const segments = 96;
	const addSegment = (
		start: readonly [number, number, number],
		end: readonly [number, number, number],
	): void => {
		positions.push(...start, ...end);
	};

	for (let latitudeIndex = -5; latitudeIndex <= 5; latitudeIndex += 1) {
		const latitude = (latitudeIndex / 6) * (Math.PI / 2);
		const y = radius * Math.sin(latitude);
		const ringRadius = radius * Math.cos(latitude);
		for (let segment = 0; segment < segments; segment += 1) {
			const startAngle = (segment / segments) * Math.PI * 2;
			const endAngle = ((segment + 1) / segments) * Math.PI * 2;
			addSegment(
				[
					ringRadius * Math.cos(startAngle),
					y,
					ringRadius * Math.sin(startAngle),
				],
				[
					ringRadius * Math.cos(endAngle),
					y,
					ringRadius * Math.sin(endAngle),
				],
			);
		}
	}

	for (let longitudeIndex = 0; longitudeIndex < 18; longitudeIndex += 1) {
		const longitude = (longitudeIndex / 18) * Math.PI * 2;
		for (let segment = 0; segment < segments / 2; segment += 1) {
			const startPolar = (segment / (segments / 2)) * Math.PI;
			const endPolar = ((segment + 1) / (segments / 2)) * Math.PI;
			addSegment(
				pointOnSphere(radius, startPolar, longitude),
				pointOnSphere(radius, endPolar, longitude),
			);
		}
	}

	const geometry = new BufferGeometry();
	geometry.setAttribute(
		'position',
		new BufferAttribute(new Float32Array(positions), 3),
	);
	geometry.computeBoundingSphere();
	return geometry;
}

function pointOnSphere(
	radius: number,
	polar: number,
	longitude: number,
): [number, number, number] {
	const ringRadius = radius * Math.sin(polar);
	return [
		ringRadius * Math.cos(longitude),
		radius * Math.cos(polar),
		ringRadius * Math.sin(longitude),
	];
}
