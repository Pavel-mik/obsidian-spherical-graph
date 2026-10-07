import { geodesicDistance } from '../geometry/sphericalGeometry';
import { readVec3 } from '../geometry/vector3';
import type { RefreshConstraints } from './layoutTypes';

export type RefreshValidation = Pick<RefreshConstraints,
	'existingNodeMask' | 'relaxationMovableMask' | 'anchorPositions' | 'maxAnchorDistances'>;

/** Retain independent buffers before the solver input is transferred to a Worker. */
export function captureRefreshValidation(refresh: RefreshConstraints | undefined, nodeCount: number): RefreshValidation {
	if (refresh === undefined || refresh.existingNodeMask.length !== nodeCount ||
		refresh.relaxationMovableMask.length !== nodeCount || refresh.anchorPositions.length !== nodeCount * 3 ||
		refresh.maxAnchorDistances.length !== nodeCount) {
		throw new Error('Refresh preservation constraints are missing or invalid.');
	}
	return {
		existingNodeMask: refresh.existingNodeMask.slice(),
		relaxationMovableMask: refresh.relaxationMovableMask.slice(),
		anchorPositions: refresh.anchorPositions.slice(),
		maxAnchorDistances: refresh.maxAnchorDistances.slice(),
	};
}

export function respectsRefreshConstraints(positions: Float32Array, constraints: RefreshValidation): boolean {
	if (positions.length !== constraints.anchorPositions.length) return false;
	// Covers Float32 conversion and normalization, far below a visible movement.
	const tolerance = 1e-6;
	for (let index = 0; index < constraints.existingNodeMask.length; index++) {
		if (constraints.existingNodeMask[index] !== 1) continue;
		const limit = constraints.relaxationMovableMask[index] === 1
			? constraints.maxAnchorDistances[index] : 0;
		if (limit === undefined || !Number.isFinite(limit) || limit < 0) return false;
		const distance = geodesicDistance(readVec3(positions, index), readVec3(constraints.anchorPositions, index));
		if (!Number.isFinite(distance) || distance > limit + tolerance) return false;
	}
	return true;
}
