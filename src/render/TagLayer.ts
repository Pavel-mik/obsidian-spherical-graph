import {
	BufferAttribute,
	BufferGeometry,
	Camera,
	Color,
	DynamicDrawUsage,
	Group,
	InstancedMesh,
	LineSegments,
	Matrix4,
	OctahedronGeometry,
	ShaderMaterial,
	Vector3,
} from 'three';
import {
	BASE_TAG_MARKER_SIZE,
	DEFAULT_TAG_ORBIT_HEIGHT_PERCENT,
	DEFAULT_GLOBE_SIZE,
	SPHERE_RADIUS,
	TAG_LINK_START_RADIUS,
} from '../constants';
import type { Vec3 } from '../geometry/vector3';
import { AppearanceSettings } from '../settings/settings';
import {
	PreparedRenderSnapshot,
	RenderRouteState,
	RenderTag,
	RenderTheme,
} from './renderTypes';
import { labelZoomVisuals } from './labelVisibility';
import {
	computeTagOrbitDirections,
	isPointOccludedByGlobe,
	sampleTagSpiral,
} from './tagGeometry';

const TAG_SPIRAL_SEGMENTS = 30;
const MAX_VISIBLE_TAG_LABELS = 96;
const TAG_MARKER_SCALE_FACTOR = 0.78;
const TAG_DEPTH_MINIMUM_VISIBILITY = 0.34;
const TAG_DEPTH_FADE_START = -0.22;
const TAG_DEPTH_FADE_END = 0.86;
const DARK_SCENE_SATELLITE_SILVER = '#d9e2e7';
const DARK_SCENE_LINK_SILVER = '#b7c4cb';
const LIGHT_SCENE_SATELLITE_SILVER = '#5f6c74';
const LIGHT_SCENE_LINK_SILVER = '#78868e';
export const TAG_CAMERA_CLEARANCE_DOT = 0.82;

export class TagLayer {
	private markerMesh: InstancedMesh | undefined;
	private markerMaterial: ShaderMaterial | undefined;
	private linkLines: LineSegments | undefined;
	private linkMaterial: ShaderMaterial | undefined;
	private snapshot: PreparedRenderSnapshot | undefined;
	private appearance: AppearanceSettings;
	private selectedNodeId: string | undefined;
	private selectedTagId: string | undefined;
	private route: RenderRouteState | undefined;
	private visible = true;
	private readonly directions = new Map<string, Vec3>();
	private readonly linkedTagIds = new Set<string>();
	private readonly matrix = new Matrix4();
	private readonly position = new Vector3();
	private readonly worldPosition = new Vector3();
	private readonly projectedPosition = new Vector3();
	private readonly cameraDirection = new Vector3();
	private readonly markerColor = new Color();
	private readonly linkColor = new Color();
	private readonly labelRoot: HTMLElement | undefined;
	private readonly labelPool: HTMLElement[] = [];

	constructor(
		private readonly group: Group,
		appearance: AppearanceSettings,
		theme: RenderTheme,
		container?: HTMLElement,
	) {
		this.appearance = appearance;
		this.applySilverTheme(theme);
		if (container !== undefined) {
			this.labelRoot = container.createDiv();
			this.labelRoot.className = 'spherical-graph-tag-label-layer';
			this.labelRoot.setAttribute('aria-hidden', 'true');
			container.append(this.labelRoot);
		}
	}

	setSnapshot(snapshot: PreparedRenderSnapshot): void {
		this.removeMarkers();
		this.removeLinks();
		this.snapshot = snapshot;
		this.directions.clear();
		for (const [tagId, direction] of computeTagOrbitDirections(
			snapshot.tags,
			snapshot.positions,
		)) {
			this.directions.set(tagId, direction);
		}
		this.createMarkers(snapshot.tags);
		this.resizeLabelPool();
		this.rebuildLinks();
	}

