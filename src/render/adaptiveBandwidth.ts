import { geodesicDistance } from '../geometry/sphericalGeometry';
import type { Vec3 } from '../geometry/vector3';

const MAXIMUM_CANDIDATE_EVALUATIONS_PER_MEMBER = 96;
const DUPLICATE_DISTANCE_EPSILON = 1e-7;

export interface AdaptiveBandwidthMember {
	readonly nodeIndex: number;
	readonly direction: Vec3;
}

export interface AdaptiveBandwidthOptions {
	readonly minimum: number;
	readonly maximum: number;
	readonly singleMember: number;
}

export interface AdaptiveBandwidthResult {
	readonly bandwidths: readonly number[];
	readonly candidateEvaluationCount: number;
	readonly maximumCandidateEvaluationsPerMember: number;
}

interface KdNode {
	readonly memberOffset: number;
	readonly axis: 0 | 1 | 2;
	readonly left?: KdNode;
	readonly right?: KdNode;
}

interface Neighbor {
	readonly memberOffset: number;
	readonly chordDistanceSquared: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.min(maximum, Math.max(minimum, value));
}

function median(values: readonly number[]): number {
	if (values.length === 0) {
		return 0;
	}
	const middle = Math.floor(values.length / 2);
	return values.length % 2 === 0
		? ((values[middle - 1] ?? 0) + (values[middle] ?? 0)) / 2
		: (values[middle] ?? 0);
}

function coordinate(
	member: AdaptiveBandwidthMember,
	axis: 0 | 1 | 2,
): number {
	return member.direction[axis];
}

function buildKdTree(
	members: readonly AdaptiveBandwidthMember[],
	offsets: readonly number[],
	depth = 0,
): KdNode | undefined {
	if (offsets.length === 0) {
		return undefined;
	}
	const axis = (depth % 3) as 0 | 1 | 2;
	const ordered = [...offsets].sort((leftOffset, rightOffset) => {
		const left = members[leftOffset];
		const right = members[rightOffset];
		if (left === undefined || right === undefined) {
			return leftOffset - rightOffset;
		}
		return (
			coordinate(left, axis) - coordinate(right, axis) ||
			left.nodeIndex - right.nodeIndex ||
			leftOffset - rightOffset
		);
	});
	const middle = Math.floor(ordered.length / 2);
	const memberOffset = ordered[middle];
	if (memberOffset === undefined) {
		return undefined;
	}
	return {
		memberOffset,
		axis,
		left: buildKdTree(members, ordered.slice(0, middle), depth + 1),
		right: buildKdTree(members, ordered.slice(middle + 1), depth + 1),
	};
}

function chordDistanceSquared(left: Vec3, right: Vec3): number {
	const x = left[0] - right[0];
	const y = left[1] - right[1];
	const z = left[2] - right[2];
	return x * x + y * y + z * z;
}

function insertNeighbor(
	neighbors: Neighbor[],
	candidate: Neighbor,
	members: readonly AdaptiveBandwidthMember[],
): void {
	let insertionIndex = 0;
	while (insertionIndex < neighbors.length) {
		const existing = neighbors[insertionIndex];
		if (existing === undefined) {
			break;
		}
		const distanceDelta =
			candidate.chordDistanceSquared -
			existing.chordDistanceSquared;
		const candidateNode =
			members[candidate.memberOffset]?.nodeIndex ?? candidate.memberOffset;
		const existingNode =
			members[existing.memberOffset]?.nodeIndex ?? existing.memberOffset;
		if (
			distanceDelta < -1e-15 ||
			(Math.abs(distanceDelta) <= 1e-15 &&
				candidateNode < existingNode)
		) {
			break;
		}
		insertionIndex += 1;
	}
	neighbors.splice(insertionIndex, 0, candidate);
	if (neighbors.length > 4) {
		neighbors.pop();
	}
}

