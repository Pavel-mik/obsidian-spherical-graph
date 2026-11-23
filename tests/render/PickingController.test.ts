import { CircleGeometry, DoubleSide, InstancedMesh, Matrix4, MeshBasicMaterial, PerspectiveCamera } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { NODE_SURFACE_LIFT, SPHERE_RADIUS } from '../../src/constants';
import { PickingController } from '../../src/render/PickingController';
import type { SurfaceMode } from '../../src/settings/settings';

function harness(z: number) {
	const handlers = new Map<string, (event: unknown) => void>();
	let time = 0;
	const timers: Array<{due:number; run:()=>void; cancelled:boolean}> = [];
	const ownerWindow = {
		setTimeout: (run:()=>void, delay:number) => { timers.push({due:time+delay,run,cancelled:false}); return timers.length; },
		clearTimeout: (id:number) => { const timer=timers[id-1]; if (timer) timer.cancelled=true; },
	};
	const advance = (ms:number) => {
		time+=ms;
		for (const timer of timers) if (!timer.cancelled && timer.due<=time) { timer.cancelled=true; timer.run(); }
	};
	const tooltip = { setAttribute: vi.fn(), remove: vi.fn(), style: {}, hidden: true,textContent:'' };
	let overlay = false;
	const canvas = {
		ownerDocument: { defaultView: ownerWindow, elementFromPoint: (): unknown => overlay ? tooltip : canvas },
		parentElement: { createDiv: () => tooltip },
		addEventListener: (name: string, handler: (event: unknown) => void) => handlers.set(name, handler),
		removeEventListener: vi.fn(),
		getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 200 }),
	} as unknown as HTMLCanvasElement;
	const camera = new PerspectiveCamera(45, 1, 0.1, 100);
	camera.position.set(0, 0, 32);
	camera.lookAt(0, 0, 0);
	camera.updateMatrixWorld(true);
	const geometry = new CircleGeometry(0.2, 16);
	const material = new MeshBasicMaterial({ side: DoubleSide });
	const mesh = new InstancedMesh(geometry, material, 1);
	mesh.setMatrixAt(0, new Matrix4().makeTranslation(0, 0, z));
	mesh.updateMatrixWorld(true);
	const node = { index: 0, id: 'note.md', path: 'note.md', basename: 'note', degree: 0, weightedDegree: 0 };
	const onSelect = vi.fn();
	const onOpen = vi.fn();
	let mode: SurfaceMode = 'solid';
	let terrainBlocked=false;
	let nodeLabelVisible=false;
	const onHover=vi.fn();
	const picking = new PickingController(canvas, camera,
		{ mesh, nodeForInstance: () => node },
		{ mesh: undefined, isTagPickable: () => false, tagForInstance: () => undefined },
		{ onSelect, onOpen, onHover }, { getSurfaceMode: () => mode,isTerrainOccluded:()=>terrainBlocked,hasNodeLabel:()=>nodeLabelVisible });
	const event = { button: 0, pointerId: 1, pointerType: 'mouse', clientX: 100, clientY: 100 };
	return {
		onSelect, onOpen, onHover, tooltip, advance,
		setOverlay: (value: boolean) => { overlay = value; },
		touchPointer: (type: string, pointerId = 1, x = 100) => handlers.get(type)?.({ ...event, pointerType: 'touch', pointerId, clientX: x }),
		endTouch: () => {
			const preventDefault = vi.fn();
			handlers.get('touchend')?.({ changedTouches: [{ clientX: 100, clientY: 100 }], cancelable: true, preventDefault });
			return preventDefault;
		},
		setNodeLabelVisible:(value:boolean)=>{nodeLabelVisible=value;},syncLabels:()=>picking.syncHoverLabel(),
		move: () => handlers.get('pointermove')?.(event),
		leave: () => handlers.get('pointerleave')?.(event),
		setMode: (value: SurfaceMode) => { mode = value; },
		setTerrainBlocked:(value:boolean)=>{terrainBlocked=value;},
		click: () => { handlers.get('pointerdown')?.(event); handlers.get('pointerup')?.(event); },
		doubleClick: () => handlers.get('dblclick')?.(event),
		dispose: () => { picking.dispose(); geometry.dispose(); material.dispose(); },
	};
}

