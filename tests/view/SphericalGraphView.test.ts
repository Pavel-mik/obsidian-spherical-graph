import type { WorkspaceLeaf } from 'obsidian';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	DEFAULT_SPHERICAL_GRAPH_SETTINGS,
} from '../../src/settings/settings';
import {
	RENEW_CONFIRMATION_COPY,
	VIEW_CONTROL_COPY,
} from '../../src/view/viewCopy';

const mocks = vi.hoisted(() => ({
	openModal: vi.fn(),
}));

vi.mock('obsidian', () => {
	class ItemView {
		readonly app = {};

		constructor(_leaf: unknown) {}
	}

	class Modal {
		containerEl = { classList: { add: vi.fn() } };
		contentEl = { append: vi.fn() };
		constructor(_app: unknown) {}

		open(): void {
			mocks.openModal();
		}
		close(): void { this.onClose(); }
		onClose(): void {}
	}

	class Scope {
		constructor(_parent?: unknown) {}

		register(): void {}
	}

	return { ItemView, Modal, Scope };
});

import { SphericalGraphView } from '../../src/view/SphericalGraphView';
import { ViewToolbar } from '../../src/view/ViewToolbar';
import { resolveRuntimeRenderProfile } from '../../src/platform/runtimeProfile';

function createView(deviceClass: 'desktop' | 'phone' | 'tablet' = 'desktop'): SphericalGraphView {
	return new SphericalGraphView({} as WorkspaceLeaf, {
		getSettings: () => DEFAULT_SPHERICAL_GRAPH_SETTINGS,
		runtimeProfile: resolveRuntimeRenderProfile(
			{
				isMobileApp: deviceClass !== 'desktop',
				isAndroidApp: deviceClass !== 'desktop',
				isPhone: deviceClass === 'phone',
				isTablet: deviceClass === 'tablet',
			},
			{ phoneQuality: 'automatic', tabletQuality: 'automatic' },
		),
		callbacks: {
			onRefresh: vi.fn(),
			onRenew: vi.fn(),
			onCancel: vi.fn(),
			onOpenFile: vi.fn(),
			onCameraChange: vi.fn(),
			onSurfaceModeChange: vi.fn(),
			onContinentsVisibilityChange: vi.fn(),
			onAtmosphereVisibilityChange: vi.fn(),
			onPinChange: vi.fn(),
			onManualSave: vi.fn(),
			onManualLoad: vi.fn(),
			onClose: vi.fn(),
		},
	});
}

describe('SphericalGraphView Renew prompt', () => {
	beforeEach(() => {
		mocks.openModal.mockClear();
	});

	it('uses the design-system control and modal copy verbatim', () => {
		expect(VIEW_CONTROL_COPY).toMatchObject({
			graphControls: 'Map controls',
			layout: 'Layout',
			explore: 'Explore',
			savedMap: 'Saved map',
			visibleContent: 'Visible content',
			globe: 'Globe',
			refresh: 'Refresh layout',
			renew: 'Renew layout',
			cancelCalculation: 'Cancel calculation',
			resetCamera: 'Reset camera',
			closeGraphControls: 'Close map controls',
			exitFullscreen: 'Exit fullscreen',
			tags: 'Tags',
			showTags: 'Show tags',
			hideTags: 'Hide tags',
			surface: 'Sphere surface',
			surfaceSolid: 'Solid',
			surfaceTransparent: 'Transparent',
			surfaceHidden: 'Hidden',
		});
		expect(RENEW_CONFIRMATION_COPY).toEqual({
			title: 'Renew the entire spherical layout?',
			body:
				'Renew creates a completely new map and may change your mental landmarks. The current map is preserved unless the calculation succeeds.',
			cancel: 'Cancel',
			confirm: 'Renew layout',
		});
	});

	it('opens the shared modal only when the Renew state hook allows it', () => {
		const view = createView();

		expect(view.promptRenew()).toBe(true);
		expect(mocks.openModal).toHaveBeenCalledTimes(1);

		view.setStatus({
			state: {
				kind: 'renewing',
				operationId: 'operation-1',
				snapshotId: 'snapshot-1',
			},
			nodeCount: 12,
			edgeCount: 18,
		});
		expect(view.promptRenew()).toBe(false);
		expect(mocks.openModal).toHaveBeenCalledTimes(1);

		view.setStatus({
			state: { kind: 'fixed-clean', snapshotId: 'snapshot-1' },
			nodeCount: 12,
			edgeCount: 18,
		});
		expect(view.promptRenew()).toBe(true);
		expect(mocks.openModal).toHaveBeenCalledTimes(2);
	});
});

