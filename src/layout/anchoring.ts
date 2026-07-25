import {
	alignPositionBuffers,
	type Mat3,
	IDENTITY_ROTATION,
} from '../geometry/rotationAlignment';
import {
	geodesicClamp,
	geodesicDistance,
	tangentDirection,
} from '../geometry/sphericalGeometry';
import {
	readVec3,
	scaleVec3,
	writeVec3,
	type Vec3,
} from '../geometry/vector3';

export function anchorRestoringForce(
	position: Vec3,
	anchor: Vec3,
	strength: number,
	fallbackSalt = 0,
): Vec3 {
	if (!Number.isFinite(strength) || strength < 0) {
		throw new RangeError('Anchor strength must be finite and non-negative.');
	}
	if (strength === 0) {
		return [0, 0, 0];
	}
	const distance = geodesicDistance(position, anchor);
	return scaleVec3(
		tangentDirection(position, anchor, fallbackSalt),
		2 * strength * distance,
	);
}

export interface AnchorClampResult {
	readonly position: Vec3;
	readonly capped: boolean;
	readonly distanceBeforeClamp: number;
}

export function clampPositionToAnchor(
	position: Vec3,
	anchor: Vec3,
	maximumDistance: number,
	fallbackSalt = 0,
): AnchorClampResult {
	const distance = geodesicDistance(position, anchor);
	if (distance <= maximumDistance + 1e-12) {
		return {
			position,
			capped: false,
			distanceBeforeClamp: distance,
		};
	}
	return {
		position: geodesicClamp(
			position,
			anchor,
			maximumDistance,
			fallbackSalt,
		),
		capped: true,
		distanceBeforeClamp: distance,
	};
}

export interface FinalAnchorAlignmentResult {
	readonly positions: Float32Array;
	readonly rotation: Mat3;
	readonly applied: boolean;
	readonly meanDotBefore: number;
	readonly meanDotAfter: number;
}

/**
 * Applies a single proper rotation only when it improves anchor agreement and
 * preserves every old-node displacement cap. Skipping an unsafe rotation keeps
 * all internal geodesic distances unchanged as well.
 */
export function alignRefreshResultToAnchors(
	positions: Float32Array,
	anchorPositions: Float32Array,
	existingNodeMask: Uint8Array,
	maxAnchorDistances: Float32Array,
): FinalAnchorAlignmentResult {
	const count = positions.length / 3;
	if (
		positions.length % 3 !== 0 ||
		anchorPositions.length !== positions.length ||
		existingNodeMask.length !== count ||
		maxAnchorDistances.length !== count
	) {
		throw new RangeError('Final-alignment buffers have inconsistent lengths.');
	}
	const alignment = alignPositionBuffers(
		positions,
		anchorPositions,
		existingNodeMask,
	);
	if (alignment.meanDotAfter <= alignment.meanDotBefore + 1e-12) {
		return {
			positions,
			rotation: IDENTITY_ROTATION,
			applied: false,
			meanDotBefore: alignment.meanDotBefore,
			meanDotAfter: alignment.meanDotBefore,
		};
	}

	for (let index = 0; index < count; index += 1) {
		if (existingNodeMask[index] !== 1) {
			continue;
		}
		const maximumDistance =
			maxAnchorDistances[index] ?? Number.POSITIVE_INFINITY;
		if (
			geodesicDistance(
				readVec3(alignment.positions, index),
				readVec3(anchorPositions, index),
			) >
			maximumDistance + 2e-6
		) {
			return {
				positions,
				rotation: IDENTITY_ROTATION,
				applied: false,
				meanDotBefore: alignment.meanDotBefore,
				meanDotAfter: alignment.meanDotBefore,
			};
		}
	}
	return { ...alignment, applied: true };
}

export function clampPositionBufferToAnchors(
	positions: Float32Array,
	anchorPositions: Float32Array,
	existingNodeMask: Uint8Array,
	maxAnchorDistances: Float32Array,
): number {
	const count = positions.length / 3;
	if (
		positions.length % 3 !== 0 ||
		anchorPositions.length !== positions.length ||
		existingNodeMask.length !== count ||
		maxAnchorDistances.length !== count
	) {
		throw new RangeError('Anchor-clamp buffers have inconsistent lengths.');
	}
	let cappedCount = 0;
	for (let index = 0; index < count; index += 1) {
		if (existingNodeMask[index] !== 1) {
			continue;
		}
		const maximumDistance =
			maxAnchorDistances[index] ?? Number.POSITIVE_INFINITY;
		const result = clampPositionToAnchor(
			readVec3(positions, index),
			readVec3(anchorPositions, index),
			maximumDistance,
			index,
		);
		if (result.capped) {
			writeVec3(positions, index, result.position);
			cappedCount += 1;
		}
	}
	return cappedCount;
}
