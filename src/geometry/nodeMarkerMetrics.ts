import {
	BASE_NODE_MARKER_SIZE,
	DEFAULT_GLOBE_SIZE,
	NODE_SURFACE_LIFT,
	SPHERE_RADIUS,
} from '../constants';

export function nodeMarkerScaleForGlobe(globeSize: number): number {
	const safeGlobeSize =
		Number.isFinite(globeSize) && globeSize > 0
			? globeSize
			: DEFAULT_GLOBE_SIZE;
	return (
		(BASE_NODE_MARKER_SIZE * DEFAULT_GLOBE_SIZE) / safeGlobeSize
	);
}

export function nodeMarkerScale(
	globeSize: number,
	degree: number,
	sizeByDegree: boolean,
): number {
	const baseScale = nodeMarkerScaleForGlobe(globeSize);
	if (!sizeByDegree) {
		return baseScale;
	}
	const safeDegree =
		Number.isFinite(degree) && degree > 0 ? degree : 0;
	return (
		baseScale *
		(1 + Math.min(1.25, Math.log2(safeDegree + 1) * 0.22))
	);
}

/**
 * Converts the flat marker's rendered world-space radius into an intrinsic
 * angular radius on S². A small visual padding prevents adjacent antialiased
 * discs from appearing fused without reserving a uniform coastal inset.
 */
export function nodeCollisionAngularRadius(
	globeSize: number,
	degree: number,
	sizeByDegree: boolean,
	paddingScale = 1.12,
): number {
	const scale = nodeMarkerScale(
		globeSize,
		degree,
		sizeByDegree,
	);
	const safePadding =
		Number.isFinite(paddingScale) && paddingScale > 0
			? paddingScale
			: 1;
	return Math.atan2(
		scale * safePadding,
		SPHERE_RADIUS + NODE_SURFACE_LIFT,
	);
}
