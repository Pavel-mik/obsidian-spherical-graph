import { Camera, Raycaster, Vector2 } from 'three';
import { NodeLayer } from './NodeLayer';
import { RenderNode, RenderTag } from './renderTypes';
import { TagLayer } from './TagLayer';

const CLICK_DRAG_THRESHOLD_PX = 5;

export interface PickingOptions {
	enableHover?: boolean;
	touchDragThresholdPx?: number;
	touchPickRadiusPx?: number;
	enableDoubleClick?: boolean;
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
	private disposed = false;
	private readonly activePointers = new Set<number>();
	private multiTouchGesture = false;

	constructor(
		private readonly canvas: HTMLCanvasElement,
		private readonly camera: Camera,
		private readonly nodeLayer: NodeLayer,
		private readonly tagLayer: TagLayer,
		private readonly callbacks: PickingCallbacks,
		private readonly options: PickingOptions = {},
	) {
		const parent = canvas.parentElement;
		if (parent === null) {
			throw new Error('The graph canvas must be attached before picking is enabled.');
		}
		this.tooltip = parent.createDiv();
		this.tooltip.className = 'spherical-graph-tooltip';
		this.tooltip.hidden = true;
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
			this.tooltip.hidden = true;
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
		this.tooltip.hidden = true;
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
			const intersection =
				this.raycaster.intersectObject(nodeMesh, false)[0];
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

	private updateTooltip(
		item: PickedGraphItem | undefined,
		clientX: number,
		clientY: number,
	): void {
		if (item === undefined) {
			this.tooltip.hidden = true;
			return;
		}
		const parentRectangle =
			this.tooltip.parentElement?.getBoundingClientRect();
		const left = clientX - (parentRectangle?.left ?? 0) + 12;
		const top = clientY - (parentRectangle?.top ?? 0) + 12;
		this.tooltip.textContent =
			item.kind === 'node'
				? `${item.node.basename}\n${item.node.path}`
				: `${item.tag.label}\n${item.tag.nodeIndices.length} ${
						item.tag.nodeIndices.length === 1
							? 'note'
							: 'notes'
					}`;
		this.tooltip.style.transform = `translate(${left.toFixed(1)}px, ${top.toFixed(1)}px)`;
		this.tooltip.hidden = false;
	}
}