	updateAppearance(appearance: AppearanceSettings): void {
		const orbitHeightChanged =
			appearance.tagOrbitHeightPercent !==
			this.appearance.tagOrbitHeightPercent;
		this.appearance = appearance;
		this.updateMarkerMatrices();
		if (orbitHeightChanged) {
			this.rebuildLinks();
		}
		this.updateMaterialSettings();
	}

	updateTheme(theme: RenderTheme): void {
		this.applySilverTheme(theme);
	}

	updateSelection(selectedNodeId: string | undefined): void {
		this.selectedNodeId = selectedNodeId;
		this.rebuildLinks();
	}

	updateSelectedTag(selectedTagId: string | undefined): void {
		this.selectedTagId = selectedTagId;
		this.updateMarkerMatrices();
		this.rebuildLinks();
	}

	setVisible(visible: boolean): void {
		if (this.visible === visible) {
			return;
		}
		this.visible = visible;
		if (this.markerMesh !== undefined) {
			this.markerMesh.visible = visible;
		}
		if (this.linkLines !== undefined) {
			this.linkLines.visible = visible;
		}
		if (this.labelRoot !== undefined) {
			this.labelRoot.hidden = !visible;
		}
		if (!visible) {
			this.hideLabels();
		}
	}

	get mesh(): InstancedMesh | undefined {
		return this.markerMesh;
	}

	tagForInstance(instanceId: number): RenderTag | undefined {
		return this.snapshot?.tags[instanceId];
	}

	positionForTag(tagId: string, target: Vector3): Vector3 | undefined {
		if (!this.visible || !this.snapshot?.tagById.has(tagId)) {
			return undefined;
		}
		const direction = this.directions.get(tagId);
		if (direction === undefined) {
			return undefined;
		}
		return target
			.set(direction[0], direction[1], direction[2])
			.multiplyScalar(tagOrbitRadiusForAppearance(this.appearance));
	}

	isTagPickable(instanceId: number, camera: Camera): boolean {
		if (!this.visible) {
			return false;
		}
		const tag = this.tagForInstance(instanceId);
		const direction =
			tag === undefined ? undefined : this.directions.get(tag.id);
		if (direction === undefined) {
			return false;
		}
		this.group.updateWorldMatrix(true, false);
		this.worldPosition
			.set(direction[0], direction[1], direction[2])
			.multiplyScalar(tagOrbitRadiusForAppearance(this.appearance))
			.applyMatrix4(this.group.matrixWorld);
		if (isPointOccludedByGlobe(camera.position, this.worldPosition)) {
			return false;
		}
		if (!this.appearance.tagViewProtectionEnabled) {
			return true;
		}
		this.cameraDirection.copy(camera.position).normalize();
		return (
			Math.abs(
				this.worldPosition
					.clone()
					.normalize()
					.dot(this.cameraDirection),
			) <= TAG_CAMERA_CLEARANCE_DOT
		);
	}

	updateRoute(route: RenderRouteState | undefined): void {
		this.route =
			route === undefined
				? undefined
				: {
						...route,
						nodeIds: [...route.nodeIds],
						edges: [...route.edges],
					};
		this.rebuildLinks();
	}

