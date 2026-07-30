import {
	CylinderGeometry,
	DynamicDrawUsage,
	Group,
	InstancedMesh,
	Matrix4,
	MeshBasicMaterial,
	Quaternion,
	SphereGeometry,
	Vector3,
} from 'three';
import {
	DEFAULT_GLOBE_SIZE,
	NODE_SURFACE_LIFT,
	SPHERE_RADIUS,
} from '../constants';
import type { AppearanceSettings } from '../settings/settings';
import {
	DEFAULT_RENDER_FILTERS,
	isRenderNodeVisible,
	renderNodeKind,
	type RenderFilterState,
} from './renderFilters';
import type {
	PreparedRenderSnapshot,
	RenderTheme,
} from './renderTypes';

const PIN_AXIS = new Vector3(0, 1, 0);
const PIN_SHAFT_LENGTH = 0.46;
const PIN_SHAFT_RADIUS = 0.018;
const PIN_HEAD_RADIUS = 0.105;
const PIN_SURFACE_GAP = 0.015;
const MINIMUM_PIN_SCALE = 0.42;
const MAXIMUM_PIN_SCALE = 1.35;

/**
 * Draws persistent favourites as physical map pins instead of recolouring the
 * city marker. Pins remain attached to the immutable intrinsic node position.
 */
export class PinLayer {
	private snapshot: PreparedRenderSnapshot | undefined;
	private pinnedNodeIds = new Set<string>();
	private filters: RenderFilterState = DEFAULT_RENDER_FILTERS;
	private appearance: AppearanceSettings;
	private theme: RenderTheme;
	private shaftMesh: InstancedMesh | undefined;
	private headMesh: InstancedMesh | undefined;
	private readonly radial = new Vector3();
	private readonly position = new Vector3();
	private readonly rotation = new Quaternion();
	private readonly scale = new Vector3();
	private readonly matrix = new Matrix4();

	constructor(
		private readonly group: Group,
		appearance: AppearanceSettings,
		theme: RenderTheme,
	) {
		this.appearance = appearance;
		this.theme = theme;
	}

	setSnapshot(snapshot: PreparedRenderSnapshot): void {
		this.snapshot = snapshot;
		this.rebuildMeshes();
	}

	setPinnedNodeIds(nodeIds: readonly string[]): void {
		this.pinnedNodeIds = new Set(nodeIds);
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
		const shaftMaterial = this.shaftMesh?.material;
		const headMaterial = this.headMesh?.material;
		if (shaftMaterial instanceof MeshBasicMaterial) {
			shaftMaterial.color.set(theme.coast);
		}
		if (headMaterial instanceof MeshBasicMaterial) {
			headMaterial.color.set(theme.nodeSelected);
		}
	}

	dispose(): void {
		this.removeMeshes();
		this.snapshot = undefined;
		this.pinnedNodeIds.clear();
	}

	private rebuildMeshes(): void {
		this.removeMeshes();
		const capacity = Math.max(1, this.snapshot?.nodes.length ?? 0);
		const shaftMesh = new InstancedMesh(
			new CylinderGeometry(
				PIN_SHAFT_RADIUS * 0.72,
				PIN_SHAFT_RADIUS,
				PIN_SHAFT_LENGTH,
				10,
			),
			new MeshBasicMaterial({
				color: this.theme.coast,
				depthTest: true,
				depthWrite: true,
				toneMapped: false,
			}),
			capacity,
		);
		shaftMesh.name = 'spherical-graph-pin-shafts';
		shaftMesh.instanceMatrix.setUsage(DynamicDrawUsage);
		shaftMesh.renderOrder = 5;
		this.shaftMesh = shaftMesh;
		this.group.add(shaftMesh);

		const headMesh = new InstancedMesh(
			new SphereGeometry(PIN_HEAD_RADIUS, 18, 12),
			new MeshBasicMaterial({
				color: this.theme.nodeSelected,
				depthTest: true,
				depthWrite: true,
				toneMapped: false,
			}),
			capacity,
		);
		headMesh.name = 'spherical-graph-pin-heads';
		headMesh.instanceMatrix.setUsage(DynamicDrawUsage);
		headMesh.renderOrder = 6;
		this.headMesh = headMesh;
		this.group.add(headMesh);
		this.updateInstances();
	}

	private updateInstances(): void {
		const snapshot = this.snapshot;
		const shaftMesh = this.shaftMesh;
		const headMesh = this.headMesh;
		if (
			snapshot === undefined ||
			shaftMesh === undefined ||
			headMesh === undefined
		) {
			return;
		}
		const visualScale = Math.max(
			MINIMUM_PIN_SCALE,
			Math.min(
				MAXIMUM_PIN_SCALE,
				DEFAULT_GLOBE_SIZE / this.appearance.globeSize,
			),
		);
		let instanceId = 0;
		const orderedIds = [...this.pinnedNodeIds].sort();
		for (const nodeId of orderedIds) {
			const node = snapshot.nodeById.get(nodeId);
			if (
				node === undefined ||
				renderNodeKind(node) !== 'note' ||
				!isRenderNodeVisible(node, this.filters)
			) {
				continue;
			}
			const offset = node.index * 3;
			const x = snapshot.positions[offset];
			const y = snapshot.positions[offset + 1];
			const z = snapshot.positions[offset + 2];
			if (x === undefined || y === undefined || z === undefined) {
				continue;
			}
			this.radial.set(x, y, z).normalize();
			this.rotation.setFromUnitVectors(PIN_AXIS, this.radial);
			this.scale.setScalar(visualScale);

			this.position
				.copy(this.radial)
				.multiplyScalar(
					SPHERE_RADIUS +
						NODE_SURFACE_LIFT +
						PIN_SURFACE_GAP +
						(PIN_SHAFT_LENGTH * visualScale) / 2,
				);
			this.matrix.compose(this.position, this.rotation, this.scale);
			shaftMesh.setMatrixAt(instanceId, this.matrix);

			this.position
				.copy(this.radial)
				.multiplyScalar(
					SPHERE_RADIUS +
						NODE_SURFACE_LIFT +
						PIN_SURFACE_GAP +
						PIN_SHAFT_LENGTH * visualScale,
				);
			this.matrix.compose(this.position, this.rotation, this.scale);
			headMesh.setMatrixAt(instanceId, this.matrix);
			instanceId += 1;
		}
		shaftMesh.count = instanceId;
		headMesh.count = instanceId;
		shaftMesh.instanceMatrix.needsUpdate = true;
		headMesh.instanceMatrix.needsUpdate = true;
		shaftMesh.computeBoundingSphere();
		headMesh.computeBoundingSphere();
	}

	private removeMeshes(): void {
		disposeInstancedMesh(this.group, this.shaftMesh);
		disposeInstancedMesh(this.group, this.headMesh);
		this.shaftMesh = undefined;
		this.headMesh = undefined;
	}
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
		for (const entry of material) {
			entry.dispose();
		}
	} else {
		material.dispose();
	}
}
