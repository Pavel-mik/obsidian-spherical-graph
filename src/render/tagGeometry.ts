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
import {
	exponentialMap,
	geodesicClamp,
	geodesicDistance,
	sphericalWeightedMean,
	tangentDirection,
} from '../geometry/sphericalGeometry';
import {
	addVec3,
	normalizeVec3,
	orthogonalUnitVec3,
	readVec3,
	scaleVec3,
	type Vec3,
} from '../geometry/vector3';

export interface Point3Like {
	readonly x: number;
	readonly y: number;
	readonly z: number;
}

export interface TagOrbitLayoutInput {
	readonly id: string;
	readonly nodeIndices: readonly number[];
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
 * Derives tag positions from the final committed note positions, then runs a
 * short intrinsic packing pass on S². Anchor attraction keeps private tags
 * above their note while local repulsion prevents stacks of overlapping
 * satellites. The calculation is deterministic and render-only.
 */
export function computeTagOrbitDirections(
	tags: readonly TagOrbitLayoutInput[],
	nodePositions: ArrayLike<number>,
): ReadonlyMap<string, Vec3> {
	const anchors: Vec3[] = [];
	const directions: Vec3[] = [];
	for (const tag of tags) {
		const nodeDirections = tag.nodeIndices
			.filter(
				(index) =>
					Number.isSafeInteger(index) &&
					index >= 0 &&
					index * 3 + 2 < nodePositions.length,
			)
			.map((index) => readVec3(nodePositions, index));
		const hash = hashString(tag.id);
		const anchor =
			sphericalWeightedMean(nodeDirections) ??
			nodeDirections[hash % Math.max(1, nodeDirections.length)] ??
			deterministicTagDirection(tag.id);
		anchors.push(anchor);
		directions.push(
			exponentialMap(
				anchor,
				scaleVec3(orthogonalUnitVec3(anchor, hash), 0.012),
			),
		);
	}
	if (directions.length <= 1) {
		return new Map(
			tags.map((tag, index) => [
				tag.id,
				directions[index] ?? deterministicTagDirection(tag.id),
			]),
		);
	}

	const desiredSpacing = Math.max(
		0.08,
		Math.min(
			0.18,
			Math.sqrt((4 * Math.PI) / directions.length) * 0.22,
		),
	);
	const exact = directions.length <= 256;
	const sampleCount = exact
		? directions.length - 1
		: Math.min(32, directions.length - 1);
	for (let iteration = 0; iteration < 42; iteration += 1) {
		const next: Vec3[] = [];
		for (let index = 0; index < directions.length; index += 1) {
			const current = directions[index] ?? anchors[index] ?? [1, 0, 0];
			const anchor = anchors[index] ?? current;
			const anchorAngle = geodesicDistance(current, anchor);
			let force = scaleVec3(
				tangentDirection(
					current,
					anchor,
					hashString(tags[index]?.id ?? ''),
				),
				anchorAngle * 0.82,
			);
			for (let sample = 0; sample < sampleCount; sample += 1) {
				const otherIndex = exact
					? sample >= index
						? sample + 1
						: sample
					: (index +
							1 +
							sample *
								(1 +
									(hashString(tags[index]?.id ?? '') %
										(directions.length - 1)))) %
						directions.length;
				if (otherIndex === index) {
					continue;
				}
				const other = directions[otherIndex];
				if (other === undefined) {
					continue;
				}
				const distance = geodesicDistance(current, other);
				if (distance >= desiredSpacing) {
					continue;
				}
				const away = scaleVec3(
					tangentDirection(
						current,
						other,
						hashString(
							`${tags[index]?.id}:${tags[otherIndex]?.id}`,
						),
					),
					-1,
				);
				force = addVec3(
					force,
					scaleVec3(
						away,
						(desiredSpacing - distance) *
							(exact ? 1.1 : 0.48),
					),
				);
			}
			const moved = exponentialMap(current, scaleVec3(force, 0.16));
			next.push(
				geodesicClamp(
					moved,
					anchor,
					0.3,
					hashString(tags[index]?.id ?? ''),
				),
			);
		}
		directions.splice(0, directions.length, ...next);
	}

	return new Map(
		tags.map((tag, index) => [
			tag.id,
			directions[index] ?? deterministicTagDirection(tag.id),
		]),
	);
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