	render(camera: Camera, width: number, height: number): void {
		const zoomVisuals = labelZoomVisuals(
			camera.position.length(),
			this.appearance.labelZoomThresholdPercent,
		);
		if (
			!this.visible ||
			!this.appearance.showLabels ||
			zoomVisuals.opacity <= 0.01 ||
			this.labelRoot === undefined ||
			this.snapshot === undefined ||
			width <= 0 ||
			height <= 0
		) {
			this.hideLabels();
			return;
		}
		this.cameraDirection.copy(camera.position).normalize();
		const orbitRadius = tagOrbitRadiusForAppearance(this.appearance);
		const candidates = [...this.snapshot.tags].sort(
			(left, right) =>
				Number(this.linkedTagIds.has(right.id)) -
					Number(this.linkedTagIds.has(left.id)) ||
				right.nodeIndices.length - left.nodeIndices.length ||
				left.label.localeCompare(right.label),
		);

		let visibleIndex = 0;
		for (const tag of candidates) {
			if (visibleIndex >= this.labelPool.length) {
				break;
			}
			const direction = this.directions.get(tag.id);
			if (direction === undefined) {
				continue;
			}
			this.worldPosition
				.set(direction[0], direction[1], direction[2])
				.multiplyScalar(orbitRadius)
				.applyMatrix4(this.group.matrixWorld);
			if (
				isPointOccludedByGlobe(
					camera.position,
					this.worldPosition,
				)
			) {
				continue;
			}
			if (this.appearance.tagViewProtectionEnabled) {
				const alignment = Math.abs(
					this.worldPosition
						.clone()
						.normalize()
						.dot(this.cameraDirection),
				);
				if (alignment > TAG_CAMERA_CLEARANCE_DOT) {
					continue;
				}
			}

			this.projectedPosition.copy(this.worldPosition).project(camera);
			if (
				this.projectedPosition.z < -1 ||
				this.projectedPosition.z > 1 ||
				Math.abs(this.projectedPosition.x) > 1.06 ||
				Math.abs(this.projectedPosition.y) > 1.06
			) {
				continue;
			}
			const element = this.labelPool[visibleIndex];
			if (element === undefined) {
				break;
			}
			const screenX = (this.projectedPosition.x * 0.5 + 0.5) * width;
			const screenY = (-this.projectedPosition.y * 0.5 + 0.5) * height;
			element.textContent = tag.label;
			element.title = `${tag.label} · ${tag.nodeIndices.length} ${
				tag.nodeIndices.length === 1 ? 'note' : 'notes'
			}`;
			element.dataset.connected = String(
				this.linkedTagIds.has(tag.id),
			);
			element.dataset.selected = String(
				tag.id === this.selectedTagId,
			);
			const perspectiveVisibility = tagPerspectiveVisibility(
				this.worldPosition.dot(this.cameraDirection) /
					Math.max(this.worldPosition.length(), Number.EPSILON),
			);
			element.style.opacity = (
				zoomVisuals.opacity * perspectiveVisibility
			).toFixed(3);
			element.style.transform = `translate(${screenX.toFixed(1)}px, ${screenY.toFixed(1)}px) translate(-50%, -50%) scale(${zoomVisuals.scale.toFixed(3)})`;
			element.hidden = false;
			visibleIndex += 1;
		}
		for (
			let index = visibleIndex;
			index < this.labelPool.length;
			index += 1
		) {
			const element = this.labelPool[index];
			if (element !== undefined) {
				element.hidden = true;
			}
		}
	}

	dispose(): void {
		this.removeMarkers();
		this.removeLinks();
		this.labelPool.length = 0;
		this.labelRoot?.remove();
		this.snapshot = undefined;
		this.directions.clear();
		this.linkedTagIds.clear();
	}

	private createMarkers(tags: readonly RenderTag[]): void {
		if (tags.length === 0) {
			return;
		}
		const material = createTagMaterial(
			this.markerColor,
			this.appearance.tagViewProtectionEnabled,
		);
		const mesh = new InstancedMesh(
			new OctahedronGeometry(1, 0),
			material,
			tags.length,
		);
		mesh.name = 'spherical-graph-tag-satellites';
		mesh.count = tags.length;
		mesh.instanceMatrix.setUsage(DynamicDrawUsage);
		mesh.renderOrder = 6;
		mesh.frustumCulled = false;
		mesh.visible = this.visible;
		this.markerMaterial = material;
		this.markerMesh = mesh;
		this.group.add(mesh);
		this.updateMarkerMatrices();
	}

