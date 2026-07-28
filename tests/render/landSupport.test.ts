import { describe, expect, it } from 'vitest';
import {
	classifySupportedContinent,
	continentSupportClearance,
	createLandSupportModel,
} from '../../src/render/landSupport';
import { exponentialMap } from '../../src/geometry/sphericalGeometry';
import type { Vec3 } from '../../src/geometry/vector3';
import type { RenderGeography } from '../../src/render/renderTypes';

const center: Vec3 = [1, 0, 0];

function twoMemberGeography(): RenderGeography {
	return {
		continents: [
			{
				id: 'network',
				label: 'Network',
				nodeIndices: [0, 1],
				center,
				capRadius: 0.65,
				colorIndex: 0,
			},
		],
		islandNodeIndices: [],
	};
}

describe('node- and edge-supported continent territory', () => {
	it('guarantees member land without cutting a lake around one isolated free node', () => {
		const member = center;
		const foreign = exponentialMap(center, [0, 0.08, 0]);
		const geography: RenderGeography = {
			continents: [
				{
					id: 'member',
					label: 'Member',
					nodeIndices: [0],
					center,
					capRadius: 0.6,
					colorIndex: 0,
				},
			],
			islandNodeIndices: [1],
		};
		const model = createLandSupportModel(
			geography,
			new Float32Array([...member, ...foreign]),
			[],
			42,
		);

		expect(classifySupportedContinent(member, model)).toBe(0);
		expect(continentSupportClearance(member, 0, model)).toBeLessThan(0);
		expect(classifySupportedContinent(foreign, model)).toBe(0);
	});

	it('lets a competing accepted continent carve a sea boundary', () => {
		const first = center;
		const second = exponentialMap(center, [0, 0.08, 0]);
		const geography: RenderGeography = {
			continents: [
				{
					id: 'first',
					label: 'First',
					nodeIndices: [0],
					center,
					capRadius: 0.6,
					colorIndex: 0,
				},
				{
					id: 'second',
					label: 'Second',
					nodeIndices: [1],
					center: second,
					capRadius: 0.6,
					colorIndex: 1,
				},
			],
			islandNodeIndices: [],
		};
		const model = createLandSupportModel(
			geography,
			new Float32Array([...first, ...second]),
			[],
			42,
		);

		expect(classifySupportedContinent(first, model)).toBe(0);
		expect(classifySupportedContinent(second, model)).toBe(1);
	});

	it('lets a coherent free-node community preserve open water', () => {
		const member = center;
		const freeNodes = [
			exponentialMap(center, [0, 0.08, 0]),
			exponentialMap(center, [0, 0.095, 0.02]),
			exponentialMap(center, [0, 0.095, -0.02]),
		];
		const geography: RenderGeography = {
			continents: [
				{
					id: 'member',
					label: 'Member',
					nodeIndices: [0],
					center,
					capRadius: 0.6,
					colorIndex: 0,
				},
			],
			islandNodeIndices: [1, 2, 3],
		};
		const model = createLandSupportModel(
			geography,
			new Float32Array([...member, ...freeNodes.flat()]),
			[
				{ source: 1, target: 2, weight: 1 },
				{ source: 2, target: 3, weight: 1 },
				{ source: 3, target: 1, weight: 1 },
			],
			42,
		);

		for (const freeNode of freeNodes) {
			expect(classifySupportedContinent(freeNode, model)).toBe(-1);
		}
	});

	it('uses a short internal road as a narrow bridge without filling the cap', () => {
		const first = exponentialMap(center, [0, -0.175, 0]);
		const second = exponentialMap(center, [0, 0.175, 0]);
		const positions = new Float32Array([...first, ...second]);
		const geography = twoMemberGeography();
		const withoutRoad = createLandSupportModel(
			geography,
			positions,
			[],
			7,
		);
		const withRoad = createLandSupportModel(
			geography,
			positions,
			[{ source: 0, target: 1, weight: 1 }],
			7,
		);

		expect(classifySupportedContinent(center, withoutRoad)).toBe(-1);
		expect(classifySupportedContinent(center, withRoad)).toBe(0);
		const unsupported = exponentialMap(center, [0, 0, 0.35]);
		expect(classifySupportedContinent(unsupported, withRoad)).toBe(-1);
	});

	it('does not turn a long road across open water into a land bridge', () => {
		const first = exponentialMap(center, [0, -0.26, 0]);
		const second = exponentialMap(center, [0, 0.26, 0]);
		const model = createLandSupportModel(
			twoMemberGeography(),
			new Float32Array([...first, ...second]),
			[{ source: 0, target: 1, weight: 1 }],
			9,
		);

		expect(classifySupportedContinent(center, model)).toBe(-1);
	});

	it('loosens a dense circular community into a deterministic organic coast without interior lakes', () => {
		const ringCount = 24;
		const members: Vec3[] = [center];
		for (let index = 0; index < ringCount; index += 1) {
			const phase = (index / ringCount) * Math.PI * 2;
			members.push(
				exponentialMap(center, [
					0,
					Math.cos(phase) * 0.32,
					Math.sin(phase) * 0.32,
				]),
			);
		}
		const organicGeography: RenderGeography = {
			continents: [
				{
					id: 'round-community',
					label: 'Round community',
					nodeIndices: members.map((_, index) => index),
					center,
					capRadius: 0.5,
					colorIndex: 0,
				},
			],
			islandNodeIndices: [],
		};
		const edges = Array.from({ length: ringCount }, (_, index) => ({
			source: 0,
			target: index + 1,
			weight: 1,
		}));
		const model = createLandSupportModel(
			organicGeography,
			new Float32Array(members.flat()),
			edges,
			42,
		);

		for (const member of members) {
			expect(classifySupportedContinent(member, model)).toBe(0);
		}
		for (let azimuthIndex = 0; azimuthIndex < 48; azimuthIndex += 1) {
			const phase = (azimuthIndex / 48) * Math.PI * 2;
			const interior = exponentialMap(center, [
				0,
				Math.cos(phase) * 0.27,
				Math.sin(phase) * 0.27,
			]);
			expect(classifySupportedContinent(interior, model)).toBe(0);
		}

		const coastRadii = Array.from({ length: 96 }, (_, azimuthIndex) => {
			const phase = (azimuthIndex / 96) * Math.PI * 2;
			let lastLandRadius = 0;
			for (let radius = 0; radius <= 0.62; radius += 0.002) {
				const sample = exponentialMap(center, [
					0,
					Math.cos(phase) * radius,
					Math.sin(phase) * radius,
				]);
				if (classifySupportedContinent(sample, model) === 0) {
					lastLandRadius = radius;
				}
			}
			return lastLandRadius;
		});
		expect(Math.max(...coastRadii) - Math.min(...coastRadii)).toBeGreaterThan(
			0.035,
		);
		const repeat = createLandSupportModel(
			organicGeography,
			new Float32Array(members.flat()),
			edges,
			42,
		);
		for (let index = 0; index < coastRadii.length; index += 12) {
			const phase = (index / coastRadii.length) * Math.PI * 2;
			const radius = coastRadii[index] ?? 0;
			const sample = exponentialMap(center, [
				0,
				Math.cos(phase) * radius,
				Math.sin(phase) * radius,
			]);
			expect(classifySupportedContinent(sample, repeat)).toBe(0);
		}
	});
});
