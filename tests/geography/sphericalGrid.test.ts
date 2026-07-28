import { describe, expect, it } from 'vitest';
import {
	createIntrinsicSphericalGrid,
	gridSubdivisionForSpacing,
	mapPositionsToGrid,
} from '../../src/geography/sphericalGrid';

describe('intrinsic spherical analysis grid', () => {
	it('builds a deterministic closed unit icosphere with symmetric adjacency', () => {
		const grid = createIntrinsicSphericalGrid(2);
		expect(grid.vertices).toHaveLength(162);
		expect(grid.triangles).toHaveLength(320);
		for (const vertex of grid.vertices) {
			expect(Math.hypot(...vertex)).toBeCloseTo(1, 12);
		}
		for (let cell = 0; cell < grid.neighbors.length; cell += 1) {
			for (const neighbor of grid.neighbors[cell] ?? []) {
				expect(grid.neighbors[neighbor]).toContain(cell);
			}
		}
		expect(createIntrinsicSphericalGrid(2)).toEqual(grid);
	});

	it('maps antipodal positions without a longitude seam', () => {
		const grid = createIntrinsicSphericalGrid(2);
		const mapped = mapPositionsToGrid(
			grid,
			new Float32Array([
				1, 0, 0,
				-1, 0, 0,
				0, 1, 0,
				0, -1, 0,
			]),
		);
		expect(new Set(mapped).size).toBe(4);
		for (const cell of mapped) {
			expect(cell).toBeGreaterThanOrEqual(0);
			expect(cell).toBeLessThan(grid.vertices.length);
		}
	});

	it('increases analysis resolution as kNN spacing gets smaller', () => {
		expect(gridSubdivisionForSpacing(0.3)).toBeLessThan(
			gridSubdivisionForSpacing(0.07),
		);
	});
});
