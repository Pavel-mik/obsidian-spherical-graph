import {
	AdditiveBlending,
	BufferAttribute,
	BufferGeometry,
	CircleGeometry,
	Color,
	DoubleSide,
	DynamicDrawUsage,
	Group,
	InstancedMesh,
	LineBasicMaterial,
	LineSegments,
	Matrix4,
	MeshBasicMaterial,
	Quaternion,
	RingGeometry,
	ShaderMaterial,
	Vector3,
} from 'three';
import {
	BASE_NODE_MARKER_SIZE,
	DEFAULT_GLOBE_SIZE,
	NODE_SURFACE_LIFT,
	SPHERE_RADIUS,
} from '../constants';
import { AppearanceSettings } from '../settings/settings';
import {
	DEFAULT_RENDER_FILTERS,
	isRenderNodeVisible,
	renderNodeKind,
	type RenderFilterState,
} from './renderFilters';
import {
	PreparedRenderSnapshot,
	RenderNode,
	RenderRouteState,
	RenderSelectionState,
	RenderTheme,
} from './renderTypes';

const NODE_DISC_SEGMENTS = 40;
const NODE_NORMAL = new Vector3(0, 0, 1);

export class NodeLayer {
	private meshValue: InstancedMesh | undefined;
	private glowMesh: InstancedMesh | undefined;
	private highlightMesh: InstancedMesh | undefined;
	private reticle: LineSegments | undefined;
	private reticleMaterial: LineBasicMaterial | undefined;
	private snapshot: PreparedRenderSnapshot | undefined;
	private nodesByInstance: readonly RenderNode[] = [];
	private appearance: AppearanceSettings;
	private theme: RenderTheme;
	private selection: RenderSelectionState = {};
	private route: RenderRouteState | undefined;
	private routeNodeIds = new Set<string>();
	private filters: RenderFilterState = DEFAULT_RENDER_FILTERS;
	private readonly matrix = new Matrix4();
	private readonly position = new Vector3();
	private readonly scale = new Vector3(1, 1, 1);
	private readonly rotation = new Quaternion();
	private readonly color = new Color();
	private readonly radial = new Vector3();

	constructor(
		private readonly group: Group,
		appearance: AppearanceSettings,
		theme: RenderTheme,
	) {
		this.appearance = appearance;
		this.theme = theme;
	}

	get mesh(): InstancedMesh | undefined {
		return this.meshValue;
	}

	setSnapshot(snapshot: PreparedRenderSnapshot): void {
		this.removeMesh();
		this.snapshot = snapshot;
		this.nodesByInstance = [...snapshot.nodes].sort(
			(left, right) => left.index - right.index,
		);

		const geometry = new CircleGeometry(1, NODE_DISC_SEGMENTS);
		const mesh = new InstancedMesh(
			geometry,
			createNodeMaterial(false),
			Math.max(1, this.nodesByInstance.length),
		);
		mesh.name = 'spherical-graph-nodes';
		mesh.count = this.nodesByInstance.length;
		mesh.instanceMatrix.setUsage(DynamicDrawUsage);
		this.meshValue = mesh;
		this.group.add(mesh);

		const glowMesh = new InstancedMesh(
			new CircleGeometry(1, NODE_DISC_SEGMENTS),
			createNodeMaterial(true),
			Math.max(1, this.nodesByInstance.length),
		);
		glowMesh.name = 'spherical-graph-node-glow';
		glowMesh.count = this.nodesByInstance.length;
		glowMesh.instanceMatrix.setUsage(DynamicDrawUsage);
		glowMesh.renderOrder = 2;
		this.glowMesh = glowMesh;
		this.group.add(glowMesh);

		const highlightMesh = new InstancedMesh(
			new RingGeometry(0.82, 1, NODE_DISC_SEGMENTS),
			new MeshBasicMaterial({
				blending: AdditiveBlending,
				transparent: true,
				opacity: 0.92,
				depthTest: true,
				depthWrite: false,
				side: DoubleSide,
				toneMapped: false,
			}),
			Math.max(1, this.nodesByInstance.length + 4),
		);
		highlightMesh.name = 'spherical-graph-node-highlights';
		highlightMesh.count = 0;
		highlightMesh.renderOrder = 3;
		this.highlightMesh = highlightMesh;
		this.group.add(highlightMesh);

		const reticleMaterial = new LineBasicMaterial({
			blending: AdditiveBlending,
			color: this.theme.nodeSelected,
			depthTest: true,
			depthWrite: false,
			opacity: 0.98,
			toneMapped: false,
			transparent: true,
		});
		const reticle = new LineSegments(
			createReticleGeometry(),
			reticleMaterial,
		);
		reticle.name = 'spherical-graph-node-reticle';
		reticle.renderOrder = 4;
		reticle.visible = false;
		this.reticle = reticle;
		this.reticleMaterial = reticleMaterial;
		this.group.add(reticle);
		this.updateInstances();
	}

