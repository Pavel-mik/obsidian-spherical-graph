import { describe, expect, it } from 'vitest';
import {
	cameraZoomInPercent,
	routeRoleForNode,
} from '../../src/render/LabelLayer';

describe('cameraZoomInPercent', () => {
	it('maps the supported camera range to a stable zoom-in percentage', () => {
		expect(cameraZoomInPercent(60)).toBe(0);
		expect(cameraZoomInPercent(12)).toBe(100);
		expect(cameraZoomInPercent(27)).toBeCloseTo(68.75, 8);
		expect(cameraZoomInPercent(100)).toBe(0);
		expect(cameraZoomInPercent(2)).toBe(100);
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
