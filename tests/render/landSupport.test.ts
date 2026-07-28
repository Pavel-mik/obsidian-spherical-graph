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
	it('guarantees member land while a foreign node carves sea', () => {
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
		expect(classifySupportedContinent(foreign, model)).toBe(-1);
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
});