function nearestNeighborOffsets(
	members: readonly AdaptiveBandwidthMember[],
	root: KdNode | undefined,
	queryOffset: number,
): {
	readonly offsets: readonly number[];
	readonly candidateEvaluationCount: number;
} {
	const query = members[queryOffset];
	if (query === undefined || root === undefined) {
		return { offsets: [], candidateEvaluationCount: 0 };
	}
	const neighbors: Neighbor[] = [];
	let candidateEvaluationCount = 0;

	const visit = (node: KdNode | undefined): void => {
		if (
			node === undefined ||
			candidateEvaluationCount >=
				MAXIMUM_CANDIDATE_EVALUATIONS_PER_MEMBER
		) {
			return;
		}
		const member = members[node.memberOffset];
		if (member === undefined) {
			return;
		}
		const delta =
			query.direction[node.axis] - member.direction[node.axis];
		const near = delta <= 0 ? node.left : node.right;
		const far = delta <= 0 ? node.right : node.left;
		visit(near);
		if (
			candidateEvaluationCount >=
				MAXIMUM_CANDIDATE_EVALUATIONS_PER_MEMBER
		) {
			return;
		}
		if (node.memberOffset !== queryOffset) {
			candidateEvaluationCount += 1;
			const distanceSquared = chordDistanceSquared(
				query.direction,
				member.direction,
			);
			if (
				distanceSquared >
				DUPLICATE_DISTANCE_EPSILON *
					DUPLICATE_DISTANCE_EPSILON
			) {
				insertNeighbor(
					neighbors,
					{
						memberOffset: node.memberOffset,
						chordDistanceSquared: distanceSquared,
					},
					members,
				);
			}
		}
		const farthestAccepted =
			neighbors.length < 4
				? Number.POSITIVE_INFINITY
				: (neighbors[neighbors.length - 1]
						?.chordDistanceSquared ??
					Number.POSITIVE_INFINITY);
		if (delta * delta <= farthestAccepted + 1e-15) {
			visit(far);
		}
	};

	visit(root);
	return {
		offsets: neighbors.map((neighbor) => neighbor.memberOffset),
		candidateEvaluationCount,
	};
}

/**
 * Estimates the local four-neighbor scale with a balanced three-dimensional
 * k-d tree. Chord and geodesic distance have the same ordering on a unit
 * sphere, so the tree can prune with cheap chord distances and evaluate the
 * original geodesic metric only for the retained neighbors.
 *
 * Pathological coincident inputs are bounded by a fixed per-member search
 * budget. Normal inputs remain exact whenever the tree can certify the four
 * nearest neighbors before that budget is exhausted.
 */
export function adaptiveBandwidths(
	members: readonly AdaptiveBandwidthMember[],
	options: AdaptiveBandwidthOptions,
): AdaptiveBandwidthResult {
	if (members.length === 0) {
		return {
			bandwidths: [],
			candidateEvaluationCount: 0,
			maximumCandidateEvaluationsPerMember:
				MAXIMUM_CANDIDATE_EVALUATIONS_PER_MEMBER,
		};
	}
	if (members.length === 1) {
		return {
			bandwidths: [options.singleMember],
			candidateEvaluationCount: 0,
			maximumCandidateEvaluationsPerMember:
				MAXIMUM_CANDIDATE_EVALUATIONS_PER_MEMBER,
		};
	}
	if (members.length === 2) {
		const first = members[0];
		const second = members[1];
		const distance =
			first === undefined || second === undefined
				? 0.35
				: geodesicDistance(first.direction, second.direction);
		const bandwidth =
			distance <= DUPLICATE_DISTANCE_EPSILON
				? options.singleMember
				: clamp(distance * 0.22, 0.068, 0.085);
		return {
			bandwidths: [bandwidth, bandwidth],
			candidateEvaluationCount: 2,
			maximumCandidateEvaluationsPerMember:
				MAXIMUM_CANDIDATE_EVALUATIONS_PER_MEMBER,
		};
	}

	const root = buildKdTree(
		members,
		members.map((_, index) => index),
	);
	const bandwidths = new Array<number>(members.length);
	let candidateEvaluationCount = 0;
	for (let offset = 0; offset < members.length; offset += 1) {
		const nearest = nearestNeighborOffsets(members, root, offset);
		candidateEvaluationCount += nearest.candidateEvaluationCount;
		const query = members[offset];
		const distances =
			query === undefined
				? []
				: nearest.offsets
						.map((neighborOffset) => members[neighborOffset])
						.filter(
							(
								member,
							): member is AdaptiveBandwidthMember =>
								member !== undefined,
						)
						.map((member) =>
							geodesicDistance(
								query.direction,
								member.direction,
							),
						)
						.sort((left, right) => left - right);
		bandwidths[offset] =
			distances.length === 0
				? options.singleMember
				: clamp(
						median(distances) * 0.62,
						options.minimum,
						options.maximum,
					);
	}
	return {
		bandwidths,
		candidateEvaluationCount,
		maximumCandidateEvaluationsPerMember:
			MAXIMUM_CANDIDATE_EVALUATIONS_PER_MEMBER,
	};
}
