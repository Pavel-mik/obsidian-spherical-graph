import { CARTOGRAPHY as T } from './cartography';
import { Camera, Raycaster, Vector2, type Vector3 } from 'three';
import { NodeLayer } from './NodeLayer';
import { RenderNode, RenderTag } from './renderTypes';
import { TagLayer } from './TagLayer';
import { isPointOccludedByGlobe } from './tagGeometry';
import type { SurfaceMode } from '../settings/settings';

const CLICK_DRAG_THRESHOLD_PX = 5;

export interface PickingOptions {
	enableHover?: boolean;
	touchDragThresholdPx?: number;
	touchPickRadiusPx?: number;
	enableDoubleClick?: boolean;
	getSurfaceMode?: () => SurfaceMode;
	isTerrainOccluded?: (camera:Vector3,point:Vector3)=>boolean;
	hasNodeLabel?: (nodeId:string)=>boolean;
}

export interface PickingCallbacks {
	onHover(item: PickedGraphItem | undefined): void;
	onSelect(item: PickedGraphItem | undefined): void;
	onOpen(node: RenderNode, openInNewLeaf: boolean): void;
}

export type PickedGraphItem =
	| { kind: 'node'; node: RenderNode }
	| { kind: 'tag'; tag: RenderTag };

interface PointerStart {
	pointerId: number;
	x: number;
	y: number;
	moved: boolean;
}

export class PickingController {
	private readonly raycaster = new Raycaster();
	private readonly pointer = new Vector2();
	private readonly tooltip: HTMLElement;
	private pointerStart: PointerStart | undefined;
	private selectedNode: RenderNode | undefined;
	private tooltipKey: string | undefined;
	private tooltipNodeId: string | undefined;
	private tooltipTimer: number | undefined;
	private readonly ownerWindow: Window;
	private disposed = false;
	private readonly activePointers = new Set<number>();
	private multiTouchGesture = false;

	constructor(
		private readonly canvas: HTMLCanvasElement,
		private readonly camera: Camera,
		private readonly nodeLayer: Pick<NodeLayer, 'mesh' | 'nodeForInstance'>,
		private readonly tagLayer: Pick<TagLayer, 'mesh' | 'isTagPickable' | 'tagForInstance'>,
		private readonly callbacks: PickingCallbacks,
		private readonly options: PickingOptions = {},
	) {
		this.ownerWindow = canvas.ownerDocument.defaultView ?? window;
		const parent = canvas.parentElement;
		if (parent === null) {
			throw new Error('The graph canvas must be attached before picking is enabled.');
		}
		this.tooltip = parent.createDiv();
		this.tooltip.className = 'spherical-graph-tooltip';
		this.hideTooltip();
		this.tooltip.setAttribute('role', 'tooltip');

		canvas.addEventListener('pointerdown', this.onPointerDown);
		canvas.addEventListener('pointermove', this.onPointerMove);
		canvas.addEventListener('pointerup', this.onPointerUp);
		canvas.addEventListener('pointercancel', this.onPointerCancel);
		canvas.addEventListener('pointerleave', this.onPointerLeave);
		canvas.addEventListener('dblclick', this.onDoubleClick);
		canvas.addEventListener('keydown', this.onKeyDown);
	}

	setSelectedNode(node: RenderNode | undefined): void {
		this.selectedNode = node;
	}

	dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		this.canvas.removeEventListener('pointerdown', this.onPointerDown);
		this.canvas.removeEventListener('pointermove', this.onPointerMove);
		this.canvas.removeEventListener('pointerup', this.onPointerUp);
		this.canvas.removeEventListener('pointercancel', this.onPointerCancel);
		this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
		this.canvas.removeEventListener('dblclick', this.onDoubleClick);
		this.canvas.removeEventListener('keydown', this.onKeyDown);
		this.hideTooltip();
		this.tooltip.remove();
		this.pointerStart = undefined;
	}

	private readonly onPointerDown = (event: PointerEvent): void => {
		if (event.button !== 0) {
			return;
		}
		this.activePointers.add(event.pointerId);
		if (this.activePointers.size > 1) {
			this.multiTouchGesture = true;
			if (this.pointerStart !== undefined) {
				this.pointerStart.moved = true;
			}
		}
		this.pointerStart = {
			pointerId: event.pointerId,
			x: event.clientX,
			y: event.clientY,
			moved: false,
		};
	};

	private readonly onPointerMove = (event: PointerEvent): void => {
		const start = this.pointerStart;
		if (start !== undefined && start.pointerId === event.pointerId) {
			const distance = Math.hypot(
				event.clientX - start.x,
				event.clientY - start.y,
			);
			const threshold =
				event.pointerType === 'touch'
					? (this.options.touchDragThresholdPx ?? 12)
					: CLICK_DRAG_THRESHOLD_PX;
			if (distance > threshold) {
				start.moved = true;
			}
		}

		if (event.pointerType === 'touch' || this.options.enableHover === false) {
			this.callbacks.onHover(undefined);
			this.hideTooltip();
			return;
		}

		const item = this.pick(event.clientX, event.clientY);
		this.callbacks.onHover(item);
		this.updateTooltip(item, event.clientX, event.clientY);
	};

	private readonly onPointerUp = (event: PointerEvent): void => {
		const start = this.pointerStart;
		this.pointerStart = undefined;
		this.activePointers.delete(event.pointerId);
		const wasMultiTouch = this.multiTouchGesture;
		if (this.activePointers.size === 0) {
			this.multiTouchGesture = false;
		}
		if (
			event.button !== 0 ||
			start === undefined ||
			start.pointerId !== event.pointerId ||
			start.moved ||
			wasMultiTouch
		) {
			return;
		}

		const item =
			event.pointerType === 'touch'
				? this.pickWithTolerance(
						event.clientX,
						event.clientY,
						this.options.touchPickRadiusPx ?? 10,
					)
				: this.pick(event.clientX, event.clientY);
		if (
			item?.kind === 'node' &&
			(event.ctrlKey || event.metaKey)
		) {
			this.callbacks.onOpen(item.node, true);
			return;
		}
		this.selectedNode =
			item?.kind === 'node' ? item.node : undefined;
		this.callbacks.onSelect(item);
	};

	private readonly onPointerCancel = (event: PointerEvent): void => {
		this.activePointers.delete(event.pointerId);
		if (this.activePointers.size === 0) {
			this.multiTouchGesture = false;
		}
		this.pointerStart = undefined;
	};

	private readonly onPointerLeave = (): void => {
		this.callbacks.onHover(undefined);
		this.hideTooltip();
	};

	private readonly onDoubleClick = (event: MouseEvent): void => {
		if (this.options.enableDoubleClick === false) {
			return;
		}
		const item = this.pick(event.clientX, event.clientY);
		if (item?.kind === 'node') {
			this.callbacks.onOpen(
				item.node,
				event.ctrlKey || event.metaKey,
			);
		}
	};

	private readonly onKeyDown = (event: KeyboardEvent): void => {
		if (event.key === 'Escape') {
			event.preventDefault();
			this.selectedNode = undefined;
			this.callbacks.onSelect(undefined);
		} else if (event.key === 'Enter' && this.selectedNode !== undefined) {
			event.preventDefault();
			this.callbacks.onOpen(
				this.selectedNode,
				event.ctrlKey || event.metaKey,
			);
		}
	};

	private pick(
		clientX: number,
		clientY: number,
	): PickedGraphItem | undefined {
		const rectangle = this.canvas.getBoundingClientRect();
		if (rectangle.width <= 0 || rectangle.height <= 0) {
			return undefined;
		}
		this.pointer.set(
			((clientX - rectangle.left) / rectangle.width) * 2 - 1,
			-((clientY - rectangle.top) / rectangle.height) * 2 + 1,
		);
		this.raycaster.setFromCamera(this.pointer, this.camera);
		const candidates: Array<{
			distance: number;
			item: PickedGraphItem;
		}> = [];
		const nodeMesh = this.nodeLayer.mesh;
		if (nodeMesh !== undefined && nodeMesh.count > 0) {
			const intersection = this.raycaster.intersectObject(nodeMesh, false).find((hit) =>
				hit.instanceId !== undefined &&
				this.nodeLayer.nodeForInstance(hit.instanceId) !== undefined &&
				((this.options.getSurfaceMode?.() ?? 'solid') !== 'solid' ||
					(!isPointOccludedByGlobe(this.raycaster.ray.origin, hit.point)&&!this.options.isTerrainOccluded?.(this.raycaster.ray.origin,hit.point))),
			);
			const node =
				intersection?.instanceId === undefined
					? undefined
					: this.nodeLayer.nodeForInstance(
							intersection.instanceId,
						);
			if (intersection !== undefined && node !== undefined) {
				candidates.push({
					distance: intersection.distance,
					item: { kind: 'node', node },
				});
			}
		}
		const tagMesh = this.tagLayer.mesh;
		if (tagMesh !== undefined && tagMesh.count > 0) {
			const intersection =
				this.raycaster.intersectObject(tagMesh, false)[0];
			const tag =
				intersection?.instanceId === undefined ||
				!this.tagLayer.isTagPickable(
					intersection.instanceId,
					this.camera,
				)
					? undefined
					: this.tagLayer.tagForInstance(
							intersection.instanceId,
						);
			if (intersection !== undefined && tag !== undefined) {
				candidates.push({
					distance: intersection.distance,
					item: { kind: 'tag', tag },
				});
			}
		}
		return candidates.sort(
			(left, right) => left.distance - right.distance,
		)[0]?.item;
	}

	private pickWithTolerance(
		clientX: number,
		clientY: number,
		radius: number,
	): PickedGraphItem | undefined {
		const center = this.pick(clientX, clientY);
		if (center !== undefined || radius <= 0) {
			return center;
		}
		for (const [x, y] of [
			[radius, 0],
			[-radius, 0],
			[0, radius],
			[0, -radius],
			[radius * 0.7, radius * 0.7],
			[-radius * 0.7, radius * 0.7],
			[radius * 0.7, -radius * 0.7],
			[-radius * 0.7, -radius * 0.7],
		] as const) {
			const item = this.pick(clientX + x, clientY + y);
			if (item !== undefined) {
				return item;
			}
		}
		return undefined;
	}

	/** Reconcile after the map's label placement, including late frames/toggles. */
	syncHoverLabel():void {
		if(this.tooltipNodeId&&this.options.hasNodeLabel?.(this.tooltipNodeId))this.hideTooltip();
	}

	private updateTooltip(
		item: PickedGraphItem | undefined,
		clientX: number,
		clientY: number,
	): void {
		if (item === undefined || (item.kind==='node'&&this.options.hasNodeLabel?.(item.node.id))) {
			this.hideTooltip();
			return;
		}
		const parentRectangle =
			this.tooltip.parentElement?.getBoundingClientRect();
		const bounds = parentRectangle ?? this.canvas.getBoundingClientRect();
		const x = clientX - bounds.left, y = clientY - bounds.top;
		const tooltipWidth = this.tooltip.offsetWidth || Math.min(240, bounds.width - 16);
		const tooltipHeight = this.tooltip.offsetHeight || 44;
		const left = Math.max(8, Math.min(bounds.width - tooltipWidth - 8, x + 12));
		const top = Math.max(8, Math.min(bounds.height - tooltipHeight - 8, y + 12));
		this.tooltip.textContent =
			item.kind === 'node'
				? item.node.basename
				: `${item.tag.label}\n${item.tag.nodeIndices.length} ${
						item.tag.nodeIndices.length === 1
							? 'note'
							: 'notes'
					}`;
		this.tooltip.style.transform = `translate(${left.toFixed(1)}px, ${top.toFixed(1)}px)`;
		const key = item.kind === 'node' ? 'node:' + item.node.id : 'tag:' + item.tag.id;
		if (this.tooltipKey !== key) {
			this.hideTooltip(); this.tooltipKey = key;
			this.tooltipNodeId=item.kind==='node'?item.node.id:undefined;
			this.tooltipTimer = this.ownerWindow.setTimeout(() => {
				this.tooltipTimer = undefined;
				if(this.tooltipNodeId&&this.options.hasNodeLabel?.(this.tooltipNodeId)){this.hideTooltip();return;}
				if (!this.disposed && this.tooltipKey === key) this.tooltip.hidden = false;
			}, T.motion.tooltipDelayMs);
		}
	}

	private hideTooltip(): void {
		if (this.tooltipTimer !== undefined) this.ownerWindow.clearTimeout(this.tooltipTimer);
		this.tooltipTimer = undefined; this.tooltipKey = undefined;this.tooltipNodeId=undefined;
		this.tooltip.hidden = true;
	}
}
