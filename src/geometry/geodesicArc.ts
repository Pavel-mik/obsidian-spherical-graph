import { hashUnorderedPair } from './deterministicHash';
import { ANGULAR_EPSILON, geodesicDistance } from './sphericalGeometry';
import {
	addVec3,
	clamp,
	normalizeVec3,
	orthogonalUnitVec3,
	scaleVec3,
	type Vec3,
} from './vector3';

const NEAR_IDENTICAL_ANGLE = 1e-7;
const NEAR_ANTIPODAL_ANGLE = 1e-6;

function endpointKey(vector: Vec3, explicitId: string | undefined): string {
	if (explicitId !== undefined) {
		return `id:${explicitId}`;
	}
	return `v:${vector[0].toPrecision(15)},${vector[1].toPrecision(15)},${vector[2].toPrecision(15)}`;
}

function antipodalTangent(
	start: Vec3,
	end: Vec3,
	startId: string | undefined,
	endId: string | undefined,
): Vec3 {
	const firstKey = endpointKey(start, startId);
	const secondKey = endpointKey(end, endId);
	const firstIsCanonical = firstKey <= secondKey;
	const canonicalStart = firstIsCanonical ? start : end;
	const salt = hashUnorderedPair(firstKey, secondKey);
	return orthogonalUnitVec3(canonicalStart, salt);
}

export function slerp(
	start: Vec3,
	end: Vec3,
	t: number,
	startId?: string,
	endId?: string,
): Vec3 {
	if (!Number.isFinite(t)) {
		throw new RangeError('SLERP parameter must be finite.');
	}
	const amount = clamp(t, 0, 1);
	const first = normalizeVec3(start);
	const second = normalizeVec3(end);
	if (amount === 0) {
		return first;
	}
	if (amount === 1) {
		return second;
	}

	const angle = geodesicDistance(first, second);
	if (angle < NEAR_IDENTICAL_ANGLE) {
		return normalizeVec3(
			addVec3(scaleVec3(first, 1 - amount), scaleVec3(second, amount)),
		);
	}

	if (Math.PI - angle < NEAR_ANTIPODAL_ANGLE) {
		const tangent = antipodalTangent(
			first,
			second,
			startId,
			endId,
		);
		const pathAngle = Math.PI * amount;
		return normalizeVec3(
			addVec3(
				scaleVec3(first, Math.cos(pathAngle)),
				scaleVec3(tangent, Math.sin(pathAngle)),
			),
		);
	}

	const denominator = Math.sin(angle);
	if (Math.abs(denominator) <= ANGULAR_EPSILON) {
		return normalizeVec3(
			addVec3(scaleVec3(first, 1 - amount), scaleVec3(second, amount)),
		);
	}
	const firstWeight = Math.sin((1 - amount) * angle) / denominator;
	const secondWeight = Math.sin(amount * angle) / denominator;
	return normalizeVec3(
		addVec3(
			scaleVec3(first, firstWeight),
			scaleVec3(second, secondWeight),
		),
	);
}

/**
 * Samples both endpoints and returns `segments + 1` surface points.
 */
export function sampleGeodesicArc(
	start: Vec3,
	end: Vec3,
	segments: number,
	radius = 1,
	startId?: string,
	endId?: string,
): Vec3[] {
	if (!Number.isSafeInteger(segments) || segments < 1) {
		throw new RangeError('segments must be a positive integer.');
	}
	if (!Number.isFinite(radius) || radius <= 0) {
		throw new RangeError('radius must be finite and positive.');
	}

	const samples: Vec3[] = [];
	for (let segment = 0; segment <= segments; segment += 1) {
		const point = slerp(
			start,
			end,
			segment / segments,
			startId,
			endId,
		);
		samples.push(scaleVec3(point, radius));
	}
	return samples;
}
