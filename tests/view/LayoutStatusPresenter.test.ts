import { describe, expect, it } from 'vitest';
import { presentLayoutStatus } from '../../src/view/LayoutStatusPresenter';

describe('presentLayoutStatus', () => {
	it('makes refresh available only for a pending committed map', () => {
		const clean = presentLayoutStatus({
			state: { kind: 'fixed-clean', snapshotId: 'one' },
			nodeCount: 10,
			edgeCount: 12,
		});
		const dirty = presentLayoutStatus({
			state: {
				kind: 'fixed-dirty',
				snapshotId: 'one',
				diff: {
					addedNodeIds: ['new'],
					removedNodeIds: [],
					renamedNodes: [],
					addedEdgeCount: 2,
					removedEdgeCount: 1,
					changedEdgeWeightCount: 3,
					filterChanged: false,
				},
			},
			nodeCount: 11,
			edgeCount: 14,
		});

		expect(clean.canRefresh).toBe(true);
		expect(dirty.canRefresh).toBe(true);
		expect(dirty.text).toContain('+1 / -0 notes');
		expect(dirty.text).toContain('6 link changes');
	});

	it('exposes cancel and diagnostic progress only while busy', () => {
		const status = presentLayoutStatus({
			state: {
				kind: 'refreshing',
				operationId: 'op',
				snapshotId: 'one',
			},
			nodeCount: 10,
			edgeCount: 12,
			progress: {
				phase: 'anchored-relaxation',
				iteration: 50,
			},
		});

		expect(status.isBusy).toBe(true);
		expect(status.canCancel).toBe(true);
		expect(status.canRenew).toBe(false);
		expect(status.text).toContain('Anchored Relaxation · iteration 50');
	});

	it('keeps renew available after an error', () => {
		const status = presentLayoutStatus({
			state: {
				kind: 'error',
				previousSnapshotId: 'one',
				message: 'Worker stopped',
			},
			nodeCount: 10,
			edgeCount: 12,
		});

		expect(status.tone).toBe('error');
		expect(status.canRenew).toBe(true);
		expect(status.text).toContain('previous map preserved');
	});
});
