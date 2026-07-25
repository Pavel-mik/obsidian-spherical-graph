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
import {
	deterministicTagDirection,
	isPointOccludedByGlobe,
	sampleTagSpiral,
} from './tagGeometry';

const TAG_SPIRAL_SEGMENTS = 30;
const MAX_VISIBLE_TAG_LABELS = 96;
export const TAG_CAMERA_CLEARANCE_DOT = 0.82;

export class TagLayer {
	private markerMesh: InstancedMesh | undefined;
	private markerMaterial: ShaderMaterial | undefined;
	private linkLines: LineSegments | undefined;
	private linkMaterial: ShaderMaterial | undefined;
	private snapshot: PreparedRenderSnapshot | undefined;
	private appearance: AppearanceSettings;
	private theme: RenderTheme;
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
		this.theme = theme;
		this.markerColor.set(theme.tag);
		this.linkColor.set(theme.tagEdge);
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
		for (const tag of snapshot.tags) {
			this.directions.set(
				tag.id,
				deterministicTagDirection(tag.id),
			);
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
		this.theme = theme;
		this.markerColor.set(theme.tag);
		this.linkColor.set(theme.tagEdge);
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
		if (
			!this.visible ||
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
			element.style.transform = `translate(${screenX.toFixed(1)}px, ${screenY.toFixed(1)}px) translate(-50%, -50%)`;
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
		(BASE_TAG_MARKER_SIZE * DEFAULT_GLOBE_SIZE) / safeGlobeSize
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
				vec4 worldPosition = modelMatrix * instanceMatrix * vec4(position, 1.0);
				gl_Position = projectionMatrix * viewMatrix * worldPosition;
			}
		`,
		fragmentShader: `
			uniform vec3 tagColor;
			varying float vTagVisibility;

			void main() {
				if (vTagVisibility < 0.025) {
					discard;
				}
				float glow = 0.74 + vTagVisibility * 0.26;
				gl_FragColor = vec4(
					tagColor * glow,
					vTagVisibility * 0.92
				);
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
				vLinkVisibility = mix(
					1.0,
					mix(1.0, orbitVisibility, tagViewProtectionEnabled),
					orbitAmount
				);
				gl_Position = projectionMatrix * viewMatrix * worldPosition;
			}
		`,
		fragmentShader: `
			uniform vec3 tagEdgeColor;
			varying float vLinkVisibility;

			void main() {
				if (vLinkVisibility < 0.025) {
					discard;
				}
				gl_FragColor = vec4(
					tagEdgeColor,
					vLinkVisibility * 0.66
				);
			}
		`,
	});
}