	private updateMarkerMatrices(): void {
		const mesh = this.markerMesh;
		const snapshot = this.snapshot;
		if (mesh === undefined || snapshot === undefined) {
			return;
		}
		const baseScale = tagMarkerScaleForGlobe(
			this.appearance.globeSize,
		);
		const orbitRadius = tagOrbitRadiusForAppearance(this.appearance);
		for (let index = 0; index < snapshot.tags.length; index += 1) {
			const tag = snapshot.tags[index];
			const direction =
				tag === undefined ? undefined : this.directions.get(tag.id);
			if (direction === undefined) {
				continue;
			}
			this.position
				.set(direction[0], direction[1], direction[2])
				.multiplyScalar(orbitRadius);
			const scale =
				tag?.id === this.selectedTagId
					? baseScale * 1.45
					: baseScale;
			this.matrix.makeScale(scale, scale, scale);
			this.matrix.setPosition(this.position);
			mesh.setMatrixAt(index, this.matrix);
		}
		mesh.instanceMatrix.needsUpdate = true;
		mesh.computeBoundingSphere();
	}

	private rebuildLinks(): void {
		this.removeLinks();
		this.linkedTagIds.clear();
		const snapshot = this.snapshot;
		if (snapshot === undefined) {
			return;
		}
		const visibleNodeIndices = new Set<number>();
		const offerNode = (nodeId: string | undefined): void => {
			const node =
				nodeId === undefined
					? undefined
					: snapshot.nodeById.get(nodeId);
			if (node !== undefined) {
				visibleNodeIndices.add(node.index);
			}
		};
		offerNode(this.selectedNodeId);
		for (const nodeId of this.route?.nodeIds ?? []) {
			offerNode(nodeId);
		}
		if (
			visibleNodeIndices.size === 0 &&
			this.selectedTagId === undefined
		) {
			return;
		}

		const positions: number[] = [];
		const orbitRadius = tagOrbitRadiusForAppearance(this.appearance);
		for (const tag of snapshot.tags) {
			const direction = this.directions.get(tag.id);
			if (direction === undefined) {
				continue;
			}
			for (const nodeIndex of tag.nodeIndices) {
				if (
					tag.id !== this.selectedTagId &&
					!visibleNodeIndices.has(nodeIndex)
				) {
					continue;
				}
				const offset = nodeIndex * 3;
				const x = snapshot.positions[offset];
				const y = snapshot.positions[offset + 1];
				const z = snapshot.positions[offset + 2];
				const node = snapshot.nodeByIndex.get(nodeIndex);
				if (
					x === undefined ||
					y === undefined ||
					z === undefined ||
					node === undefined
				) {
					continue;
				}
				const points = sampleTagSpiral(
					[x, y, z],
					direction,
					TAG_SPIRAL_SEGMENTS,
					node.id,
					tag.id,
					orbitRadius,
				);
				for (let index = 0; index < points.length - 1; index += 1) {
					const point = points[index];
					const next = points[index + 1];
					if (point !== undefined && next !== undefined) {
						positions.push(...point, ...next);
					}
				}
				this.linkedTagIds.add(tag.id);
			}
		}
		if (positions.length === 0) {
			return;
		}
		const geometry = new BufferGeometry();
		geometry.setAttribute(
			'position',
			new BufferAttribute(new Float32Array(positions), 3),
		);
		geometry.computeBoundingSphere();
		const material = createTagLinkMaterial(
			this.linkColor,
			orbitRadius,
			this.appearance.tagViewProtectionEnabled,
		);
		const lines = new LineSegments(geometry, material);
		lines.name = 'spherical-graph-tag-links';
		lines.renderOrder = 5;
		lines.visible = this.visible;
		this.linkMaterial = material;
		this.linkLines = lines;
		this.group.add(lines);
	}

	private resizeLabelPool(): void {
		const root = this.labelRoot;
		if (root === undefined) {
			return;
		}
		const desired = Math.min(
			MAX_VISIBLE_TAG_LABELS,
			this.snapshot?.tags.length ?? 0,
		);
		while (this.labelPool.length < desired) {
			const element = root.createDiv();
			element.className = 'spherical-graph-tag-label';
			element.hidden = true;
			root.append(element);
			this.labelPool.push(element);
		}
		while (this.labelPool.length > desired) {
			this.labelPool.pop()?.remove();
		}
	}

