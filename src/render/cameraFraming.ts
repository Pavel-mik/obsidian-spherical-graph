const DEFAULT_VERTICAL_FOV_DEGREES = 45;
const NARROW_HORIZONTAL_FOV_DEGREES = 52;
const MAX_RESPONSIVE_VERTICAL_FOV_DEGREES = 85;

/**
 * Keeps the globe's horizontal framing stable in narrow Obsidian panes.
 * Landscape panes retain the familiar 45° vertical field of view.
 */
export function verticalFovForAspect(aspect: number): number {
	if (!Number.isFinite(aspect) || aspect <= 0 || aspect >= 1) {
		return DEFAULT_VERTICAL_FOV_DEGREES;
	}
	const halfBaseRadians =
		(NARROW_HORIZONTAL_FOV_DEGREES * Math.PI) / 360;
	const responsive =
		(Math.atan(Math.tan(halfBaseRadians) / aspect) * 360) /
		Math.PI;
	return Math.min(MAX_RESPONSIVE_VERTICAL_FOV_DEGREES, responsive);
}