	updateAppearance(appearance: AppearanceSettings): void {
		this.appearance = appearance;
		this.updateInstances();
	}

	updateFilters(filters: RenderFilterState): void {
		this.filters = { ...filters };
		this.updateInstances();
	}

	updateTheme(theme: RenderTheme): void {
		this.theme = theme;
		this.updateInstances();
	}

	updateSelection(selection: RenderSelectionState): void {
		this.selection = { ...selection };
		this.updateInstances();
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
		this.routeNodeIds = new Set(route?.nodeIds ?? []);
		this.updateInstances();
	}

	nodeForInstance(instanceId: number): RenderNode | undefined {
		const node = this.nodesByInstance[instanceId];
		return node !== undefined && isRenderNodeVisible(node, this.filters)
			? node
			: undefined;
	}

	positionForNode(nodeId: string, target: Vector3): Vector3 | undefined {
		const snapshot = this.snapshot;
		const node = snapshot?.nodeById.get(nodeId);
		if (snapshot === undefined || node === undefined) {
			return undefined;
		}
		if (!isRenderNodeVisible(node, this.filters)) {
			return undefined;
		}
		const offset = node.index * 3;
		const x = snapshot.positions[offset];
		const y = snapshot.positions[offset + 1];
		const z = snapshot.positions[offset + 2];
		if (x === undefined || y === undefined || z === undefined) {
			return undefined;
		}
		return target
			.set(x, y, z)
			.multiplyScalar(SPHERE_RADIUS + NODE_SURFACE_LIFT);
	}

	dispose(): void {
		this.removeMesh();
		this.snapshot = undefined;
		this.nodesByInstance = [];
		this.route = undefined;
		this.routeNodeIds.clear();
	}

	private updateInstances(): void {
		const mesh = this.meshValue;
		const glowMesh = this.glowMesh;
		const snapshot = this.snapshot;
		if (
			mesh === undefined ||
			glowMesh === undefined ||
			snapshot === undefined
		) {
			return;
		}

		const selectedNode = this.selection.selectedNodeId
			? snapshot.nodeById.get(this.selection.selectedNodeId)
			: undefined;
		const selectedNeighbors =
			selectedNode === undefined
				? undefined
				: snapshot.neighborsByIndex.get(selectedNode.index);

		for (
			let instanceId = 0;
			instanceId < this.nodesByInstance.length;
			instanceId += 1
		) {
			const node = this.nodesByInstance[instanceId];
			if (node === undefined) {
				continue;
			}
			const offset = node.index * 3;
			const x = snapshot.positions[offset];
			const y = snapshot.positions[offset + 1];
			const z = snapshot.positions[offset + 2];
			if (x === undefined || y === undefined || z === undefined) {
				continue;
			}
			if (!isRenderNodeVisible(node, this.filters)) {
				this.matrix.makeScale(0, 0, 0);
				mesh.setMatrixAt(instanceId, this.matrix);
				glowMesh.setMatrixAt(instanceId, this.matrix);
				continue;
			}
			this.radial.set(x, y, z).normalize();
			this.position
				.copy(this.radial)
				.multiplyScalar(SPHERE_RADIUS + NODE_SURFACE_LIFT);
			this.rotation.setFromUnitVectors(NODE_NORMAL, this.radial);

			const isSelected = node.id === this.selection.selectedNodeId;
			const isHovered = node.id === this.selection.hoveredNodeId;
			const isActive = node.id === this.selection.activeNodeId;
			const isRoute = this.routeNodeIds.has(node.id);
			const isRouteStart = node.id === this.route?.startNodeId;
			const isRouteEnd = node.id === this.route?.endNodeId;
			const isNeighbor = selectedNeighbors?.has(node.index) ?? false;
			let scale = this.baseScaleForNode(node);
			if (isSelected) {
				scale *= 1.62;
			} else if (isHovered) {
				scale *= 1.45;
			} else if (isRoute) {
				scale *= 1.28;
			} else if (isActive) {
				scale *= 1.25;
			} else if (isNeighbor) {
				scale *= 1.12;
			}

			this.scale.setScalar(scale);
			this.matrix.compose(this.position, this.rotation, this.scale);
			mesh.setMatrixAt(instanceId, this.matrix);

			const baseColor =
				renderNodeKind(node) === 'attachment'
					? this.theme.nodeAttachment
					: renderNodeKind(node) === 'unresolved'
						? this.theme.nodeUnresolved
						: this.theme.node;
			const color = isSelected
				? this.theme.nodeSelected
				: isHovered
					? this.theme.nodeHovered
					: isRouteStart
						? this.theme.nodeRouteStart
						: isRouteEnd
							? this.theme.nodeRouteEnd
					: isRoute
						? this.theme.nodeRoute
						: isActive
							? this.theme.nodeActive
							: isNeighbor
								? this.theme.nodeNeighbor
								: baseColor;
			mesh.setColorAt(instanceId, this.color.set(color));

			this.scale.setScalar(
				scale * (isSelected || isHovered || isRoute ? 1.75 : 1.95),
			);
			this.matrix.compose(this.position, this.rotation, this.scale);
			glowMesh.setMatrixAt(instanceId, this.matrix);
			glowMesh.setColorAt(instanceId, this.color.set(color));
		}

		updateInstancedMesh(mesh);
		updateInstancedMesh(glowMesh);
		this.updateHighlights(snapshot);
	}

