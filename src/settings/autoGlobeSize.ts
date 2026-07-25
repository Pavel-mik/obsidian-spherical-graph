const MIN_AUTO_GLOBE_SIZE = 60;
const MAX_AUTO_GLOBE_SIZE = 400;
const REFERENCE_NODE_COUNT = 100;
const REFERENCE_GLOBE_SIZE = 100;
const GLOBE_SIZE_STEP = 5;

/**
 * Keeps markers readable across vault sizes without making medium and large
 * vaults diverge too aggressively. The fourth-root curve grows smoothly:
 * 100 notes map to 100, 1,000 notes to about 180, with safe UI bounds.
 */
export function autoGlobeSizeForNodeCount(nodeCount: number): number {
	const safeNodeCount =
		Number.isFinite(nodeCount) && nodeCount > 0
			? nodeCount
			: 1;
	const raw =
		REFERENCE_GLOBE_SIZE *
		Math.pow(safeNodeCount / REFERENCE_NODE_COUNT, 0.25);
	const stepped =
		Math.round(raw / GLOBE_SIZE_STEP) * GLOBE_SIZE_STEP;
	return Math.min(
		MAX_AUTO_GLOBE_SIZE,
		Math.max(MIN_AUTO_GLOBE_SIZE, stepped),
	);
}

export function shouldAutoSizeGlobe(
	mode: 'initialize' | 'refresh' | 'renew',
): boolean {
	return mode === 'initialize' || mode === 'renew';
}
