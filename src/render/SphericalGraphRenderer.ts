import {
	Group,
	PerspectiveCamera,
	Quaternion,
	Scene,
	Vector3,
	WebGLRenderer,
} from 'three';
import { ArcballControls } from 'three/examples/jsm/controls/ArcballControls.js';
import {
	DEFAULT_CAMERA_DISTANCE,
	MAX_CAMERA_DISTANCE,
	MIN_CAMERA_DISTANCE,
} from '../constants';
import { AppearanceSettings, SurfaceMode } from '../settings/settings';
import { EdgeLayer } from './EdgeLayer';
import { LabelLayer } from './LabelLayer';
import { NodeLayer } from './NodeLayer';
import { PickingController } from './PickingController';
import {
	CameraState,
	PreparedRenderSnapshot,
	RenderGraphSnapshot,
	RenderRouteState,
	RendererCallbacks,
	RendererOptions,
	RenderSelectionState,
	RenderTheme,
	prepareRenderSnapshot,
} from './renderTypes';
import { SphereLayer } from './SphereLayer';
import { TagLayer } from './TagLayer';
import {
	DEFAULT_RENDER_FILTERS,
	renderNodeKind,
	type RenderFilterState,
} from './renderFilters';
import { verticalFovForAspect } from './cameraFraming';
import { automaticRotationAngle } from './autoRotation';

interface FocusAnimation {
	startedAt: number;
	durationMs: number;
	startPosition: Vector3;
	startUp: Vector3;
	rotation: Quaternion;
}

interface WindowWithObservers extends Window {
	ResizeObserver?: typeof ResizeObserver;
	MutationObserver?: typeof MutationObserver;
}

const CAMERA_TARGET = new Vector3(0, 0, 0);
const IDENTITY_QUATERNION = new Quaternion();
const AUTO_ROTATION_AXIS = new Vector3(0, 1, 0);

export class SphericalGraphRenderer {
	private readonly ownerDocument: Document;
	private readonly ownerWindow: Window;
	private readonly canvas: HTMLCanvasElement;
	private readonly scene = new Scene();
	private readonly camera = new PerspectiveCamera(45, 1, 1, 100);
	private readonly graphGroup = new Group();
	private readonly webglRenderer: WebGLRenderer;
	private readonly controls: ArcballControls;
	private readonly nodeLayer: NodeLayer;
	private readonly edgeLayer: EdgeLayer;
	private readonly sphereLayer: SphereLayer;
	private readonly labelLayer: LabelLayer;
	private readonly tagLayer: TagLayer;
	private readonly pickingController: PickingController;
	private readonly callbacks: RendererCallbacks;
	private appearance: AppearanceSettings;
	private theme: RenderTheme;
	private snapshot: PreparedRenderSnapshot | undefined;
	private selection: RenderSelectionState = {};
	private selectedTagId: string | undefined;
	private filters: RenderFilterState = DEFAULT_RENDER_FILTERS;
	private resizeObserver: ResizeObserver | undefined;
	private themeObserver: MutationObserver | undefined;
	private animationFrame: number | undefined;
	private focusAnimation: FocusAnimation | undefined;
	private autoRotationEnabled = false;
	private lastAutoRotationTimestamp: number | undefined;
	private width = 0;
	private height = 0;
	private pixelRatio = 0;
	private disposed = false;
	private contextLost = false;

