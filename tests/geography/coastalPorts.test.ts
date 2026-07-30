import { describe, expect, it } from 'vitest';
import {
	scoreCoastalPortCandidates,
	selectSeparatedCoastalPorts,
	type CoastalPortCandidateInput,
	type CoastalPortExternalTarget,
} from '../../src/geography/coastalPorts';
import { normalizeVec3, type Vec3 } from '../../src/geometry/vector3';

const CONTINENT_CENTER: Vec3 = [1, 0, 0];
const NORTH: Vec3 = [0, 0, 1];

function target(
	destinationContinentId: string,
	weight: number,
	direction: Vec3 = NORTH,
): CoastalPortExternalTarget {
	return { destinationContinentId, weight, direction };
}

function candidate(
	nodeId: string,
	continentId: string,
	externalMass: number,
	totalIncidentWeight: number,
	externalTargets: readonly CoastalPortExternalTarget[] = [
		target('destination', externalMass),
	],
	position: Vec3 = CONTINENT_CENTER,
): CoastalPortCandidateInput {
	return {
		nodeId,
		continentId,
		position,
		continentCenter: CONTINENT_CENTER,
		totalIncidentWeight,
		externalTargets,
	};
}

describe('coastal port scoring', () => {
	it('uses robust relative ranks independently inside each continent', () => {
		const scored = scoreCoastalPortCandidates([
			candidate('a-low', 'a', 1, 2),
			candidate('a-mid', 'a', 10, 20),
			candidate('a-high', 'a', 100, 200),
			candidate('b-low', 'b', 0.01, 0.02),
			candidate('b-mid', 'b', 0.1, 0.2),
			candidate('b-high', 'b', 1, 2),
		]);
		const byId = new Map(scored.map((entry) => [entry.nodeId, entry]));

		expect(byId.get('a-low')?.externalMassPercentile).toBe(0);
		expect(byId.get('a-mid')?.externalMassPercentile).toBe(0.5);
		expect(byId.get('a-high')?.externalMassPercentile).toBe(1);
		expect(byId.get('b-low')?.score).toBeCloseTo(
			byId.get('a-low')?.score ?? Number.NaN,
		12,
		);
		expect(byId.get('b-mid')?.score).toBeCloseTo(
			byId.get('a-mid')?.score ?? Number.NaN,
			12,
		);
		expect(byId.get('b-high')?.score).toBeCloseTo(
			byId.get('a-high')?.score ?? Number.NaN,
			12,
		);
	});

	it('rewards destination diversity without replacing mass and share', () => {
		const scored = scoreCoastalPortCandidates([
			candidate('single', 'continent', 2, 4, [
				target('one', 2),
			]),
			candidate('diverse', 'continent', 2, 4, [
				target('one', 1),
				target('two', 1),
			]),
		]);
		const single = scored.find((entry) => entry.nodeId === 'single');
		const diverse = scored.find((entry) => entry.nodeId === 'diverse');

		expect(single?.destinationDiversity).toBe(0);
		expect(diverse?.destinationDiversity).toBeCloseTo(0.5, 12);
		expect(diverse?.relativeScore).toBeGreaterThan(
			single?.relativeScore ?? Number.POSITIVE_INFINITY,
		);
	});

	it('gates omnidirectional hubs while preserving a coherent coast bearing', () => {
		const scored = scoreCoastalPortCandidates([
			candidate('coherent', 'continent', 2, 2, [
				target('north', 2, NORTH),
			]),
			candidate('ambiguous', 'continent', 2, 2, [
				target('north', 1, NORTH),
				target('south', 1, [0, 0, -1]),
			]),
		]);
		const coherent = scored.find((entry) => entry.nodeId === 'coherent');
		const ambiguous = scored.find((entry) => entry.nodeId === 'ambiguous');

		expect(coherent?.directionCoherence).toBeCloseTo(1, 12);
		expect(coherent?.coherenceGate).toBe(1);
		expect(coherent?.preferredTangentDirection).toEqual(NORTH);
		expect(coherent?.coastBearing).toEqual(NORTH);
		expect(ambiguous?.directionCoherence).toBeCloseTo(0, 12);
		expect(ambiguous?.coherenceGate).toBe(0);
		expect(ambiguous?.score).toBe(0);
		expect(ambiguous?.coastBearing).toBeNull();
	});

	it('keeps notes without external roads ineligible', () => {
		const scored = scoreCoastalPortCandidates([
			candidate('inland', 'continent', 0, 4, []),
			candidate('port', 'continent', 2, 4),
		]);
		const inland = scored.find((entry) => entry.nodeId === 'inland');

		expect(inland?.externalMass).toBe(0);
		expect(inland?.relativeScore).toBe(0);
		expect(inland?.score).toBe(0);
		expect(inland?.coastBearing).toBeNull();
	});

	it('retains external mass when destination directions cancel', () => {
		const [scored] = scoreCoastalPortCandidates([
			candidate('ambiguous-destination', 'continent', 2, 4, [
				target('same-destination', 1, NORTH),
				target('same-destination', 1, [0, 0, -1]),
			]),
		]);

		expect(scored?.externalMass).toBe(2);
		expect(scored?.externalShare).toBe(0.5);
		expect(scored?.directionCoherence).toBe(0);
		expect(scored?.score).toBe(0);
	});

	it('is deterministic without mutating the caller order', () => {
		const inputs = [
			candidate('z', 'continent', 2, 5),
			candidate('a', 'continent', 3, 5),
		] as const;
		const first = scoreCoastalPortCandidates(inputs);
		const second = scoreCoastalPortCandidates(inputs);

		expect(first).toEqual(second);
		expect(first.map((entry) => entry.nodeId)).toEqual(['z', 'a']);
		expect(inputs.map((entry) => entry.nodeId)).toEqual(['z', 'a']);
	});
});

