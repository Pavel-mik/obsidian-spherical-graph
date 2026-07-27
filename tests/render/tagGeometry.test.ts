import { describe, expect, it } from 'vitest';
import {
	DEFAULT_TAG_ORBIT_RADIUS,
	TAG_LINK_START_RADIUS,
} from '../../src/constants';
import {
	deterministicTagDirection,
	computeTagOrbitDirections,
	isPointOccludedByGlobe,
	sampleTagSpiral,
} from '../../src/render/tagGeometry';

describe('tag orbital geometry', () => {
	it('maps each tag deterministically to the unit sphere', () => {
		const first = deterministicTagDirection('#project/orbit');
		const second = deterministicTagDirection('#project/orbit');
		const other = deterministicTagDirection('#different');

		expect(second).toEqual(first);
		expect(Math.hypot(...first)).toBeCloseTo(1, 12);
		expect(other).not.toEqual(first);
	});

	it('anchors private tags above their committed note and packs collisions', () => {
		const tags = [
			{ id: '#one', nodeIndices: [0] },
			{ id: '#two', nodeIndices: [0] },
			{ id: '#shared', nodeIndices: [0, 1] },
		];
		const positions = new Float32Array([1, 0, 0, 0, 1, 0]);
		const first = computeTagOrbitDirections(tags, positions);
		const second = computeTagOrbitDirections(tags, positions);
		const one = first.get('#one');
		const two = first.get('#two');
		const shared = first.get('#shared');

		expect([...second]).toEqual([...first]);
		expect(one).toBeDefined();
		expect(two).toBeDefined();
		expect(shared).toBeDefined();
		expect(Math.hypot(...(one ?? []))).toBeCloseTo(1, 8);
		expect((one?.[0] ?? 0)).toBeGreaterThan(0.95);
		expect((two?.[0] ?? 0)).toBeGreaterThan(0.95);
		expect(one).not.toEqual(two);
		expect((shared?.[0] ?? 0)).toBeGreaterThan(0.45);
		expect((shared?.[1] ?? 0)).toBeGreaterThan(0.45);
	});

	it('samples a spherical spiral with a linearly increasing radius', () => {
		const orbitRadius = 13;
		const samples = sampleTagSpiral(
			[1, 0, 0],
			[0, 1, 0],
			4,
			'Note.md',
			'#tag',
			orbitRadius,
		);
		const radii = samples.map((point) => Math.hypot(...point));

		expect(samples).toHaveLength(5);
		expect(radii[0]).toBeCloseTo(TAG_LINK_START_RADIUS, 10);
		expect(radii[4]).toBeCloseTo(orbitRadius, 10);
		for (let index = 1; index < radii.length; index += 1) {
			expect((radii[index] ?? 0) - (radii[index - 1] ?? 0))
				.toBeCloseTo(
					(orbitRadius - TAG_LINK_START_RADIUS) / 4,
					10,
				);
		}
	});

	it('uses the default orbit radius when no override is supplied', () => {
		const samples = sampleTagSpiral(
			[1, 0, 0],
			[0, 1, 0],
			1,
		);

		expect(Math.hypot(...(samples[1] ?? []))).toBeCloseTo(
			DEFAULT_TAG_ORBIT_RADIUS,
			10,
		);
	});

	it('detects tags hidden behind the main globe', () => {
		const camera = { x: 0, y: 0, z: 27 };

		expect(
			isPointOccludedByGlobe(camera, { x: 0, y: 0, z: -11.25 }),
		).toBe(true);
		expect(
			isPointOccludedByGlobe(camera, { x: 0, y: 0, z: 11.25 }),
		).toBe(false);
		expect(
			isPointOccludedByGlobe(camera, { x: 11.25, y: 0, z: 0 }),
		).toBe(false);
	});
});