	private hideLabels(): void {
		for (const element of this.labelPool) {
			element.hidden = true;
		}
	}

	private updateMaterialSettings(): void {
		const protection = Number(
			this.appearance.tagViewProtectionEnabled,
		);
		const markerProtection =
			this.markerMaterial?.uniforms.tagViewProtectionEnabled;
		if (markerProtection !== undefined) {
			markerProtection.value = protection;
		}
		const linkProtection =
			this.linkMaterial?.uniforms.tagViewProtectionEnabled;
		if (linkProtection !== undefined) {
			linkProtection.value = protection;
		}
		const linkOrbitRadius =
			this.linkMaterial?.uniforms.tagOrbitRadius;
		if (linkOrbitRadius !== undefined) {
			linkOrbitRadius.value = tagOrbitRadiusForAppearance(
				this.appearance,
			);
		}
	}

	private applySilverTheme(theme: RenderTheme): void {
		const background = new Color(theme.background);
		const luminance =
			background.r * 0.2126 +
			background.g * 0.7152 +
			background.b * 0.0722;
		this.markerColor.set(
			luminance > 0.52
				? LIGHT_SCENE_SATELLITE_SILVER
				: DARK_SCENE_SATELLITE_SILVER,
		);
		this.linkColor.set(
			luminance > 0.52
				? LIGHT_SCENE_LINK_SILVER
				: DARK_SCENE_LINK_SILVER,
		);
	}

	private removeMarkers(): void {
		const mesh = this.markerMesh;
		if (mesh === undefined) {
			return;
		}
		this.group.remove(mesh);
		mesh.geometry.dispose();
		this.markerMaterial?.dispose();
		this.markerMesh = undefined;
		this.markerMaterial = undefined;
	}

	private removeLinks(): void {
		const lines = this.linkLines;
		if (lines === undefined) {
			return;
		}
		this.group.remove(lines);
		lines.geometry.dispose();
		this.linkMaterial?.dispose();
		this.linkLines = undefined;
		this.linkMaterial = undefined;
	}
}

export function tagMarkerScaleForGlobe(globeSize: number): number {
	const safeGlobeSize =
		Number.isFinite(globeSize) && globeSize > 0
			? globeSize
			: DEFAULT_GLOBE_SIZE;
	return (
		(BASE_TAG_MARKER_SIZE *
			TAG_MARKER_SCALE_FACTOR *
			DEFAULT_GLOBE_SIZE) /
		safeGlobeSize
	);
}

/**
 * Perspective cue shared by DOM labels and the WebGL shaders. Satellites
 * nearest the viewer remain crisp while those close to, or just beyond, the
 * globe's limb recede without changing the existing globe-occlusion rule.
 */
export function tagPerspectiveVisibility(
	frontAlignment: number,
): number {
	if (!Number.isFinite(frontAlignment)) {
		return TAG_DEPTH_MINIMUM_VISIBILITY;
	}
	const amount = Math.min(
		1,
		Math.max(
			0,
			(frontAlignment - TAG_DEPTH_FADE_START) /
				(TAG_DEPTH_FADE_END - TAG_DEPTH_FADE_START),
		),
	);
	const smoothAmount = amount * amount * (3 - 2 * amount);
	return (
		TAG_DEPTH_MINIMUM_VISIBILITY +
		(1 - TAG_DEPTH_MINIMUM_VISIBILITY) * smoothAmount
	);
}

export function tagOrbitRadiusForAppearance(
	appearance: Pick<AppearanceSettings, 'tagOrbitHeightPercent'>,
): number {
	const heightPercent =
		Number.isFinite(appearance.tagOrbitHeightPercent) &&
		appearance.tagOrbitHeightPercent > 0
			? appearance.tagOrbitHeightPercent
			: DEFAULT_TAG_ORBIT_HEIGHT_PERCENT;
	return SPHERE_RADIUS * (1 + heightPercent / 100);
}