	constructor(
		private readonly container: HTMLElement,
		options: RendererOptions,
	) {
		this.ownerDocument = container.ownerDocument;
		const ownerWindow = this.ownerDocument.defaultView;
		if (ownerWindow === null) {
			throw new Error('The graph view is not attached to a window.');
		}
		this.ownerWindow = ownerWindow;
		this.callbacks = options.callbacks ?? {};
		this.appearance = { ...options.appearance };
		this.theme = this.readTheme();

		this.canvas = this.container.createEl('canvas');
		this.canvas.className = 'spherical-graph-canvas';
		this.canvas.tabIndex = 0;
		this.canvas.setAttribute(
			'aria-label',
			'Interactive spherical graph. Drag to rotate and use the wheel to zoom.',
		);

		this.webglRenderer = new WebGLRenderer({
			canvas: this.canvas,
			antialias: true,
			alpha: true,
			powerPreference: 'high-performance',
		});
		this.webglRenderer.outputColorSpace = 'srgb';
		this.container.append(this.canvas);

		this.scene.add(this.graphGroup);
		this.applyCameraState(options.camera);
		this.controls = new ArcballControls(
			this.camera,
			this.canvas,
			this.scene,
		);
		this.controls.enablePan = false;
		this.controls.enableAnimations = false;
		this.controls.enableFocus = false;
		this.controls.minDistance = MIN_CAMERA_DISTANCE;
		this.controls.maxDistance = MAX_CAMERA_DISTANCE;
		this.controls.setGizmosVisible(false);
		this.controls.addEventListener('change', this.onControlsChange);
		this.controls.addEventListener('start', this.onControlsStart);
		this.controls.addEventListener('end', this.onControlsEnd);

		this.sphereLayer = new SphereLayer(
			this.graphGroup,
			this.appearance,
			this.theme,
		);
		this.edgeLayer = new EdgeLayer(
			this.graphGroup,
			this.appearance,
			this.theme,
		);
		this.nodeLayer = new NodeLayer(
			this.graphGroup,
			this.appearance,
			this.theme,
		);
		this.tagLayer = new TagLayer(
			this.graphGroup,
			this.appearance,
			this.theme,
			this.container,
		);
		this.labelLayer = new LabelLayer(
			this.container,
			this.graphGroup,
			this.appearance,
		);
		this.pickingController = new PickingController(
			this.canvas,
			this.camera,
			this.nodeLayer,
			this.tagLayer,
			{
				onHover: (item) => {
					const node =
						item?.kind === 'node'
							? item.node
							: undefined;
					this.setHoveredNode(node?.id);
					this.callbacks.onHover?.(node);
				},
				onSelect: (item) => {
					if (item?.kind === 'tag') {
						this.setSelectedNode(undefined);
						this.setSelectedTag(item.tag.id);
						this.callbacks.onSelectTag?.(item.tag);
						return;
					}
					const node =
						item?.kind === 'node'
							? item.node
							: undefined;
					this.setSelectedTag(undefined);
					this.setSelectedNode(node?.id);
					this.callbacks.onSelect?.(node);
				},
				onOpen: (node, openInNewLeaf) => {
					if (renderNodeKind(node) === 'unresolved') {
						return;
					}
					this.callbacks.onOpenNode?.(node, openInNewLeaf);
				},
			},
		);

		this.canvas.addEventListener(
			'webglcontextlost',
			this.onContextLost,
		);
		this.canvas.addEventListener(
			'webglcontextrestored',
			this.onContextRestored,
		);
		this.installObservers();
		this.updateTheme();
		this.resize();
	}

	setSnapshot(snapshot: RenderGraphSnapshot): void {
		this.assertUsable();
		const prepared = prepareRenderSnapshot(snapshot);
		this.sphereLayer.setSnapshot(prepared);
		this.nodeLayer.setSnapshot(prepared);
		this.edgeLayer.setSnapshot(prepared);
		this.tagLayer.setSnapshot(prepared);
		this.labelLayer.setSnapshot(prepared);
		this.snapshot = prepared;

		if (
			this.selection.selectedNodeId !== undefined &&
			!prepared.nodeById.has(this.selection.selectedNodeId)
		) {
			this.selection.selectedNodeId = undefined;
		}
		if (
			this.selection.activeNodeId !== undefined &&
			!prepared.nodeById.has(this.selection.activeNodeId)
		) {
			this.selection.activeNodeId = undefined;
		}
		if (
			this.selectedTagId !== undefined &&
			!prepared.tagById.has(this.selectedTagId)
		) {
			this.selectedTagId = undefined;
		}
		this.applySelection();
		this.requestRender();
	}