describe('SphericalGraphView touch dismissals', () => {
	afterEach(() => vi.useRealTimers());

	function presentationHarness(deviceClass: 'desktop' | 'phone' | 'tablet') {
		const view = createView(deviceClass);
		const hint = { remove: vi.fn(), setAttribute: vi.fn(), textContent: '', className: '' };
		const parent = { insertBefore: vi.fn() };
		const root = {
			dataset: {} as Record<string, string>, parentNode: parent, nextSibling: null,
			ownerDocument: { fullscreenElement: null, defaultView: { setTimeout, clearTimeout } },
			createDiv: () => hint,
		};
		const renderer = { setPresentationMode: vi.fn(), setAutoRotation: vi.fn() };
		Reflect.set(view, 'root', root);
		Reflect.set(view, 'renderer', renderer);
		return { view, root, hint, parent, renderer };
	}

	it('shows the desktop Escape hint for only three seconds', () => {
		vi.useFakeTimers();
		const { view, hint, root } = presentationHarness('desktop');
		view.toggleFullscreen();
		expect(root.dataset.presentation).toBe('true');
		expect(hint.textContent).toBe('Press Esc to exit fullscreen');
		vi.advanceTimersByTime(2999);
		expect(hint.remove).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(hint.remove).toHaveBeenCalledOnce();
		view.toggleFullscreen();
		expect(root.dataset.presentation).toBeUndefined();
	});

	it.each(['phone', 'tablet'] as const)('restores %s presentation when the host dismisses its modal with Back', (deviceClass) => {
		const { view, root, renderer, parent } = presentationHarness(deviceClass);
		view.toggleFullscreen();
		expect(renderer.setAutoRotation).toHaveBeenLastCalledWith(true);
		const modal = Reflect.get(view, 'presentationModal') as { close(): void };
		modal.close();
		expect(root.dataset.presentation).toBeUndefined();
		expect(renderer.setAutoRotation).toHaveBeenLastCalledWith(false);
		expect(parent.insertBefore).toHaveBeenCalledWith(root, null);
	});

	it('closes Map controls without requiring a command selection', () => {
		const toolbar = Object.create(ViewToolbar.prototype) as ViewToolbar;
		const menu = { open: true };
		const focus = vi.fn();
		Reflect.set(toolbar, 'menu', menu);
		Reflect.set(toolbar, 'menuSummary', { focus });

		expect(toolbar.closeMenu(true)).toBe(true);
		expect(menu.open).toBe(false);
		expect(focus).toHaveBeenCalledWith({ preventScroll: true });
		expect(toolbar.closeMenu()).toBe(false);
	});

	it('restores the standard view when presentation ends', () => {
		const view = createView();
		const exitButton = { hidden: false };
		const root = {
			dataset: { presentation: 'true' } as Record<string, string>,
			ownerDocument: { fullscreenElement: null },
		};
		const setFullscreenActive = vi.fn();
		const setPresentationMode = vi.fn();
		const setAutoRotation = vi.fn();
		Reflect.set(view, 'presentationMode', true);
		Reflect.set(view, 'root', root);
		Reflect.set(view, 'presentationExitButton', exitButton);
		Reflect.set(view, 'toolbar', { setFullscreenActive });
		Reflect.set(view, 'renderer', {
			setPresentationMode,
			setAutoRotation,
		});

		expect(view.toggleFullscreen()).toBe(true);
		expect(exitButton.hidden).toBe(true);
		expect(root.dataset.presentation).toBeUndefined();
		expect(setFullscreenActive).toHaveBeenCalledWith(false);
		expect(setPresentationMode).toHaveBeenCalledWith(false);
		expect(setAutoRotation).toHaveBeenCalledWith(false);
	});
});
