export const AUTO_ROTATION_RADIANS_PER_SECOND = 0.07;
const MAXIMUM_FRAME_DELTA_MS = 64;

export function automaticRotationAngle(deltaMs: number): number {
	if (!Number.isFinite(deltaMs) || deltaMs <= 0) {
		return 0;
	}
	return (
		(Math.min(MAXIMUM_FRAME_DELTA_MS, deltaMs) / 1000) *
		AUTO_ROTATION_RADIANS_PER_SECOND
	);
}