	updateAppearance(appearance: AppearanceSettings): void {
		this.assertUsable();
		this.appearance = { ...appearance };
		this.nodeLayer.updateAppearance(this.appearance);
		this.edgeLayer.updateAppearance(this.appearance);
		this.tagLayer.updateAppearance(this.appearance);
		this.sphereLayer.update(this.appearance, this.theme);
		this.labelLayer.updateAppearance(this.appearance);
		this.updateClearColor();
		this.requestRender();
	}

	setSurfaceMode(surfaceMode: SurfaceMode): void {
		this.updateAppearance({ ...this.appearance, surfaceMode });
	}

	setActiveNode(nodeId: string | undefined): void {
		if (this.selection.activeNodeId === nodeId) {
			return;
		}
		this.selection.activeNodeId = nodeId;
		this.applySelection();
	}

	setSelectedNode(nodeId: string | undefined): void {
		if (this.selection.selectedNodeId === nodeId) {
			return;
		}
		this.selection.selectedNodeId = nodeId;
		this.applySelection();
		const node =
			nodeId === undefined ? undefined : this.snapshot?.nodeById.get(nodeId);
		this.pickingController.setSelectedNode(node);
	}

	setSelectedTag(tagId: string | undefined): void {
		if (this.selectedTagId === tagId) {
			return;
		}
		this.selectedTagId = tagId;
		this.tagLayer.updateSelectedTag(tagId);
		this.requestRender();
	}

	setTagsVisible(visible: boolean): void {
		this.setFilters({ ...this.filters, showTags: visible });
	}

	setAutoRotation(enabled: boolean): void {
		if (this.autoRotationEnabled === enabled) {
			return;
		}
		this.autoRotationEnabled = enabled;
		this.lastAutoRotationTimestamp = undefined;
		if (!enabled) {
			this.emitCameraChange();
		}
		this.requestRender();
	}

	setFilters(filters: RenderFilterState): void {
		this.filters = { ...filters };
		this.nodeLayer.updateFilters(this.filters);
		this.edgeLayer.updateFilters(this.filters);
		this.labelLayer.updateFilters(this.filters);
		this.tagLayer.setVisible(this.filters.showTags);
		this.requestRender();
	}

	setRoute(route: RenderRouteState | undefined): void {
		this.nodeLayer.updateRoute(route);
		this.edgeLayer.updateRoute(route);
		this.tagLayer.updateRoute(route);
		this.labelLayer.updateRoute(route);
		this.requestRender();
	}

	setHoveredNode(nodeId: string | undefined): void {
		if (this.selection.hoveredNodeId === nodeId) {
			return;
		}
		this.selection.hoveredNodeId = nodeId;
		this.applySelection();
	}

	focusNode(nodeId: string): boolean {
		const targetPosition = this.nodeLayer.positionForNode(
			nodeId,
			new Vector3(),
		);
		return this.focusPosition(targetPosition);
	}

	focusTag(tagId: string): boolean {
		const targetPosition = this.tagLayer.positionForTag(
			tagId,
			new Vector3(),
		);
		return this.focusPosition(targetPosition);
	}

	private focusPosition(targetPosition: Vector3 | undefined): boolean {
		if (targetPosition === undefined) {
			return false;
		}
		const startDirection = this.camera.position.clone().normalize();
		const endDirection = targetPosition.normalize();
		const rotation = new Quaternion().setFromUnitVectors(
			startDirection,
			endDirection,
		);
		const durationMs = this.appearance.focusAnimationDurationMs;
		this.focusAnimation =
			durationMs <= 0
				? undefined
				: {
						startedAt: this.ownerWindow.performance.now(),
						durationMs,
						startPosition: this.camera.position.clone(),
						startUp: this.camera.up.clone(),
						rotation,
					};
		if (this.focusAnimation === undefined) {
			this.camera.position.applyQuaternion(rotation);
			this.camera.up.applyQuaternion(rotation).normalize();
			this.camera.lookAt(CAMERA_TARGET);
			this.syncControlsToCamera();
			this.emitCameraChange();
		} else {
			this.controls.enabled = false;
		}
		this.requestRender();
		return true;
	}

	resetCamera(): void {
		this.cancelFocus();
		this.camera.position.set(0, 0, DEFAULT_CAMERA_DISTANCE);
		this.camera.up.set(0, 1, 0);
		this.camera.lookAt(CAMERA_TARGET);
		this.syncControlsToCamera();
		this.emitCameraChange();
		this.requestRender();
	}

