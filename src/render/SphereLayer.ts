import {
	BufferAttribute,
	BufferGeometry,
	Color,
	FrontSide,
	Group,
	LineBasicMaterial,
	LineDashedMaterial,
	LineSegments,
	Mesh,
	MeshBasicMaterial,
	ShaderMaterial,
	SphereGeometry,
} from 'three';
import { SPHERE_RADIUS } from '../constants';
import { hashString } from '../geometry/deterministicHash';
import { AppearanceSettings } from '../settings/settings';
import {
	buildLandSurfaceData,
	type LandSurfaceData,
} from './landGeometry';
import {
	type PreparedRenderSnapshot,
	type RenderTheme,
} from './renderTypes';

// Keep the ocean depth skin slightly inside the logical globe. This gives
// land, graticule, roads, and cities unambiguous depth layers even on GPUs
// with modest depth-buffer precision.
const OCEAN_SURFACE_RADIUS = SPHERE_RADIUS - 0.12;
const LAND_SURFACE_RADIUS = SPHERE_RADIUS;

const PROCEDURAL_NOISE_GLSL = `
	float atlasHash(vec3 point) {
		point = fract(point * 0.1031);
		point += dot(point, point.yzx + 33.33);
		return fract((point.x + point.y) * point.z);
	}

	float atlasNoise(vec3 point) {
		vec3 cell = floor(point);
		vec3 local = fract(point);
		vec3 curve = local * local * (3.0 - 2.0 * local);
		return mix(
			mix(
				mix(atlasHash(cell), atlasHash(cell + vec3(1.0, 0.0, 0.0)), curve.x),
				mix(atlasHash(cell + vec3(0.0, 1.0, 0.0)), atlasHash(cell + vec3(1.0, 1.0, 0.0)), curve.x),
				curve.y
			),
			mix(
				mix(atlasHash(cell + vec3(0.0, 0.0, 1.0)), atlasHash(cell + vec3(1.0, 0.0, 1.0)), curve.x),
				mix(atlasHash(cell + vec3(0.0, 1.0, 1.0)), atlasHash(cell + vec3(1.0, 1.0, 1.0)), curve.x),
				curve.y
			),
			curve.z
		);
	}

	float atlasFbm(vec3 point) {
		float value = 0.0;
		float amplitude = 0.54;
		for (int octave = 0; octave < 4; octave += 1) {
			value += atlasNoise(point) * amplitude;
			point = point * 2.03 + vec3(7.1, 3.7, 5.9);
			amplitude *= 0.48;
		}
		return value;
	}
`;

