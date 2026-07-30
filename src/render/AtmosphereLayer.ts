import {
	Color,
	type ColorRepresentation,
	FrontSide,
	Group,
	Mesh,
	ShaderMaterial,
	SphereGeometry,
} from 'three';
import {
	DEFAULT_ATMOSPHERE_HEIGHT_PERCENT,
	MAX_ATMOSPHERE_HEIGHT_PERCENT,
	MIN_ATMOSPHERE_HEIGHT_PERCENT,
	SPHERE_RADIUS,
} from '../constants';

export { DEFAULT_ATMOSPHERE_HEIGHT_PERCENT } from '../constants';
export const ATMOSPHERE_ROTATION_PERIOD_MS = 10 * 60 * 1_000;

const DEFAULT_ATMOSPHERE_COLOR = '#dcebf2';
const DEFAULT_ATMOSPHERE_OPACITY = 0.82;

const PROCEDURAL_CLOUD_GLSL = `
	float atmosphereHash(vec3 point) {
		point = fract(point * 0.1031);
		point += dot(point, point.yzx + 33.33);
		return fract((point.x + point.y) * point.z);
	}

	float atmosphereNoise(vec3 point) {
		vec3 cell = floor(point);
		vec3 local = fract(point);
		vec3 curve = local * local * (3.0 - 2.0 * local);
		return mix(
			mix(
				mix(
					atmosphereHash(cell),
					atmosphereHash(cell + vec3(1.0, 0.0, 0.0)),
					curve.x
				),
				mix(
					atmosphereHash(cell + vec3(0.0, 1.0, 0.0)),
					atmosphereHash(cell + vec3(1.0, 1.0, 0.0)),
					curve.x
				),
				curve.y
			),
			mix(
				mix(
					atmosphereHash(cell + vec3(0.0, 0.0, 1.0)),
					atmosphereHash(cell + vec3(1.0, 0.0, 1.0)),
					curve.x
				),
				mix(
					atmosphereHash(cell + vec3(0.0, 1.0, 1.0)),
					atmosphereHash(cell + vec3(1.0, 1.0, 1.0)),
					curve.x
				),
				curve.y
			),
			curve.z
		);
	}

	float atmosphereFbm(vec3 point) {
		float value = 0.0;
		float amplitude = 0.54;
		for (int octave = 0; octave < 4; octave += 1) {
			value += atmosphereNoise(point) * amplitude;
			point = point * 2.04 + vec3(6.7, 3.2, 8.4);
			amplitude *= 0.47;
		}
		return value;
	}
`;

export interface AtmosphereLayerOptions {
	heightPercent?: number;
	visible?: boolean;
	color?: ColorRepresentation;
	opacity?: number;
}

/**
 * A sparse procedural cloud shell. The material intentionally has no uniform
 * transparent fill: only cloud bands and a broken, noise-modulated limb are
 * drawn, avoiding the visual impression of a glass globe.
 */
export class AtmosphereLayer {
	private readonly geometry = new SphereGeometry(1, 64, 40);
	private readonly color = new Color();
	private readonly material: ShaderMaterial;
	private readonly mesh: Mesh;
	private heightPercent: number;
	private visible: boolean;

	constructor(
		private readonly group: Group,
		options: AtmosphereLayerOptions = {},
	) {
		this.heightPercent = normalizeAtmosphereHeightPercent(
			options.heightPercent,
		);
		this.visible = options.visible ?? true;
		this.color.set(options.color ?? DEFAULT_ATMOSPHERE_COLOR);
		this.material = createAtmosphereMaterial(
			this.color,
			normalizeAtmosphereOpacity(options.opacity),
		);
		this.mesh = new Mesh(this.geometry, this.material);
		this.mesh.name = 'spherical-graph-atmosphere';
		this.mesh.renderOrder = 4;
		this.mesh.frustumCulled = false;
		this.mesh.visible = this.visible;
		this.mesh.scale.setScalar(
			atmosphereRadiusForHeight(this.heightPercent),
		);
		this.group.add(this.mesh);
	}

	get object(): Mesh {
		return this.mesh;
	}

	get isVisible(): boolean {
		return this.visible;
	}

	get radius(): number {
		return atmosphereRadiusForHeight(this.heightPercent);
	}

	setVisible(visible: boolean): void {
		this.visible = visible;
		this.mesh.visible = visible;
	}

	setHeightPercent(heightPercent: number): void {
		this.heightPercent =
			normalizeAtmosphereHeightPercent(heightPercent);
		this.mesh.scale.setScalar(
			atmosphereRadiusForHeight(this.heightPercent),
		);
	}

	setColor(color: ColorRepresentation): void {
		this.color.set(color);
	}

	setOpacity(opacity: number): void {
		const opacityUniform = this.material.uniforms.atmosphereOpacity;
		if (opacityUniform !== undefined) {
			opacityUniform.value = normalizeAtmosphereOpacity(opacity);
		}
	}

