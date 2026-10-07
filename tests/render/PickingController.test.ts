import { CircleGeometry, DoubleSide, InstancedMesh, Matrix4, MeshBasicMaterial, PerspectiveCamera } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { NODE_SURFACE_LIFT, SPHERE_RADIUS } from '../../src/constants';
import { PickingController } from '../../src/render/PickingController';
import type { SurfaceMode } from '../../src/settings/settings';

function harness(z: number) {
	const handlers = new Map<string, (event: unknown) => void>();
	const tooltip = { setAttribute: vi.fn(), remove: vi.fn(), style: {}, hidden: true };
	const canvas = {
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
	const picking = new PickingController(canvas, camera,
		{ mesh, nodeForInstance: () => node },
		{ mesh: undefined, isTagPickable: () => false, tagForInstance: () => undefined },
		{ onSelect, onOpen, onHover: vi.fn() }, { getSurfaceMode: () => mode });
	const event = { button: 0, pointerId: 1, pointerType: 'mouse', clientX: 100, clientY: 100 };
	return {
		onSelect, onOpen,
		setMode: (value: SurfaceMode) => { mode = value; },
		click: () => { handlers.get('pointerdown')?.(event); handlers.get('pointerup')?.(event); },
		doubleClick: () => handlers.get('dblclick')?.(event),
		dispose: () => { picking.dispose(); geometry.dispose(); material.dispose(); },
	};
}

describe('PickingController globe occlusion', () => {
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
