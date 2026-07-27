import {
	MAX_CAMERA_DISTANCE,
	MIN_CAMERA_DISTANCE,
} from '../constants';

const LABEL_FADE_SPAN_PERCENT = 18;
const LABEL_MIN_SCALE = 0.74;
const LABEL_MAX_SCALE = 1.08;
const LABEL_AREA_PER_ITEM = 15_000;
const MIN_VIEWPORT_LABEL_BUDGET = 8;

export interface LabelZoomVisuals {
	readonly opacity: number;
	readonly scale: number;
	readonly zoomPercent: number;
}

export function cameraZoomInPercent(cameraDistance: number): number {
	if (!Number.isFinite(cameraDistance)) {
		return 0;
	}
	const normalized =
		(MAX_CAMERA_DISTANCE - cameraDistance) /
		(MAX_CAMERA_DISTANCE - MIN_CAMERA_DISTANCE);
	return Math.max(0, Math.min(1, normalized)) * 100;
}

/**
 * Matches the core graph's visual rhythm: labels shrink while zooming out and
 * fade continuously instead of crossing an abrupt visibility threshold.
 */
export function labelZoomVisuals(
	cameraDistance: number,
	thresholdPercent: number,
): LabelZoomVisuals {
	const zoomPercent = cameraZoomInPercent(cameraDistance);
	const safeThreshold = Number.isFinite(thresholdPercent)
		? Math.max(0, Math.min(100, thresholdPercent))
		: 0;
	const fadeProgress = Math.max(
		0,
		Math.min(
			1,
			(zoomPercent - safeThreshold) / LABEL_FADE_SPAN_PERCENT,
		),
	);
	const opacity =
		fadeProgress * fadeProgress * (3 - 2 * fadeProgress);
	const scale =
		LABEL_MIN_SCALE +
		(LABEL_MAX_SCALE - LABEL_MIN_SCALE) * (zoomPercent / 100);
	return { opacity, scale, zoomPercent };
}

/**
 * Prevents narrow Obsidian panes from becoming a wall of overlapping labels.
 * User maxLabels remains the upper bound; this is a responsive display cap.
 */
export function labelBudgetForViewport(
	width: number,
	height: number,
): number {
	if (
		!Number.isFinite(width) ||
		!Number.isFinite(height) ||
		width <= 0 ||
		height <= 0
	) {
		return 0;
	}
	return Math.max(
		MIN_VIEWPORT_LABEL_BUDGET,
		Math.floor((width * height) / LABEL_AREA_PER_ITEM),
	);
}