	getCameraState(): CameraState {
		return {
			position: this.camera.position.toArray(),
			up: this.camera.up.toArray(),
			target: [0, 0, 0],
		};
	}

	getPositionBufferCopy(): Float32Array | undefined {
		return this.snapshot === undefined
			? undefined
			: new Float32Array(this.snapshot.positions);
	}

	dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		this.cancelFocus();
		if (this.animationFrame !== undefined) {
			this.ownerWindow.cancelAnimationFrame(this.animationFrame);
			this.animationFrame = undefined;
		}
		this.resizeObserver?.disconnect();
		this.resizeObserver = undefined;
		this.themeObserver?.disconnect();
		this.themeObserver = undefined;
		this.ownerWindow.removeEventListener('resize', this.onWindowResize);
		this.canvas.removeEventListener(
			'webglcontextlost',
			this.onContextLost,
		);
		this.canvas.removeEventListener(
			'webglcontextrestored',
			this.onContextRestored,
		);
		this.controls.removeEventListener('change', this.onControlsChange);
		this.controls.removeEventListener('start', this.onControlsStart);
		this.controls.removeEventListener('end', this.onControlsEnd);
		this.controls.dispose();
		this.pickingController.dispose();
		this.labelLayer.dispose();
		this.tagLayer.dispose();
		this.nodeLayer.dispose();
		this.edgeLayer.dispose();
		this.sphereLayer.dispose();
		this.scene.clear();
		this.webglRenderer.dispose();
		this.webglRenderer.forceContextLoss();
		this.canvas.remove();
		this.snapshot = undefined;
	}

	private readonly onControlsChange = (): void => {
		this.requestRender();
	};

	private readonly onControlsStart = (): void => {
		this.cancelFocus();
		if (this.autoRotationEnabled) {
			this.setAutoRotation(false);
			this.callbacks.onAutoRotationChange?.(false);
		}
	};

	private readonly onControlsEnd = (): void => {
		this.emitCameraChange();
	};

	private readonly onContextLost = (event: Event): void => {
		event.preventDefault();
		this.contextLost = true;
		this.lastAutoRotationTimestamp = undefined;
		if (this.animationFrame !== undefined) {
			this.ownerWindow.cancelAnimationFrame(this.animationFrame);
			this.animationFrame = undefined;
		}
		this.callbacks.onContextError?.(
			'WebGL context was lost. The last saved layout is still safe.',
		);
	};

	private readonly onContextRestored = (): void => {
		this.contextLost = false;
		this.callbacks.onContextRestored?.();
		this.requestRender();
	};

	private readonly onWindowResize = (): void => {
		this.resize();
	};

	private installObservers(): void {
		const observerWindow = this.ownerWindow as WindowWithObservers;
		const ResizeObserverConstructor = observerWindow.ResizeObserver;
		if (ResizeObserverConstructor !== undefined) {
			const observer = new ResizeObserverConstructor(() => {
				this.resize();
			});
			observer.observe(this.container);
			this.resizeObserver = observer;
		} else {
			this.ownerWindow.addEventListener('resize', this.onWindowResize);
		}

		const MutationObserverConstructor = observerWindow.MutationObserver;
		if (
			MutationObserverConstructor !== undefined &&
			this.ownerDocument.body !== null
		) {
			const observer = new MutationObserverConstructor(() => {
				this.updateTheme();
			});
			observer.observe(this.ownerDocument.body, {
				attributes: true,
				attributeFilter: ['class'],
			});
			this.themeObserver = observer;
		}
	}

	private resize(): void {
		if (this.disposed) {
			return;
		}
		const width = Math.max(1, Math.floor(this.container.clientWidth));
		const height = Math.max(1, Math.floor(this.container.clientHeight));
		const pixelRatio = Math.min(
			this.ownerWindow.devicePixelRatio || 1,
			2,
		);
		if (
			width === this.width &&
			height === this.height &&
			pixelRatio === this.pixelRatio
		) {
			return;
		}
		this.width = width;
		this.height = height;
		this.pixelRatio = pixelRatio;
		this.webglRenderer.setPixelRatio(pixelRatio);
		this.webglRenderer.setSize(width, height, false);
		this.camera.aspect = width / height;
		this.camera.fov = verticalFovForAspect(this.camera.aspect);
		this.camera.updateProjectionMatrix();
		this.requestRender();
	}

	private requestRender(): void {
		if (
			this.disposed ||
			this.contextLost ||
			this.animationFrame !== undefined
		) {
			return;
		}
		this.animationFrame = this.ownerWindow.requestAnimationFrame(
			this.renderFrame,
		);
	}

	private readonly renderFrame = (timestamp: number): void => {
		this.animationFrame = undefined;
		if (this.disposed || this.contextLost) {
			return;
		}
		const focusContinues = this.advanceFocusAnimation(timestamp);
		const autoRotationContinues =
			this.advanceAutoRotation(timestamp);
		this.graphGroup.updateMatrixWorld(true);
		this.tagLayer.render(this.camera, this.width, this.height);
		this.labelLayer.render(this.camera, this.width, this.height);
		this.webglRenderer.render(this.scene, this.camera);
		if (focusContinues || autoRotationContinues) {
			this.requestRender();
		}
	};

	private advanceAutoRotation(timestamp: number): boolean {
		if (!this.autoRotationEnabled) {
			return false;
		}
		if (this.focusAnimation !== undefined) {
			this.lastAutoRotationTimestamp = timestamp;
			return true;
		}
		const previous = this.lastAutoRotationTimestamp ?? timestamp;
		this.lastAutoRotationTimestamp = timestamp;
		const angle = automaticRotationAngle(timestamp - previous);
		if (angle > 0) {
			const rotation = new Quaternion().setFromAxisAngle(
				AUTO_ROTATION_AXIS,
				angle,
			);
			this.camera.position.applyQuaternion(rotation);
			this.camera.up.applyQuaternion(rotation).normalize();
			this.camera.lookAt(CAMERA_TARGET);
			this.controls.update();
		}
		return true;
	}

	private advanceFocusAnimation(timestamp: number): boolean {
		const animation = this.focusAnimation;
		if (animation === undefined) {
			return false;
		}
		const progress = Math.min(
			1,
			Math.max(
				0,
				(timestamp - animation.startedAt) / animation.durationMs,
			),
		);
		const eased = progress * progress * (3 - 2 * progress);
		const rotation = new Quaternion().slerpQuaternions(
			IDENTITY_QUATERNION,
			animation.rotation,
			eased,
		);
		this.camera.position
			.copy(animation.startPosition)
			.applyQuaternion(rotation);
		this.camera.up.copy(animation.startUp).applyQuaternion(rotation).normalize();
		this.camera.lookAt(CAMERA_TARGET);
		this.controls.update();
		if (progress >= 1) {
			this.focusAnimation = undefined;
			this.controls.enabled = true;
			this.syncControlsToCamera();
			this.emitCameraChange();
			return false;
		}
		return true;
	}

	private cancelFocus(): void {
		if (this.focusAnimation !== undefined) {
			this.focusAnimation = undefined;
			this.controls.enabled = true;
			this.syncControlsToCamera();
		}
	}

	private syncControlsToCamera(): void {
		this.controls.setCamera(this.camera);
		this.controls.setGizmosVisible(false);
		this.controls.update();
	}

	private applySelection(): void {
		this.nodeLayer.updateSelection(this.selection);
		this.edgeLayer.updateSelection(this.selection.selectedNodeId);
		this.tagLayer.updateSelection(this.selection.selectedNodeId);
		this.tagLayer.updateSelectedTag(this.selectedTagId);
		this.labelLayer.updateSelection(this.selection);
		this.requestRender();
	}

	private applyCameraState(camera: CameraState | undefined): void {
		const position = toFiniteVector(camera?.position);
		const up = toFiniteVector(camera?.up);
		if (position === undefined || position.lengthSq() < 1e-8) {
			this.camera.position.set(0, 0, DEFAULT_CAMERA_DISTANCE);
		} else {
			const distance = Math.min(
				MAX_CAMERA_DISTANCE,
				Math.max(MIN_CAMERA_DISTANCE, position.length()),
			);
			this.camera.position.copy(position.normalize().multiplyScalar(distance));
		}
		if (up === undefined || up.lengthSq() < 1e-8) {
			this.camera.up.set(0, 1, 0);
		} else {
			this.camera.up.copy(up.normalize());
		}
		if (
			Math.abs(
				this.camera.position
					.clone()
					.normalize()
					.dot(this.camera.up),
			) > 0.999
		) {
			this.camera.up.set(0, 1, 0);
			if (
				Math.abs(
					this.camera.position
						.clone()
						.normalize()
						.dot(this.camera.up),
				) > 0.999
			) {
				this.camera.up.set(1, 0, 0);
			}
		}
		this.camera.lookAt(CAMERA_TARGET);
	}

	private emitCameraChange(): void {
		this.callbacks.onCameraChange?.(this.getCameraState());
	}

	private updateTheme(): void {
		this.theme = this.readTheme();
		this.nodeLayer.updateTheme(this.theme);
		this.edgeLayer.updateTheme(this.theme);
		this.tagLayer.updateTheme(this.theme);
		this.sphereLayer.update(this.appearance, this.theme);
		this.updateClearColor();
		this.requestRender();
	}

	private updateClearColor(): void {
		this.webglRenderer.setClearColor(
			this.appearance.backgroundFollowsTheme
				? this.theme.background
				: '#07131f',
			1,
		);
	}

	private readTheme(): RenderTheme {
		const style = this.ownerWindow.getComputedStyle(
			this.container,
		);
		const css = (name: string, fallback: string): string => {
			const value = style.getPropertyValue(name).trim();
			return value.length > 0 ? value : fallback;
		};
		return {
			background: css('--sg-void', '#07131f'),
			node: css('--sg-city', '#f1e4c4'),
			nodeAttachment: css('--sg-attachment', '#b9a26c'),
			nodeUnresolved: css('--sg-unresolved', '#7f8d91'),
			nodeNeighbor: css('--sg-city-neighbor', '#fff2cf'),
			nodeDirectoryPeer: css('--sg-city-directory-peer', '#82b7ad'),
			nodeActive: css('--sg-active', '#7eb5c2'),
			nodeHovered: css('--sg-selection', '#ff6b57'),
			nodeSelected: css('--sg-selection', '#ff6b57'),
			nodeRoute: css('--sg-route', '#f1bb55'),
			nodeRouteStart: css('--sg-route-start', '#f1bb55'),
			nodeRouteEnd: css('--sg-route-end', '#7eb5c2'),
			edge: css('--sg-road', '#8da4ae'),
			edgeSelected: css('--sg-selection', '#ff6b57'),
			edgeRoute: css('--sg-route', '#f1bb55'),
			graticule: css('--sg-graticule', '#516675'),
			tag: css('--sg-tag', '#d49a43'),
			tagSoft: css('--sg-tag-soft', '#ead2a0'),
			tagEdge: css('--sg-tag-edge', '#a77937'),
			sphere: css('--sg-ocean', '#0c2638'),
			coast: css('--sg-coast', '#d4b572'),
			land: [
				css('--sg-land-1', '#66725a'),
				css('--sg-land-2', '#a07a49'),
				css('--sg-land-3', '#8d5947'),
				css('--sg-land-4', '#536776'),
				css('--sg-land-5', '#77756c'),
				css('--sg-land-6', '#667f75'),
			],
		};
	}

	private assertUsable(): void {
		if (this.disposed) {
			throw new Error('SphericalGraphRenderer has been disposed.');
		}
	}
}

function toFiniteVector(
	value: readonly number[] | undefined,
): Vector3 | undefined {
	if (
		value === undefined ||
		value.length !== 3 ||
		value.some((component) => !Number.isFinite(component))
	) {
		return undefined;
	}
	const [x, y, z] = value;
	return x === undefined || y === undefined || z === undefined
		? undefined
		: new Vector3(x, y, z);
}