describe('separated coastal port selection', () => {
	it('enforces coast capacity and suppresses candidates with nearby bearings', () => {
		const closeToNorth = normalizeVec3([0, 0.1, 0.995]);
		const inputs = [
			candidate('d', 'continent', 2, 4, [
				target('west', 2, [0, -1, 0]),
			]),
			candidate('c', 'continent', 2, 4, [
				target('east', 2, [0, 1, 0]),
			]),
			candidate('b', 'continent', 2, 4, [
				target('near-north', 2, closeToNorth),
			]),
			candidate('a', 'continent', 2, 4, [
				target('north', 2, NORTH),
			]),
		];
		const scored = scoreCoastalPortCandidates(inputs);
		const selected = selectSeparatedCoastalPorts(scored, {
			capacity: 2,
			minimumAngularSeparation: 0.3,
		});
		const reversed = selectSeparatedCoastalPorts(
			scoreCoastalPortCandidates([...inputs].reverse()),
			{
				capacity: 2,
				minimumAngularSeparation: 0.3,
			},
		);

		expect(selected.map((entry) => entry.nodeId)).toEqual(['a', 'c']);
		expect(reversed.map((entry) => entry.nodeId)).toEqual(['a', 'c']);
	});

	it('can use current positions as the separation basis', () => {
		const scored = scoreCoastalPortCandidates([
			candidate(
				'a',
				'continent',
				2,
				4,
				[target('north', 2)],
				[1, 0, 0],
			),
			candidate(
				'b',
				'continent',
				2,
				4,
				[target('north', 2)],
				normalizeVec3([1, 0.4, 0]),
			),
		]);

		expect(
			selectSeparatedCoastalPorts(scored, {
				capacity: 2,
				minimumAngularSeparation: 0.2,
				separationBasis: 'coast-bearing',
			}),
		).toHaveLength(1);
		expect(
			selectSeparatedCoastalPorts(scored, {
				capacity: 2,
				minimumAngularSeparation: 0.2,
				separationBasis: 'position',
			}),
		).toHaveLength(2);
	});

	it('rejects a mixed-continent selection call', () => {
		const scored = scoreCoastalPortCandidates([
			candidate('a', 'a', 2, 4),
			candidate('b', 'b', 2, 4),
		]);

		expect(() =>
			selectSeparatedCoastalPorts(scored, {
				capacity: 2,
				minimumAngularSeparation: 0.2,
			}),
		).toThrow(/one continent/u);
	});
});