describe('PickingController globe occlusion', () => {
	it('consumes the browser click only when a handled tap has put a panel under the finger', () => {
		const h = harness(SPHERE_RADIUS + NODE_SURFACE_LIFT);
		h.touchPointer('pointerdown');
		h.touchPointer('pointerup');
		expect(h.onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'node' }));
		h.setOverlay(true);
		expect(h.endTouch()).toHaveBeenCalledOnce();
		expect(h.endTouch()).not.toHaveBeenCalled();

		h.setOverlay(false);
		h.touchPointer('pointerdown');
		h.touchPointer('pointerup');
		expect(h.endTouch()).not.toHaveBeenCalled();

		h.setOverlay(true);
		h.touchPointer('pointerdown');
		h.touchPointer('pointermove', 1, 132);
		h.touchPointer('pointerup', 1, 132);
		expect(h.endTouch()).not.toHaveBeenCalled();

		h.touchPointer('pointerdown');
		h.touchPointer('pointerdown', 2);
		h.touchPointer('pointerup', 2);
		h.touchPointer('pointerup');
		expect(h.endTouch()).not.toHaveBeenCalled();
		h.dispose();
	});

	it('uses the map label alone when it already identifies the hovered city',()=>{
	 const h=harness(SPHERE_RADIUS+NODE_SURFACE_LIFT);h.setNodeLabelVisible(true);h.move();h.advance(1000);
	 expect(h.onHover).toHaveBeenLastCalledWith(expect.objectContaining({kind:'node'}));expect(h.tooltip.hidden).toBe(true);h.dispose();
	});
	it('cancels a delayed duplicate after label placement and keeps a basename-only fallback',()=>{
	 const h=harness(SPHERE_RADIUS+NODE_SURFACE_LIFT);h.move();h.setNodeLabelVisible(true);h.syncLabels();h.advance(1000);expect(h.tooltip.hidden).toBe(true);
	 h.setNodeLabelVisible(false);h.move();h.advance(280);expect(h.tooltip.hidden).toBe(false);expect(h.tooltip.textContent).toBe('note');h.setNodeLabelVisible(true);h.syncLabels();expect(h.tooltip.hidden).toBe(true);h.dispose();
	});
	it('does not select or open a front city hidden by raised terrain',()=>{
	 const h=harness(SPHERE_RADIUS+NODE_SURFACE_LIFT);h.setTerrainBlocked(true);h.click();h.doubleClick();
	 expect(h.onSelect).toHaveBeenLastCalledWith(undefined);expect(h.onOpen).not.toHaveBeenCalled();
	 h.setTerrainBlocked(false);h.click();expect(h.onSelect).toHaveBeenLastCalledWith(expect.objectContaining({kind:'node'}));h.dispose();
	});
	it('delays hover details and cancels a pending tooltip on leave and dispose', () => {
		const h = harness(SPHERE_RADIUS + NODE_SURFACE_LIFT);
			h.move(); expect(h.tooltip.hidden).toBe(true);
			h.advance(279); expect(h.tooltip.hidden).toBe(true);
			h.leave(); h.advance(10); expect(h.tooltip.hidden).toBe(true);
			h.move(); h.advance(280); expect(h.tooltip.hidden).toBe(false);
			h.leave(); h.move(); h.dispose(); h.advance(300);
			expect(h.tooltip.hidden).toBe(true);
	});
	it('cannot select or open a note behind the opaque globe', () => {
		const h = harness(-(SPHERE_RADIUS + NODE_SURFACE_LIFT));
		h.click();
		h.doubleClick();
		expect(h.onSelect).toHaveBeenLastCalledWith(undefined);
		expect(h.onOpen).not.toHaveBeenCalled();
		h.dispose();
	});

	it('selects visible front-side notes', () => {
		const h = harness(SPHERE_RADIUS + NODE_SURFACE_LIFT);
		h.click();
		expect(h.onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'node' }));
		h.dispose();
	});

	it.each(['transparent', 'hidden'] as const)('allows visible rear notes in %s mode and updates when the mode changes', (mode) => {
		const h = harness(-(SPHERE_RADIUS + NODE_SURFACE_LIFT));
		h.setMode(mode);
		h.click();
		expect(h.onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'node' }));
		h.setMode('solid');
		h.click();
		expect(h.onSelect).toHaveBeenLastCalledWith(undefined);
		h.dispose();
	});
});
