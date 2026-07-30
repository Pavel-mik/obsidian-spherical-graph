import type { WorkspaceLeaf } from 'obsidian';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
		constructor(_app: unknown) {}

		open(): void {
			mocks.openModal();
		}
	}

	class Scope {
		constructor(_parent?: unknown) {}

		register(): void {}
	}

	return { ItemView, Modal, Scope };
});

import { SphericalGraphView } from '../../src/view/SphericalGraphView';

function createView(): SphericalGraphView {
	return new SphericalGraphView({} as WorkspaceLeaf, {
		getSettings: () => DEFAULT_SPHERICAL_GRAPH_SETTINGS,
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
			refresh: 'Refresh layout',
			renew: 'Renew layout',
			cancelCalculation: 'Cancel calculation',
			resetCamera: 'Reset camera',
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