export class SphereLayer {
	private readonly oceanGeometry = new SphereGeometry(
		OCEAN_SURFACE_RADIUS,
		64,
		40,
	);
	private readonly rimGeometry = new SphereGeometry(SPHERE_RADIUS, 64, 40);
	private readonly oceanColor = new Color();
	private readonly material = new ShaderMaterial({
		depthTest: true,
		depthWrite: true,
		fragmentShader: `
			uniform vec3 oceanColor;
			uniform float oceanOpacity;
			varying vec3 sphereDirection;
			varying vec3 viewNormal;
			varying vec3 viewDirection;
			${PROCEDURAL_NOISE_GLSL}

			void main() {
				vec3 direction = normalize(sphereDirection);
				float broadWater = atlasFbm(direction * 3.7 + vec3(2.4, 8.1, 4.3));
				float fineWater = atlasNoise(direction * 38.0 + vec3(1.7, 9.2, 2.1));
				float facing = abs(dot(normalize(viewNormal), normalize(viewDirection)));
				float limb = smoothstep(0.0, 0.9, facing);
				float texture = 0.88 + broadWater * 0.12 + (fineWater - 0.5) * 0.025;
				vec3 color = oceanColor * texture;
				color += oceanColor * limb * 0.055;
				gl_FragColor = vec4(color, oceanOpacity);
				#include <colorspace_fragment>
			}
		`,
		side: FrontSide,
		toneMapped: false,
		uniforms: {
			oceanColor: { value: this.oceanColor },
			oceanOpacity: { value: 1 },
		},
		vertexShader: `
			varying vec3 sphereDirection;
			varying vec3 viewNormal;
			varying vec3 viewDirection;

			void main() {
				vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
				sphereDirection = normalize(position);
				viewNormal = normalize(normalMatrix * normal);
				viewDirection = -viewPosition.xyz;
				gl_Position = projectionMatrix * viewPosition;
			}
		`,
	});
	private readonly mesh = new Mesh(this.oceanGeometry, this.material);
	/**
	 * The textured ocean is inset slightly to keep roads and cities clear of
	 * the water skin. In Solid mode this colorless shell restores the exact
	 * logical globe silhouette in the depth buffer, including at the limb.
	 */
	private readonly depthMaskMaterial = new MeshBasicMaterial({
		colorWrite: false,
		depthTest: true,
		depthWrite: true,
		side: FrontSide,
		toneMapped: false,
		transparent: false,
	});
	private readonly depthMask = new Mesh(
		this.rimGeometry,
		this.depthMaskMaterial,
	);
	private readonly gridGeometry = createGridGeometry(
		SPHERE_RADIUS + 0.008,
	);
	private readonly gridMaterial = new LineDashedMaterial({
		dashSize: 0.12,
		gapSize: 0.11,
		depthTest: true,
		depthWrite: false,
		opacity: 0.11,
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
		depthTest: true,
		depthWrite: false,
		fragmentShader: `
			uniform vec3 rimColor;
			uniform float rimOpacity;
			varying vec3 viewNormal;
			varying vec3 viewDirection;

			void main() {
				float facing = abs(dot(normalize(viewNormal), normalize(viewDirection)));
				float rim = pow(max(0.0, 1.0 - facing), 3.1);
				gl_FragColor = vec4(rimColor, rim * rimOpacity);
			}
		`,
		side: FrontSide,
		toneMapped: false,
		transparent: true,
		uniforms: {
			rimColor: { value: this.rimColor },
			rimOpacity: { value: 0.18 },
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
	private readonly rim = new Mesh(this.rimGeometry, this.rimMaterial);
	private snapshot: PreparedRenderSnapshot | undefined;
	private appearance: AppearanceSettings;
	private theme: RenderTheme;
	private landData: LandSurfaceData | undefined;
	private landGeometry: BufferGeometry | undefined;
	private landMaterial: ShaderMaterial | undefined;
	private landMesh: Mesh | undefined;
	private beachGeometry: BufferGeometry | undefined;
	private beachMaterial: ShaderMaterial | undefined;
	private beachMesh: Mesh | undefined;
	private coastGeometry: BufferGeometry | undefined;
	private coastMaterial: LineBasicMaterial | undefined;
	private coastLines: LineSegments | undefined;

	constructor(
		private readonly group: Group,
		appearance: AppearanceSettings,
		theme: RenderTheme,
	) {
		this.appearance = appearance;
		this.theme = theme;
		this.mesh.name = 'spherical-graph-surface';
		this.mesh.renderOrder = -2;
		this.depthMask.name = 'spherical-graph-solid-depth-mask';
		this.depthMask.renderOrder = -1;
		this.grid.name = 'spherical-graph-surface-grid';
		this.grid.renderOrder = 1;
		this.grid.computeLineDistances();
		this.rim.name = 'spherical-graph-surface-rim';
		this.rim.renderOrder = 3;
		this.group.add(this.mesh, this.depthMask, this.grid, this.rim);
		this.update(appearance, theme);
	}

	setSnapshot(snapshot: PreparedRenderSnapshot): void {
		this.snapshot = snapshot;
		this.rebuildLand();
	}

	update(appearance: AppearanceSettings, theme: RenderTheme): void {
		this.appearance = appearance;
		const themeChanged =
			this.theme !== theme ||
			this.theme.land.join('|') !== theme.land.join('|') ||
			this.theme.coast !== theme.coast;
		this.theme = theme;
		const visible = appearance.surfaceMode !== 'hidden';
		this.mesh.visible = visible;
		this.depthMask.visible = appearance.surfaceMode === 'solid';
		this.grid.visible = visible;
		this.rim.visible = visible;
		this.oceanColor.set(theme.sphere);
		this.gridMaterial.color.set(theme.graticule);
		this.rimColor.set(theme.coast);

		if (appearance.surfaceMode === 'transparent') {
			this.material.transparent = true;
			if (this.material.uniforms.oceanOpacity !== undefined) {
				this.material.uniforms.oceanOpacity.value = Math.min(
					0.3,
					appearance.surfaceOpacity,
				);
			}
			this.material.depthWrite = false;
			this.gridMaterial.opacity = 0.08;
			if (this.rimMaterial.uniforms.rimOpacity !== undefined) {
				this.rimMaterial.uniforms.rimOpacity.value = 0.22;
			}
		} else {
			// "Solid" is an actual opaque surface. surfaceOpacity only
			// controls the explicitly transparent presentation.
			this.material.transparent = false;
			if (this.material.uniforms.oceanOpacity !== undefined) {
				this.material.uniforms.oceanOpacity.value = 1;
			}
			this.material.depthWrite = true;
			this.gridMaterial.opacity = 0.13;
			if (this.rimMaterial.uniforms.rimOpacity !== undefined) {
				this.rimMaterial.uniforms.rimOpacity.value = 0.16;
			}
		}
		this.updateLandVisibility();
		if (themeChanged) {
			this.recolorLand();
		}
		this.material.needsUpdate = true;
		this.gridMaterial.needsUpdate = true;
		this.rimMaterial.needsUpdate = true;
	}

	dispose(): void {
		this.removeLand();
		this.group.remove(this.mesh, this.depthMask, this.grid, this.rim);
		this.oceanGeometry.dispose();
		this.rimGeometry.dispose();
		this.gridGeometry.dispose();
		this.material.dispose();
		this.depthMaskMaterial.dispose();
		this.gridMaterial.dispose();
		this.rimMaterial.dispose();
		this.snapshot = undefined;
	}

	private rebuildLand(): void {
		this.removeLand();
		const snapshot = this.snapshot;
		if (
			snapshot === undefined ||
			(snapshot.geography.continents.length === 0 &&
				snapshot.geography.islandNodeIndices.length === 0)
		) {
			return;
		}
		const data = buildLandSurfaceData(
			snapshot.geography,
			snapshot.positions,
			LAND_SURFACE_RADIUS,
			hashString(snapshot.snapshotId.split(':')[0] ?? snapshot.snapshotId),
			48,
			snapshot.edges,
		);
		this.landData = data;
		const beachGeometry = new BufferGeometry();
		beachGeometry.setAttribute(
			'position',
			new BufferAttribute(data.beachPositions, 3),
		);
		beachGeometry.computeBoundingSphere();
		const beachMaterial = new ShaderMaterial({
			depthTest: true,
			depthWrite: true,
			fragmentShader: `
				uniform vec3 beachColor;
				uniform float beachOpacity;
				varying vec3 sphereDirection;
				${PROCEDURAL_NOISE_GLSL}

				void main() {
					vec3 direction = normalize(sphereDirection);
					float dunes = atlasFbm(direction * 24.0 + vec3(3.1, 8.7, 1.9));
					float grains = atlasHash(direction * 421.0 + vec3(6.7, 2.3, 9.1));
					float wetEdge = atlasNoise(direction * 67.0 + vec3(1.2, 7.4, 4.6));
					float tone =
						0.78 +
						dunes * 0.2 +
						(grains - 0.5) * 0.12 +
						(wetEdge - 0.5) * 0.06;
					gl_FragColor = vec4(beachColor * tone, beachOpacity);
					#include <colorspace_fragment>
				}
			`,
			side: FrontSide,
			toneMapped: false,
			transparent: false,
			uniforms: {
				beachColor: { value: new Color(this.theme.coast) },
				beachOpacity: { value: 1 },
			},
			vertexShader: `
				varying vec3 sphereDirection;

				void main() {
					sphereDirection = normalize(position);
					gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
				}
			`,
			polygonOffset: true,
			polygonOffsetFactor: -0.5,
			polygonOffsetUnits: -0.5,
		});
		const beachMesh = new Mesh(beachGeometry, beachMaterial);
		beachMesh.name = 'spherical-graph-beaches';
		beachMesh.renderOrder = -0.5;
		this.group.add(beachMesh);
		this.beachGeometry = beachGeometry;
		this.beachMaterial = beachMaterial;
		this.beachMesh = beachMesh;

		const geometry = new BufferGeometry();
		geometry.setAttribute(
			'position',
			new BufferAttribute(data.positions, 3),
		);
		geometry.setAttribute(
			'color',
			new BufferAttribute(new Float32Array(data.positions.length), 3),
		);
		geometry.computeBoundingSphere();
		const material = new ShaderMaterial({
			depthTest: true,
			depthWrite: true,
			fragmentShader: `
				uniform float landOpacity;
				varying vec3 landColor;
				varying vec3 sphereDirection;
				${PROCEDURAL_NOISE_GLSL}

				void main() {
					vec3 direction = normalize(sphereDirection);
					float relief = atlasFbm(direction * 7.2 + vec3(6.3, 1.8, 9.4));
					float strata = atlasFbm(direction * 17.0 + vec3(2.0, 7.6, 3.4));
					float grain = atlasHash(direction * 307.0);
					float ridge = 1.0 - abs(relief * 2.0 - 1.0);
					float contourDistance = abs(fract(relief * 7.5) - 0.5);
					float contour = 1.0 - smoothstep(0.035, 0.075, contourDistance);
					float tone =
						0.68 +
						relief * 0.34 +
						(strata - 0.5) * 0.16 +
						(grain - 0.5) * 0.1;
					vec3 color = landColor * tone;
					color += vec3(0.08, 0.062, 0.038) * ridge;
					color *= 1.0 - contour * 0.09;
					gl_FragColor = vec4(color, landOpacity);
					#include <colorspace_fragment>
				}
			`,
			side: FrontSide,
			toneMapped: false,
			transparent: false,
			uniforms: {
				landOpacity: { value: 0.96 },
			},
			vertexShader: `
				attribute vec3 color;
				varying vec3 landColor;
				varying vec3 sphereDirection;

				void main() {
					landColor = color;
					sphereDirection = normalize(position);
					gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
				}
			`,
			// The atlas land skin sits deliberately below roads and cities, but
			// still needs a stable depth advantage over the ocean sphere.
			polygonOffset: true,
			polygonOffsetFactor: -1,
			polygonOffsetUnits: -1,
		});
		const mesh = new Mesh(geometry, material);
		mesh.name = 'spherical-graph-continents';
		mesh.renderOrder = 0;
		this.group.add(mesh);
		this.landGeometry = geometry;
		this.landMaterial = material;
		this.landMesh = mesh;

		const coastGeometry = new BufferGeometry();
		coastGeometry.setAttribute(
			'position',
			new BufferAttribute(data.coastPositions, 3),
		);
		coastGeometry.computeBoundingSphere();
		const coastMaterial = new LineBasicMaterial({
			color: this.theme.coast,
			depthTest: true,
			depthWrite: false,
			opacity: 0.9,
			toneMapped: false,
			transparent: true,
		});
		const coastLines = new LineSegments(
			coastGeometry,
			coastMaterial,
		);
		coastLines.name = 'spherical-graph-coastlines';
		coastLines.renderOrder = 2;
		this.group.add(coastLines);
		this.coastGeometry = coastGeometry;
		this.coastMaterial = coastMaterial;
		this.coastLines = coastLines;
		this.recolorLand();
		this.updateLandVisibility();
	}

	private recolorLand(): void {
		const data = this.landData;
		const attribute = this.landGeometry?.getAttribute('color');
		if (
			data === undefined ||
			attribute === undefined ||
			!(attribute instanceof BufferAttribute) ||
			this.theme.land.length === 0
		) {
			return;
		}
		const color = new Color();
		for (let vertex = 0; vertex < data.colorIndices.length; vertex += 1) {
			const colorIndex = data.colorIndices[vertex] ?? 0;
			const shade = data.shades[vertex] ?? 1;
			color
				.set(this.theme.land[colorIndex % this.theme.land.length] ?? '#66725a')
				.multiplyScalar(shade);
			attribute.setXYZ(vertex, color.r, color.g, color.b);
		}
		attribute.needsUpdate = true;
		this.coastMaterial?.color.set(this.theme.coast);
		if (this.coastMaterial !== undefined) {
			this.coastMaterial.needsUpdate = true;
		}
		if (
			this.beachMaterial?.uniforms.beachColor !== undefined
		) {
			(
				this.beachMaterial.uniforms.beachColor.value as Color
			).set(this.theme.coast);
			this.beachMaterial.needsUpdate = true;
		}
	}

	private updateLandVisibility(): void {
		const visible =
			this.appearance.surfaceMode !== 'hidden' &&
			this.appearance.showContinents;
		if (this.landMesh !== undefined && this.landMaterial !== undefined) {
			this.landMesh.visible = visible;
			this.landMaterial.transparent =
				this.appearance.surfaceMode === 'transparent';
			if (this.landMaterial.uniforms.landOpacity !== undefined) {
				this.landMaterial.uniforms.landOpacity.value =
					this.appearance.surfaceMode === 'transparent' ? 0.58 : 1;
			}
			this.landMaterial.depthWrite =
				this.appearance.surfaceMode !== 'transparent';
			this.landMaterial.needsUpdate = true;
		}
		if (
			this.beachMesh !== undefined &&
			this.beachMaterial !== undefined
		) {
			this.beachMesh.visible = visible;
			this.beachMaterial.transparent =
				this.appearance.surfaceMode === 'transparent';
			if (this.beachMaterial.uniforms.beachOpacity !== undefined) {
				this.beachMaterial.uniforms.beachOpacity.value =
					this.appearance.surfaceMode === 'transparent' ? 0.52 : 1;
			}
			this.beachMaterial.depthWrite =
				this.appearance.surfaceMode !== 'transparent';
			this.beachMaterial.needsUpdate = true;
		}
		if (
			this.coastLines !== undefined &&
			this.coastMaterial !== undefined
		) {
			this.coastLines.visible = visible;
			this.coastMaterial.opacity =
				this.appearance.surfaceMode === 'transparent' ? 0.5 : 0.9;
			this.coastMaterial.needsUpdate = true;
		}
	}

	private removeLand(): void {
		if (this.landMesh !== undefined) {
			this.group.remove(this.landMesh);
		}
		if (this.coastLines !== undefined) {
			this.group.remove(this.coastLines);
		}
		if (this.beachMesh !== undefined) {
			this.group.remove(this.beachMesh);
		}
		this.landGeometry?.dispose();
		this.landMaterial?.dispose();
		this.beachGeometry?.dispose();
		this.beachMaterial?.dispose();
		this.coastGeometry?.dispose();
		this.coastMaterial?.dispose();
		this.landData = undefined;
		this.landGeometry = undefined;
		this.landMaterial = undefined;
		this.landMesh = undefined;
		this.beachGeometry = undefined;
		this.beachMaterial = undefined;
		this.beachMesh = undefined;
		this.coastGeometry = undefined;
		this.coastMaterial = undefined;
		this.coastLines = undefined;
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
