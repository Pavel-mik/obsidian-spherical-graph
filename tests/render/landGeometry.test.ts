import { describe, expect, it } from 'vitest';
import {
	buildLandSurfaceData,
	classifyLandOwner,
	continentBeachWidth,
	MAX_BEACH_ANGULAR_WIDTH,
	MIN_BEACH_ANGULAR_WIDTH,
	renderedIslandRadius,
	selectRenderedIslandNodeIndices,
	SEA_OWNER,
} from '../../src/render/landGeometry';
import { fibonacciSpherePoint } from '../../src/layout/initialization';
import {
	exponentialMap,
	geodesicDistance,
} from '../../src/geometry/sphericalGeometry';
import {
	readVec3,
	scaleVec3,
	type Vec3,
} from '../../src/geometry/vector3';
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
		expect(data.beachPositions.length).toBeGreaterThan(0);
		expect(data.beachPositions.length).toBe(
			data.beachTriangleCount * 9,
		);
		expect(data.coastPositions.length).toBeGreaterThan(0);
		expect(data.coastPositions.length % 6).toBe(0);
		expect(data.renderedIslandCount).toBe(1);
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
		expect([...first.beachPositions]).toEqual([
			...second.beachPositions,
		]);
		expect([...first.coastPositions]).toEqual([...second.coastPositions]);
	});

	it('varies the beach width continuously inside a bounded sandy band', () => {
		const widths = Array.from({ length: 64 }, (_, index) => {
			const phase = (index / 64) * Math.PI * 2;
			return continentBeachWidth(
				exponentialMap([1, 0, 0], [
					0,
					Math.cos(phase) * 0.4,
					Math.sin(phase) * 0.4,
				]),
				0,
				42,
			);
		});
		expect(Math.min(...widths)).toBeGreaterThanOrEqual(
			MIN_BEACH_ANGULAR_WIDTH,
		);
		expect(Math.max(...widths)).toBeLessThanOrEqual(
			MAX_BEACH_ANGULAR_WIDTH,
		);
		expect(Math.max(...widths) - Math.min(...widths)).toBeGreaterThan(
			0.003,
		);
	});

	it('covers every member while leaving unsupported parts of the old radial cap at sea', () => {
		const center: Vec3 = [1, 0, 0];
		const members = [
			center,
			exponentialMap(center, [0, 0.24, 0]),
			exponentialMap(center, [0, -0.24, 0]),
			exponentialMap(center, [0, 0, 0.24]),
		];
		const outsider = exponentialMap(center, [0, 0, -0.2]);
		const supportedPositions = new Float32Array([
			...members.flat(),
			...outsider,
		]);
		const supportedGeography: RenderGeography = {
			continents: [
				{
					id: 'supported',
					label: 'Supported',
					nodeIndices: [0, 1, 2, 3],
					center,
					capRadius: 0.62,
					colorIndex: 0,
				},
				{
					id: 'neighbor',
					label: 'Neighbor',
					nodeIndices: [4],
					center: outsider,
					capRadius: 0.3,
					colorIndex: 1,
				},
			],
			islandNodeIndices: [],
		};
		const model = {
			geography: supportedGeography,
			positions: supportedPositions,
			seed: 42,
			edges: [
				{ source: 0, target: 1, weight: 1 },
				{ source: 0, target: 2, weight: 1 },
				{ source: 0, target: 3, weight: 1 },
			],
		};

		for (const member of members) {
			expect(classifyLandOwner(member, model)).toBe(0);
		}
		expect(classifyLandOwner(outsider, model)).toBe(1);
		const unsupported = exponentialMap(
			center,
			scaleVec3(
				[0, 1 / Math.sqrt(2), 1 / Math.sqrt(2)],
				0.5,
			),
		);
		expect(geodesicDistance(center, unsupported)).toBeLessThan(0.62);
		expect(classifyLandOwner(unsupported, model)).toBe(SEA_OWNER);
	});

	it(
		'omits orphans and keeps low-degree island land small on a 636-note vault',
		() => {
			const nodeCount = 636;
			const largePositions = new Float32Array(nodeCount * 3);
			const nodeDegrees = new Uint8Array(nodeCount);
			nodeDegrees[0] = 3;
			nodeDegrees[1] = 3;
			for (let index = 0; index < nodeCount; index += 1) {
				largePositions.set(
					fibonacciSpherePoint(index, nodeCount),
					index * 3,
				);
				if (index >= 102) {
					nodeDegrees[index] = index % 2 === 0 ? 1 : 2;
				}
			}
			const largeGeography: RenderGeography = {
				continents: [
					{
						id: 'north',
						label: 'North',
						nodeIndices: [0],
						center: [0, 1, 0],
						capRadius: 0.42,
						colorIndex: 0,
					},
					{
						id: 'south',
						label: 'South',
						nodeIndices: [1],
						center: [0, -1, 0],
						capRadius: 0.42,
						colorIndex: 1,
					},
				],
				islandNodeIndices: Array.from(
					{ length: nodeCount - 2 },
					(_, index) => index + 2,
				),
			};

			const first = selectRenderedIslandNodeIndices(
				largeGeography,
				largePositions,
				42,
				[],
				nodeDegrees,
			);
			const second = selectRenderedIslandNodeIndices(
				largeGeography,
				largePositions,
				42,
				[],
				nodeDegrees,
			);
			expect(first).toEqual(second);
			expect(first.length).toBeGreaterThan(400);
			expect(first.every((nodeIndex) => nodeIndex >= 102)).toBe(true);
			for (let left = 0; left < first.length; left += 1) {
				for (let right = left + 1; right < first.length; right += 1) {
					expect(
						geodesicDistance(
							readVec3(largePositions, first[left] ?? 0),
							readVec3(
								largePositions,
								first[right] ?? 0,
							),
						),
					).toBeGreaterThanOrEqual(0.109);
				}
			}
			expect(
				renderedIslandRadius(nodeCount, first[0] ?? 0, 42),
			).toBeLessThan(
				renderedIslandRadius(82, first[0] ?? 0, 42) * 0.5,
			);

			const data = buildLandSurfaceData(
				largeGeography,
				largePositions,
				10.015,
				42,
				2,
				[],
				nodeDegrees,
			);
			expect(data.renderedIslandCount).toBe(first.length);
			expect(data.renderedIslandCount).toBeLessThanOrEqual(
				nodeCount - 102,
			);
		},
		15_000,
	);
});