	private updateHighlights(snapshot: PreparedRenderSnapshot): void {
		const mesh = this.highlightMesh;
		if (mesh === undefined) {
			return;
		}
		let instanceId = 0;
		const addRing = (
			nodeId: string | undefined,
			scaleMultiplier: number,
			color: string,
		): void => {
			if (nodeId === undefined || instanceId >= mesh.instanceMatrix.count) {
				return;
			}
			const node = snapshot.nodeById.get(nodeId);
			if (
				node === undefined ||
				!isRenderNodeVisible(node, this.filters)
			) {
				return;
			}
			const offset = node.index * 3;
			const x = snapshot.positions[offset];
			const y = snapshot.positions[offset + 1];
			const z = snapshot.positions[offset + 2];
			if (x === undefined || y === undefined || z === undefined) {
				return;
			}
			this.radial.set(x, y, z).normalize();
			const baseScale = this.baseScaleForNode(node);
			this.position
				.copy(this.radial)
				.multiplyScalar(
					SPHERE_RADIUS +
						NODE_SURFACE_LIFT +
						baseScale * 0.12,
				);
			this.rotation.setFromUnitVectors(NODE_NORMAL, this.radial);
			this.scale.setScalar(baseScale * scaleMultiplier);
			this.matrix.compose(this.position, this.rotation, this.scale);
			mesh.setMatrixAt(instanceId, this.matrix);
			mesh.setColorAt(instanceId, this.color.set(color));
			instanceId += 1;
		};

		for (const nodeId of this.route?.nodeIds ?? []) {
			if (nodeId === this.route?.startNodeId) {
				addRing(nodeId, 2.2, this.theme.nodeRouteStart);
				addRing(nodeId, 2.75, this.theme.nodeRouteStart);
			} else if (nodeId === this.route?.endNodeId) {
				addRing(nodeId, 2.2, this.theme.nodeRouteEnd);
				addRing(nodeId, 2.75, this.theme.nodeRouteEnd);
			} else {
				addRing(nodeId, 1.9, this.theme.nodeRoute);
			}
		}
		if (
			this.selection.activeNodeId !== this.selection.selectedNodeId &&
			!this.routeNodeIds.has(this.selection.activeNodeId ?? '')
		) {
			addRing(
				this.selection.activeNodeId,
				2.2,
				this.theme.nodeActive,
			);
		}
		mesh.count = instanceId;
		updateInstancedMesh(mesh);
		this.updateReticle(snapshot);
	}

	private updateReticle(snapshot: PreparedRenderSnapshot): void {
		const reticle = this.reticle;
		const material = this.reticleMaterial;
		const selectedNodeId = this.selection.selectedNodeId;
		if (
			reticle === undefined ||
			material === undefined ||
			selectedNodeId === undefined
		) {
			if (reticle !== undefined) {
				reticle.visible = false;
			}
			return;
		}
		const node = snapshot.nodeById.get(selectedNodeId);
		if (
			node === undefined ||
			!isRenderNodeVisible(node, this.filters)
		) {
			reticle.visible = false;
			return;
		}
		const offset = node.index * 3;
		const x = snapshot.positions[offset];
		const y = snapshot.positions[offset + 1];
		const z = snapshot.positions[offset + 2];
		if (x === undefined || y === undefined || z === undefined) {
			reticle.visible = false;
			return;
		}

		const selectedScale = this.baseScaleForNode(node) * 1.62;
		this.radial.set(x, y, z).normalize();
		reticle.position
			.copy(this.radial)
			.multiplyScalar(
				SPHERE_RADIUS +
					NODE_SURFACE_LIFT +
					selectedScale * 0.16,
			);
		reticle.quaternion.setFromUnitVectors(NODE_NORMAL, this.radial);
		reticle.scale.setScalar(selectedScale * 1.6);
		material.color.set(this.theme.nodeSelected);
		reticle.visible = true;
	}

