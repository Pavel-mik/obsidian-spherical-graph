import { hashString } from '../geometry/deterministicHash';
import {
	exponentialMap,
	sphericalWeightedMean,
} from '../geometry/sphericalGeometry';
import {
	orthogonalUnitVec3,
	scaleVec3,
	type Vec3,
} from '../geometry/vector3';
import { deterministicTagDirection } from './tagGeometry';

const AUXILIARY_OFFSET_RADIANS = 0.052;

/**
 * Places an attachment or unresolved target close to the already committed
 * notes that reference it. This is a render-only derivation and never changes
 * the note layout.
 */
export function auxiliaryDirectionFromAnchors(
	nodeId: string,
	anchors: readonly Vec3[],
): Vec3 {
	if (anchors.length === 0) {
		return deterministicTagDirection(`auxiliary:${nodeId}`);
	}
	const hash = hashString(nodeId);
	const mean =
		sphericalWeightedMean(anchors) ??
		anchors[hash % anchors.length] ??
		deterministicTagDirection(`auxiliary:${nodeId}`);
	const tangent = orthogonalUnitVec3(mean, hash);
	const crowdingScale = 1 + Math.min(1.5, Math.log2(anchors.length + 1) * 0.2);
	return exponentialMap(
		mean,
		scaleVec3(tangent, AUXILIARY_OFFSET_RADIANS * crowdingScale),
	);
}
