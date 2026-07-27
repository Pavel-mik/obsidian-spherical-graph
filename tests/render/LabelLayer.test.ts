import { describe, expect, it } from 'vitest';
import {
	cameraZoomInPercent,
	routeRoleForNode,
} from '../../src/render/LabelLayer';
import {
	labelBudgetForViewport,
	labelZoomVisuals,
} from '../../src/render/labelVisibility';

describe('cameraZoomInPercent', () => {
	it('maps the supported camera range to a stable zoom-in percentage', () => {
		expect(cameraZoomInPercent(60)).toBe(0);
		expect(cameraZoomInPercent(12)).toBe(100);
		expect(cameraZoomInPercent(27)).toBeCloseTo(68.75, 8);
		expect(cameraZoomInPercent(100)).toBe(0);
		expect(cameraZoomInPercent(2)).toBe(100);
	});
});

describe('labelZoomVisuals', () => {
	it('fades and scales labels continuously across the zoom range', () => {
		const hidden = labelZoomVisuals(36, 50);
		const fading = labelZoomVisuals(30, 50);
		const close = labelZoomVisuals(12, 50);

		expect(hidden.opacity).toBe(0);
		expect(fading.opacity).toBeGreaterThan(0);
		expect(fading.opacity).toBeLessThan(1);
		expect(close.opacity).toBe(1);
		expect(hidden.scale).toBeLessThan(fading.scale);
		expect(fading.scale).toBeLessThan(close.scale);
	});
});

describe('labelBudgetForViewport', () => {
	it('keeps the configured maximum useful on a desktop viewport', () => {
		expect(labelBudgetForViewport(1_536, 937)).toBeGreaterThan(80);
	});

	it('reduces label density in a narrow pane', () => {
		expect(labelBudgetForViewport(430, 713)).toBe(20);
		expect(labelBudgetForViewport(240, 400)).toBe(8);
	});

	it('returns no budget for invalid viewport dimensions', () => {
		expect(labelBudgetForViewport(0, 400)).toBe(0);
		expect(labelBudgetForViewport(Number.NaN, 400)).toBe(0);
	});
});

describe('routeRoleForNode', () => {
	const route = {
		startNodeId: 'A',
		endNodeId: 'B',
		nodeIds: ['A', 'C', 'B'],
		edges: [],
	};

	it('marks the route origin and destination independently', () => {
		expect(routeRoleForNode(route, 'A')).toBe('start');
		expect(routeRoleForNode(route, 'B')).toBe('destination');
		expect(routeRoleForNode(route, 'C')).toBeUndefined();
	});
});