	private baseScaleForNode(node: RenderNode): number {
		let scale = nodeMarkerScaleForGlobe(this.appearance.globeSize);
		if (this.appearance.sizeNodesByDegree) {
			scale *= 1 + Math.min(1.25, Math.log2(node.degree + 1) * 0.22);
		}
		return scale;
	}

	private removeMesh(): void {
		disposeInstancedMesh(this.group, this.meshValue);
		disposeInstancedMesh(this.group, this.glowMesh);
		disposeInstancedMesh(this.group, this.highlightMesh);
		this.meshValue = undefined;
		this.glowMesh = undefined;
		this.highlightMesh = undefined;
		if (this.reticle !== undefined) {
			this.group.remove(this.reticle);
			this.reticle.geometry.dispose();
			this.reticleMaterial?.dispose();
			this.reticle = undefined;
			this.reticleMaterial = undefined;
		}
	}
}

export function nodeMarkerScaleForGlobe(globeSize: number): number {
	const safeGlobeSize =
		Number.isFinite(globeSize) && globeSize > 0
			? globeSize
			: DEFAULT_GLOBE_SIZE;
	return (
		(BASE_NODE_MARKER_SIZE * DEFAULT_GLOBE_SIZE) / safeGlobeSize
	);
}

function createNodeMaterial(glow: boolean): ShaderMaterial {
	return new ShaderMaterial({
		...(glow ? { blending: AdditiveBlending } : {}),
		depthTest: true,
		depthWrite: !glow,
		side: DoubleSide,
		toneMapped: false,
		transparent: glow,
		vertexShader: `
			varying vec3 vInstanceColor;
			varying float vFacing;
			varying vec2 vNodeUv;

			void main() {
				vec4 instancePosition = instanceMatrix * vec4(position, 1.0);
				vec4 worldPosition = modelMatrix * instancePosition;
				vec3 instanceNormal = normalize(mat3(instanceMatrix) * normal);
				vec3 worldNormal = normalize(mat3(modelMatrix) * instanceNormal);
				vec3 viewDirection = normalize(cameraPosition - worldPosition.xyz);
				vFacing = abs(dot(worldNormal, viewDirection));
				vInstanceColor = instanceColor;
				vNodeUv = uv;
				gl_Position = projectionMatrix * viewMatrix * worldPosition;
			}
		`,
		fragmentShader: glow
			? `
				varying vec3 vInstanceColor;
				varying float vFacing;
				varying vec2 vNodeUv;

				void main() {
					float distanceFromCenter = length(vNodeUv - vec2(0.5)) * 2.0;
					float radialFade = 1.0 - smoothstep(0.12, 1.0, distanceFromCenter);
					float limbFade = mix(
						0.08,
						1.0,
						smoothstep(0.04, 0.78, vFacing)
					);
					gl_FragColor = vec4(
						vInstanceColor,
						radialFade * limbFade * 0.16
					);
				}
			`
			: `
				varying vec3 vInstanceColor;
				varying float vFacing;

				void main() {
					float limbContrast = mix(
						0.28,
						1.0,
						smoothstep(0.06, 0.82, vFacing)
					);
					gl_FragColor = vec4(
						vInstanceColor * limbContrast,
						1.0
					);
				}
			`,
	});
}

function updateInstancedMesh(mesh: InstancedMesh): void {
	mesh.instanceMatrix.needsUpdate = true;
	if (mesh.instanceColor !== null) {
		mesh.instanceColor.needsUpdate = true;
	}
	mesh.computeBoundingSphere();
}

function disposeInstancedMesh(
	group: Group,
	mesh: InstancedMesh | undefined,
): void {
	if (mesh === undefined) {
		return;
	}
	group.remove(mesh);
	mesh.geometry.dispose();
	const material = mesh.material;
	if (Array.isArray(material)) {
		for (const item of material) {
			item.dispose();
		}
	} else {
		material.dispose();
	}
}

function createReticleGeometry(): BufferGeometry {
	const half = 1;
	const corner = 0.42;
	const positions = new Float32Array([
		-half,
		-half,
		0,
		-half + corner,
		-half,
		0,
		-half,
		-half,
		0,
		-half,
		-half + corner,
		0,
		half,
		-half,
		0,
		half - corner,
		-half,
		0,
		half,
		-half,
		0,
		half,
		-half + corner,
		0,
		-half,
		half,
		0,
		-half + corner,
		half,
		0,
		-half,
		half,
		0,
		-half,
		half - corner,
		0,
		half,
		half,
		0,
		half - corner,
		half,
		0,
		half,
		half,
		0,
		half,
		half - corner,
		0,
	]);
	const geometry = new BufferGeometry();
	geometry.setAttribute('position', new BufferAttribute(positions, 3));
	geometry.computeBoundingSphere();
	return geometry;
}
