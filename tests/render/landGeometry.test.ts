import { describe, expect, it } from 'vitest';
import {
	buildLandSurfaceData,
	classifyLandOwner,
	continentCoastRadius,
	SEA_OWNER,
} from '../../src/render/landGeometry';
import type { RenderGeography } from '../../src/render/renderTypes';

const geography: RenderGeography = {
	continents: [
		{
			id: 'west',
			label: 'West',
			nodeIndices: [0],
			center: [1, 0, 0],
			capRadius: 0.55,
			colorIndex: 0,
		},
		{
			id: 'east',
			label: 'East',
			nodeIndices: [1],
			center: [-1, 0, 0],
			capRadius: 0.55,
			colorIndex: 1,
		},
	],
	islandNodeIndices: [2],
};
const positions = new Float32Array([
	1, 0, 0,
	-1, 0, 0,
	0, 0, 1,
]);

describe('land surface geometry', () => {
	it('gives every surface cell at most one owner and keeps explicit sea', () => {
		const model = { geography, positions, seed: 42 };
		expect(classifyLandOwner([1, 0, 0], model)).toBe(0);
		expect(classifyLandOwner([-1, 0, 0], model)).toBe(1);
		expect(classifyLandOwner([0, 1, 0], model)).toBe(SEA_OWNER);
		expect(classifyLandOwner([0, 0, 1], model)).toBe(2);
	});

	it('builds batched land triangles and coastline segments', () => {
		const data = buildLandSurfaceData(
			geography,
			positions,
			10.015,
			42,
			3,
		);
		expect(data.triangleCount).toBeGreaterThan(0);
		expect(data.positions.length).toBe(data.triangleCount * 9);
		expect(data.colorIndices.length).toBe(data.triangleCount * 3);
		expect(data.shades.length).toBe(data.triangleCount * 3);
		expect(data.coastPositions.length).toBeGreaterThan(0);
		expect(data.coastPositions.length % 6).toBe(0);
	});

	it('is deterministic for a committed snapshot seed', () => {
		const first = buildLandSurfaceData(
			geography,
			positions,
			10.015,
			99,
			2,
		);
		const second = buildLandSurfaceData(
			geography,
			positions,
			10.015,
			99,
			2,
		);
		expect([...first.positions]).toEqual([...second.positions]);
		expect([...first.colorIndices]).toEqual([...second.colorIndices]);
		expect([...first.coastPositions]).toEqual([...second.coastPositions]);
	});

	it('creates a detailed but single-valued radial coastline', () => {
		const continentOnly = {
			geography: {
				continents: geography.continents.slice(0, 1),
				islandNodeIndices: [],
			},
			positions,
			seed: 42,
		};
		const sampledRadii = Array.from({ length: 96 }, (_, index) => {
			const azimuth = (index / 96) * Math.PI * 2;
			const sampleDistance = 0.5;
			const direction: [number, number, number] = [
				Math.cos(sampleDistance),
				Math.sin(sampleDistance) * Math.cos(azimuth),
				Math.sin(sampleDistance) * Math.sin(azimuth),
			];
			return continentCoastRadius(direction, 0, continentOnly);
		});
		expect(Math.max(...sampledRadii) - Math.min(...sampledRadii)).toBeGreaterThan(
			0.045,
		);

		for (let azimuthIndex = 0; azimuthIndex < 24; azimuthIndex += 1) {
			const azimuth = (azimuthIndex / 24) * Math.PI * 2;
			const outerMemberDistance = 0.43;
			expect(
				classifyLandOwner(
					[
						Math.cos(outerMemberDistance),
						Math.sin(outerMemberDistance) * Math.cos(azimuth),
						Math.sin(outerMemberDistance) * Math.sin(azimuth),
					],
					continentOnly,
				),
			).toBe(0);
			let reachedSea = false;
			for (let radialIndex = 0; radialIndex <= 48; radialIndex += 1) {
				const distance = (radialIndex / 48) * 0.82;
				const direction: [number, number, number] = [
					Math.cos(distance),
					Math.sin(distance) * Math.cos(azimuth),
					Math.sin(distance) * Math.sin(azimuth),
				];
				const isLand =
					classifyLandOwner(direction, continentOnly) === 0;
				if (!isLand) {
					reachedSea = true;
				} else {
					expect(reachedSea).toBe(false);
				}
			}
		}
	});
});
