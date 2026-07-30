import { cameraZoomInPercent } from './labelVisibility';

/**
 * Keeps edge threshold semantics in the same 0–100 zoom coordinate system as
 * labels. The inclusive comparison avoids a one-frame flicker at the exact
 * threshold.
 */
export function edgesVisibleAtCameraDistance(
	cameraDistance: number,
	thresholdPercent: number,
): boolean {
	if (!Number.isFinite(cameraDistance)) {
		return false;
	}
	const safeThreshold = Number.isFinite(thresholdPercent)
		? Math.max(0, Math.min(100, thresholdPercent))
		: 50;
	return cameraZoomInPercent(cameraDistance) >= safeThreshold;
}