function createTagMaterial(
	color: Color,
	viewProtectionEnabled: boolean,
): ShaderMaterial {
	return new ShaderMaterial({
		depthTest: true,
		depthWrite: false,
		toneMapped: false,
		transparent: true,
		uniforms: {
			tagColor: { value: color },
			tagViewProtectionEnabled: {
				value: Number(viewProtectionEnabled),
			},
		},
		vertexShader: `
			uniform float tagViewProtectionEnabled;
			varying float vTagVisibility;
			varying float vPerspectiveVisibility;
			varying vec3 vViewNormal;
			varying vec3 vViewDirection;

			bool tagOccludedByGlobe(vec3 tagCenter) {
				vec3 ray = tagCenter - cameraPosition;
				float rayLengthSquared = dot(ray, ray);
				float twiceProjection = 2.0 * dot(cameraPosition, ray);
				float cameraDistanceSquared =
					dot(cameraPosition, cameraPosition);
				float discriminant =
					twiceProjection * twiceProjection -
					4.0 * rayLengthSquared *
						(cameraDistanceSquared -
							${SPHERE_RADIUS.toFixed(1)} *
							${SPHERE_RADIUS.toFixed(1)});
				if (discriminant <= 0.0 || rayLengthSquared <= 0.000001) {
					return false;
				}
				float nearIntersection =
					(-twiceProjection - sqrt(discriminant)) /
					(2.0 * rayLengthSquared);
				return nearIntersection > 0.000001 &&
					nearIntersection < 0.999999;
			}

			void main() {
				vec4 tagCenter = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
				float viewAlignment = abs(
					dot(normalize(tagCenter.xyz), normalize(cameraPosition))
				);
				float protectedVisibility =
					1.0 - smoothstep(0.66, 0.82, viewAlignment);
				float axisVisibility = mix(
					1.0,
					protectedVisibility,
					tagViewProtectionEnabled
				);
				vTagVisibility = tagOccludedByGlobe(tagCenter.xyz)
					? 0.0
					: axisVisibility;
				float frontAlignment = dot(
					normalize(tagCenter.xyz),
					normalize(cameraPosition)
				);
				vPerspectiveVisibility = mix(
					${TAG_DEPTH_MINIMUM_VISIBILITY.toFixed(2)},
					1.0,
					smoothstep(
						${TAG_DEPTH_FADE_START.toFixed(2)},
						${TAG_DEPTH_FADE_END.toFixed(2)},
						frontAlignment
					)
				);
				vec4 worldPosition = modelMatrix * instanceMatrix * vec4(position, 1.0);
				vec4 viewPosition = viewMatrix * worldPosition;
				vViewNormal = normalize(
					normalMatrix * mat3(instanceMatrix) * normal
				);
				vViewDirection = -viewPosition.xyz;
				gl_Position = projectionMatrix * viewPosition;
			}
		`,
		fragmentShader: `
			uniform vec3 tagColor;
			varying float vTagVisibility;
			varying float vPerspectiveVisibility;
			varying vec3 vViewNormal;
			varying vec3 vViewDirection;

			void main() {
				if (vTagVisibility < 0.025) {
					discard;
				}
				vec3 normalDirection = normalize(vViewNormal);
				vec3 viewDirection = normalize(vViewDirection);
				vec3 lightDirection = normalize(vec3(-0.34, 0.58, 0.74));
				vec3 halfDirection = normalize(lightDirection + viewDirection);
				float diffuse = max(dot(normalDirection, lightDirection), 0.0);
				float facing = max(dot(normalDirection, viewDirection), 0.0);
				float specular = pow(
					max(dot(normalDirection, halfDirection), 0.0),
					24.0
				);
				float fresnel = pow(max(0.0, 1.0 - facing), 2.4);
				vec3 polishedSilver =
					tagColor * (0.44 + diffuse * 0.48) +
					vec3(0.86, 0.92, 0.96) * specular * 0.84 +
					vec3(0.10, 0.14, 0.17) * fresnel;
				gl_FragColor = vec4(
					polishedSilver * vPerspectiveVisibility,
					vTagVisibility *
						vPerspectiveVisibility *
						(0.72 + facing * 0.20)
				);
				#include <colorspace_fragment>
			}
		`,
	});
}

