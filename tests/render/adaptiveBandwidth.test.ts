import { describe, expect, it } from 'vitest';
import { geodesicDistance } from '../../src/geometry/sphericalGeometry';
import { fibonacciSpherePoint } from '../../src/layout/initialization';
import {
	adaptiveBandwidths,
	type AdaptiveBandwidthMember,
	type AdaptiveBandwidthOptions,
} from '../../src/render/adaptiveBandwidth';

const options: AdaptiveBandwidthOptions = {
	minimum: 0.052,
	maximum: 0.118,
	singleMember: 0.08,
};

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.min(maximum, Math.max(minimum, value));
}

function exactBandwidths(
	members: readonly AdaptiveBandwidthMember[],
): readonly number[] {
	if (members.length <= 1) {
		return members.map(() => options.singleMember);
	}
	return members.map((member) => {
		const distances = members
			.map((candidate) =>
				geodesicDistance(member.direction, candidate.direction),
			)
			.filter((distance) => distance > 1e-7)
			.sort((left, right) => left - right);
		if (members.length === 2) {
			return clamp((distances[0] ?? 0.35) * 0.22, 0.068, 0.085);
		}
		const retained = distances.slice(0, Math.min(4, distances.length));
		const middle = Math.floor(retained.length / 2);
		const median =
			retained.length % 2 === 0
				? ((retained[middle - 1] ?? 0) +
						(retained[middle] ?? 0)) /
					2
				: (retained[middle] ?? 0);
		return retained.length === 0
			? options.singleMember
			: clamp(median * 0.62, options.minimum, options.maximum);
	});
}

function fibonacciMembers(count: number): readonly AdaptiveBandwidthMember[] {
	return Array.from({ length: count }, (_, nodeIndex) => ({
		nodeIndex,
		direction: fibonacciSpherePoint(nodeIndex, count),
	}));
}

describe('adaptive continent bandwidth', () => {
	it('matches the original all-pairs result on a representative exact fixture', () => {
		const members = fibonacciMembers(73);
		const expected = exactBandwidths(members);
		const actual = adaptiveBandwidths(members, options);
		const repeated = adaptiveBandwidths(members, options);

		expect(actual.bandwidths).toHaveLength(expected.length);
		expect(repeated).toEqual(actual);
		for (let index = 0; index < expected.length; index += 1) {
			expect(actual.bandwidths[index]).toBeCloseTo(
				expected[index] ?? 0,
				12,
			);
		}
	});

	it('bounds candidate work for a 5,000-member continent', () => {
		const members = fibonacciMembers(5_000);
		const result = adaptiveBandwidths(members, options);
		const maximumEvaluations =
			members.length *
			result.maximumCandidateEvaluationsPerMember;

		expect(result.candidateEvaluationCount).toBeLessThanOrEqual(
			maximumEvaluations,
		);
		expect(result.candidateEvaluationCount).toBeLessThan(
			members.length * members.length * 0.02,
		);
	});

	it('keeps coincident pathological input within the same linear work cap', () => {
		const members = Array.from({ length: 1_000 }, (_, nodeIndex) => ({
			nodeIndex,
			direction: [1, 0, 0] as const,
		}));
		const result = adaptiveBandwidths(members, options);

		expect(
			result.bandwidths.every(
				(bandwidth) => bandwidth === options.singleMember,
			),
		).toBe(true);
		expect(result.candidateEvaluationCount).toBeLessThanOrEqual(
			members.length *
				result.maximumCandidateEvaluationsPerMember,
		);
	});

	it('uses the single-member fallback for two coincident members', () => {
		const members = [
			{ nodeIndex: 0, direction: [1, 0, 0] as const },
			{ nodeIndex: 1, direction: [1, 0, 0] as const },
		];

		expect(adaptiveBandwidths(members, options).bandwidths).toEqual([
			options.singleMember,
			options.singleMember,
		]);
	});
});
