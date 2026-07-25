import {
	DEFAULT_TAG_ORBIT_RADIUS,
	SPHERE_RADIUS,
	TAG_LINK_START_RADIUS,
} from '../constants';
import {
	DeterministicRandom,
	hashString,
} from '../geometry/deterministicHash';
import { slerp } from '../geometry/geodesicArc';
import { normalizeVec3, scaleVec3, type Vec3 } from '../geometry/vector3';

export interface Point3Like {
	readonly x: number;
	readonly y: number;
	readonly z: number;
}

export function deterministicTagDirection(tagId: string): Vec3 {
	const random = new DeterministicRandom(hashString(tagId));
	const y = random.next() * 2 - 1;
	const azimuth = random.next() * Math.PI * 2;
	const ringRadius = Math.sqrt(Math.max(0, 1 - y * y));
	return normalizeVec3([
		ringRadius * Math.cos(azimuth),
		y,
		ringRadius * Math.sin(azimuth),
	]);
}

/**
 * Samples a geodesic direction whose radius increases linearly from the note
 * surface to the invisible tag orbit. The result is a spherical spiral rather
 * than a straight chord through the globe.
 */
export function sampleTagSpiral(
	nodeDirection: Vec3,
	tagDirection: Vec3,
	segments: number,
	nodeId?: string,
	tagId?: string,
	orbitRadius = DEFAULT_TAG_ORBIT_RADIUS,
): Vec3[] {
	if (!Number.isSafeInteger(segments) || segments < 1) {
		throw new RangeError('segments must be a positive integer.');
	}
	if (
		!Number.isFinite(orbitRadius) ||
		orbitRadius <= TAG_LINK_START_RADIUS
	) {
		throw new RangeError(
			'orbitRadius must be above the tag-link start radius.',
		);
	}
	const points: Vec3[] = [];
	for (let segment = 0; segment <= segments; segment += 1) {
		const amount = segment / segments;
		const radius =
			TAG_LINK_START_RADIUS +
			(orbitRadius - TAG_LINK_START_RADIUS) * amount;
		points.push(
			scaleVec3(
				slerp(
					nodeDirection,
					tagDirection,
					amount,
					nodeId,
					tagId,
				),
				radius,
			),
		);
	}
	return points;
}

/**
 * Returns true when the segment from the camera to a tag meets the main globe
 * before it reaches the tag. This remains independent of the visual surface
 * mode, so hidden and transparent globes preserve spatial occlusion.
 */
export function isPointOccludedByGlobe(
	cameraPosition: Point3Like,
	point: Point3Like,
	sphereRadius = SPHERE_RADIUS,
): boolean {
	const rayX = point.x - cameraPosition.x;
	const rayY = point.y - cameraPosition.y;
	const rayZ = point.z - cameraPosition.z;
	const rayLengthSquared =
		rayX * rayX + rayY * rayY + rayZ * rayZ;
	if (
		!Number.isFinite(rayLengthSquared) ||
		rayLengthSquared <= 1e-12 ||
		!Number.isFinite(sphereRadius) ||
		sphereRadius <= 0
	) {
		return false;
	}

	const twiceProjection =
		2 *
		(cameraPosition.x * rayX +
			cameraPosition.y * rayY +
			cameraPosition.z * rayZ);
	const cameraDistanceSquared =
		cameraPosition.x * cameraPosition.x +
		cameraPosition.y * cameraPosition.y +
		cameraPosition.z * cameraPosition.z;
	const discriminant =
		twiceProjection * twiceProjection -
		4 *
			rayLengthSquared *
			(cameraDistanceSquared - sphereRadius * sphereRadius);
	if (discriminant <= 0) {
		return false;
	}

	const nearIntersection =
		(-twiceProjection - Math.sqrt(discriminant)) /
		(2 * rayLengthSquared);
	return nearIntersection > 1e-6 && nearIntersection < 1 - 1e-6;
}