function createTagLinkMaterial(
	color: Color,
	orbitRadius: number,
	viewProtectionEnabled: boolean,
): ShaderMaterial {
	return new ShaderMaterial({
		depthTest: true,
		depthWrite: false,
		toneMapped: false,
		transparent: true,
		uniforms: {
			tagEdgeColor: { value: color },
			tagOrbitRadius: { value: orbitRadius },
			tagViewProtectionEnabled: {
				value: Number(viewProtectionEnabled),
			},
		},
		vertexShader: `
			uniform float tagOrbitRadius;
			uniform float tagViewProtectionEnabled;
			varying float vLinkVisibility;
			varying float vPerspectiveVisibility;

			bool tagLinkOccludedByGlobe(vec3 linkPoint) {
				vec3 ray = linkPoint - cameraPosition;
				float rayLengthSquared = dot(ray, ray);
				float twiceProjection = 2.0 * dot(cameraPosition, ray);
				float cameraDistanceSquared =
					dot(cameraPosition, cameraPosition);
				float discriminant =
					twiceProjection * twiceProjection -
					4.0 * rayLengthSquared *
						(cameraDistanceSquared -
							${SPHERE_RADIUS.toFixed(1)} *
							${SPHERE_RADIUS.toFixed(1)});
				if (discriminant <= 0.0 || rayLengthSquared <= 0.000001) {
					return false;
				}
				float nearIntersection =
					(-twiceProjection - sqrt(discriminant)) /
					(2.0 * rayLengthSquared);
				return nearIntersection > 0.000001 &&
					nearIntersection < 0.999999;
			}

			void main() {
				vec4 worldPosition = modelMatrix * vec4(position, 1.0);
				float viewAlignment = abs(
					dot(normalize(worldPosition.xyz), normalize(cameraPosition))
				);
				float orbitVisibility =
					1.0 - smoothstep(0.66, 0.82, viewAlignment);
				float orbitAmount = smoothstep(
					${TAG_LINK_START_RADIUS.toFixed(3)},
					tagOrbitRadius,
					length(worldPosition.xyz)
				);
				float protectedLinkVisibility = mix(
					1.0,
					mix(1.0, orbitVisibility, tagViewProtectionEnabled),
					orbitAmount
				);
				vLinkVisibility = tagLinkOccludedByGlobe(
					worldPosition.xyz
				)
					? 0.0
					: protectedLinkVisibility;
				float frontAlignment = dot(
					normalize(worldPosition.xyz),
					normalize(cameraPosition)
				);
				vPerspectiveVisibility = mix(
					${TAG_DEPTH_MINIMUM_VISIBILITY.toFixed(2)},
					1.0,
					smoothstep(
						${TAG_DEPTH_FADE_START.toFixed(2)},
						${TAG_DEPTH_FADE_END.toFixed(2)},
						frontAlignment
					)
				);
				gl_Position = projectionMatrix * viewMatrix * worldPosition;
			}
		`,
		fragmentShader: `
			uniform vec3 tagEdgeColor;
			varying float vLinkVisibility;
			varying float vPerspectiveVisibility;

			void main() {
				if (vLinkVisibility < 0.025) {
					discard;
				}
				float highlight = pow(vPerspectiveVisibility, 3.0);
				vec3 polishedSilver =
					tagEdgeColor * (0.72 + highlight * 0.28) +
					vec3(0.88, 0.93, 0.96) * highlight * 0.08;
				gl_FragColor = vec4(
					polishedSilver * vPerspectiveVisibility,
					vLinkVisibility * vPerspectiveVisibility * 0.54
				);
				#include <colorspace_fragment>
			}
		`,
	});
}
