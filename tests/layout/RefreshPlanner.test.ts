import { describe, expect, it } from 'vitest';
import {
	createRefreshPlan,
	directlyAffectedIdsFromDiff,
} from '../../src/layout/RefreshPlanner';

describe('RefreshPlanner', () => {
	it('builds warm-up, affected, anchored, and hard-fixed masks', () => {
		const plan = createRefreshPlan({
			nodeIds: ['a', 'b', 'c', 'd', 'new'],
			existingNodeMask: new Uint8Array([1, 1, 1, 1, 0]),
			edgeEndpoints: new Uint32Array([
				4, 1,
				1, 2,
				2, 3,
			]),
			directlyAffectedNodeIds: new Set(['a']),
			settings: {
				affectedNeighborhoodHops: 1,
				largeChangeWarningRatio: 0.5,
			},
		});
		expect(plan.noOp).toBe(false);
		expect(plan.warmupMovableMask).toEqual(
			new Uint8Array([0, 0, 0, 0, 1]),
		);
		expect(plan.relaxationMovableMask).toEqual(
			new Uint8Array([1, 1, 0, 0, 1]),
		);
		expect(plan.hardFixedMask).toEqual(
			new Uint8Array([0, 0, 1, 1, 0]),
		);
		expect(plan.anchorStrengths[0]).toBeGreaterThan(0);
		expect(plan.anchorStrengths[1]).toBeGreaterThan(0);
		expect(plan.anchorStrengths[4]).toBe(0);
	});

	it('returns a no-op for an unchanged graph', () => {
		const plan = createRefreshPlan({
			nodeIds: ['a', 'b'],
			existingNodeMask: new Uint8Array([1, 1]),
			edgeEndpoints: new Uint32Array([0, 1]),
			directlyAffectedNodeIds: new Set(),
		});
		expect(plan.noOp).toBe(true);
		expect(plan.affectedNodeCount).toBe(0);
		expect(plan.relaxationMovableMask).toEqual(
			new Uint8Array([0, 0]),
		);
	});

	it('warns about large refreshes without changing operation mode', () => {
		const plan = createRefreshPlan({
			nodeIds: ['a', 'b', 'c', 'd'],
			existingNodeMask: new Uint8Array([1, 1, 1, 1]),
			edgeEndpoints: new Uint32Array([0, 1, 1, 2, 2, 3]),
			directlyAffectedNodeIds: new Set(['b']),
			settings: {
				affectedNeighborhoodHops: 2,
				largeChangeWarningRatio: 0.2,
			},
		});
		expect(plan.warnLargeChange).toBe(true);
		expect(plan.relaxationMovableMask).toEqual(
			new Uint8Array([1, 1, 1, 1]),
		);
	});

	it('collects direct edge endpoints and supplied removed-node neighbors', () => {
		const affected = directlyAffectedIdsFromDiff({
			addedNodeIds: ['new'],
			affectedNodeIds: ['removed-neighbor'],
			addedEdges: [{ sourceId: 'a', targetId: 'b' }],
			removedEdges: [{ sourceId: 'c', targetId: 'd' }],
			changedWeightEdges: [{ sourceId: 'e', targetId: 'f' }],
			filterChanged: false,
		});
		expect([...affected].sort()).toEqual(
			['a', 'b', 'c', 'd', 'e', 'f', 'new', 'removed-neighbor'].sort(),
		);
	});
});