	/**
	 * Advances the independent cloud longitude. Returning `true` while visible
	 * lets the owning renderer keep its animation frame loop alive.
	 */
	render(timestampMs: number): boolean {
		if (!this.visible) {
			return false;
		}
		this.mesh.rotation.y = atmosphereRotationAngle(timestampMs);
		return true;
	}

	dispose(): void {
		this.group.remove(this.mesh);
		this.geometry.dispose();
		this.material.dispose();
	}
}

export function atmosphereRadiusForHeight(
	heightPercent = DEFAULT_ATMOSPHERE_HEIGHT_PERCENT,
): number {
	return (
		SPHERE_RADIUS *
		(1 + normalizeAtmosphereHeightPercent(heightPercent) / 100)
	);
}

export function atmosphereRotationAngle(timestampMs: number): number {
	if (!Number.isFinite(timestampMs)) {
		return 0;
	}
	const wrappedTime =
		((timestampMs % ATMOSPHERE_ROTATION_PERIOD_MS) +
			ATMOSPHERE_ROTATION_PERIOD_MS) %
		ATMOSPHERE_ROTATION_PERIOD_MS;
	return (
		(wrappedTime / ATMOSPHERE_ROTATION_PERIOD_MS) *
		Math.PI *
		2
	);
}

function normalizeAtmosphereHeightPercent(
	heightPercent: number | undefined,
): number {
	if (
		heightPercent === undefined ||
		!Number.isFinite(heightPercent) ||
		heightPercent <= 0
	) {
		return DEFAULT_ATMOSPHERE_HEIGHT_PERCENT;
	}
	return Math.min(
		MAX_ATMOSPHERE_HEIGHT_PERCENT,
		Math.max(MIN_ATMOSPHERE_HEIGHT_PERCENT, heightPercent),
	);
}

function normalizeAtmosphereOpacity(opacity: number | undefined): number {
	if (opacity === undefined || !Number.isFinite(opacity)) {
		return DEFAULT_ATMOSPHERE_OPACITY;
	}
	return Math.min(1, Math.max(0, opacity));
}

function createAtmosphereMaterial(
	color: Color,
	opacity: number,
): ShaderMaterial {
	return new ShaderMaterial({
		depthTest: true,
		depthWrite: false,
		fragmentShader: `
			uniform vec3 atmosphereColor;
			uniform float atmosphereOpacity;
			varying vec3 cloudDirection;
			varying vec3 viewNormal;
			varying vec3 viewDirection;
			${PROCEDURAL_CLOUD_GLSL}

			void main() {
				vec3 direction = normalize(cloudDirection);
				float broad = atmosphereFbm(
					direction * 2.65 + vec3(2.1, 7.3, 4.8)
				);
				float filaments = atmosphereFbm(
					direction * 7.4 + vec3(9.2, 1.6, 5.1)
				);
				float detail = atmosphereNoise(
					direction * 38.0 + vec3(3.7, 8.8, 1.4)
				);
				float cloudField =
					broad * 0.64 +
					filaments * 0.30 +
					detail * 0.06;
				float cloudMask = smoothstep(0.58, 0.75, cloudField);
				cloudMask *= smoothstep(0.40, 0.61, broad);

				vec3 normalDirection = normalize(viewNormal);
				vec3 eyeDirection = normalize(viewDirection);
				float facing = clamp(
					dot(normalDirection, eyeDirection),
					0.0,
					1.0
				);
				float limb = pow(max(0.0, 1.0 - facing), 2.35);
				float brokenRim = smoothstep(
					0.35,
					0.78,
					atmosphereFbm(
						direction * 11.0 + vec3(4.4, 2.8, 9.1)
					)
				);

				float cloudAlpha =
					cloudMask * (0.10 + pow(facing, 0.58) * 0.28);
				float rimAlpha =
					limb *
					brokenRim *
					(0.008 + cloudMask * 0.075);
				float alpha =
					atmosphereOpacity * (cloudAlpha + rimAlpha);
				if (alpha < 0.004) {
					discard;
				}

				float highlight = 0.20 + facing * 0.28 + cloudMask * 0.18;
				vec3 cloudColor = mix(
					atmosphereColor * 0.82,
					vec3(0.96, 0.985, 1.0),
					highlight
				);
				gl_FragColor = vec4(cloudColor, alpha);
				#include <colorspace_fragment>
			}
		`,
		side: FrontSide,
		toneMapped: false,
		transparent: true,
		uniforms: {
			atmosphereColor: { value: color },
			atmosphereOpacity: { value: opacity },
		},
		vertexShader: `
			varying vec3 cloudDirection;
			varying vec3 viewNormal;
			varying vec3 viewDirection;

			void main() {
				vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
				cloudDirection = normalize(position);
				viewNormal = normalize(normalMatrix * normal);
				viewDirection = -viewPosition.xyz;
				gl_Position = projectionMatrix * viewPosition;
			}
		`,
	});
}
