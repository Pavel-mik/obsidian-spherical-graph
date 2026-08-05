export type LayoutOperationMode = 'initialize' | 'refresh' | 'renew';

export type LayoutPhase =
	| 'initial'
	| 'new-node-warmup'
	| 'anchored-relaxation'
	| 'finalizing';

export type RepulsionMode = 'exact' | 'sampled';

export interface SolverSettings {
	readonly springStrength: number;
	readonly repulsionStrength: number;
	readonly centroidStrength: number;
	readonly isotropyStrength: number;
	readonly damping: number;
	readonly stepSize: number;
	readonly coolingRate: number;
	readonly maxAngularVelocity: number;
	readonly maxIterations: number;
	readonly convergenceTolerance: number;
	readonly convergenceWindow: number;
	readonly exactRepulsionThreshold: number;
	readonly negativeSamplesPerNode: number;
	readonly localRepulsionAngle: number;
	readonly repulsionCap: number;
	readonly targetSpacingScale: number;
	readonly minimumTargetAngle: number;
	readonly maximumTargetAngle: number;
	readonly progressIntervalIterations: number;
	readonly progressIntervalMs: number;
	readonly batchSize: number;
	readonly refreshWarmupIterations: number;
}

export const DEFAULT_SOLVER_SETTINGS: SolverSettings = {
	springStrength: 0.075,
	repulsionStrength: 0.0035,
	centroidStrength: 0.08,
	isotropyStrength: 0.06,
	damping: 0.82,
	stepSize: 0.08,
	coolingRate: 0.997,
	maxAngularVelocity: 0.075,
	maxIterations: 300,
	convergenceTolerance: 7.5e-5,
	convergenceWindow: 12,
	exactRepulsionThreshold: 400,
	negativeSamplesPerNode: 24,
	localRepulsionAngle: 0.22,
	repulsionCap: 0.45,
	targetSpacingScale: 0.82,
	minimumTargetAngle: 0.08,
	maximumTargetAngle: 1.15,
	progressIntervalIterations: 12,
	progressIntervalMs: 200,
	batchSize: 4,
	refreshWarmupIterations: 60,
};

export interface RefreshConstraints {
	/** One value per node; 1 means the node existed in the committed layout. */
	readonly existingNodeMask: Uint8Array;
	/** Only new nodes are movable during warm-up. */
	readonly newNodeMask: Uint8Array;
	/** New and locally affected old nodes movable in the second phase. */
	readonly relaxationMovableMask: Uint8Array;
	/** A normalized 3N buffer. Entries for new nodes are ignored. */
	readonly anchorPositions: Float32Array;
	/** Per-node geodesic anchor coefficient. New and fixed nodes use zero. */
	readonly anchorStrengths: Float32Array;
	/** Per-node maximum angular distance from the anchor, in radians. */
	readonly maxAnchorDistances: Float32Array;
	/** Align globally only when there are no hard-fixed old nodes. */
	readonly alignToAnchors?: boolean;
}

export interface LayoutDirectoryTerritory {
	readonly subdivision: number;
	readonly folderKeys: readonly string[];
	readonly ownerByCell: Int32Array;
}

export interface LayoutSolverInput {
	readonly operationId: string;
	readonly mode: LayoutOperationMode;
	readonly graphSignature: string;
	readonly effectiveSeed: number;
	readonly positions: Float32Array;
	readonly edgeEndpoints: Uint32Array;
	readonly edgeWeights: Float32Array;
	/**
	 * Optional explicit spring lengths. A non-positive value keeps the normal
	 * edge target; positive values are intrinsic angular distances on S².
	 */
	readonly edgeTargetAngles?: Float32Array;
	/** Stable top-level directory owner per node; -1 means ocean/root. */
	readonly folderIndexByNode?: Int32Array;
	/** Stable subdirectory/topology district owner per node; -1 means none. */
	readonly regionIndexByNode?: Int32Array;
	/** Render-aware angular marker radius used by the final collision pass. */
	readonly collisionAngularRadii?: Float32Array;
	/** Relative strength of selected coastal-port nodes. */
	readonly coastalPortScores?: Float32Array;
	/** Preferred tangent departure direction for each port, as a 3N buffer. */
	readonly coastalPortDirections?: Float32Array;
	/** Fixed connected land ownership allocated before note relaxation. */
	readonly territory?: LayoutDirectoryTerritory;
	readonly movableMask?: Uint8Array;
	readonly refresh?: RefreshConstraints;
	readonly settings?: Partial<SolverSettings>;
}

export interface LayoutProgress {
	readonly operationId: string;
	readonly mode: LayoutOperationMode;
	readonly phase: LayoutPhase;
	readonly iteration: number;
	readonly maxAngularDisplacement: number;
	readonly meanVectorNorm: number;
	readonly covarianceDiagonal: readonly [
		x: number,
		y: number,
		z: number,
	];
	readonly evaluatedRepulsionPairs: number;
	readonly movableNodeCount: number;
	readonly anchoredNodeCount: number;
	readonly hardFixedNodeCount: number;
	readonly cappedNodeCount: number;
	readonly maxExistingNodeDisplacement: number;
	readonly elapsedMs: number;
}

export interface LayoutFinalDiagnostics extends LayoutProgress {
	readonly converged: boolean;
	readonly maximumNormError: number;
	readonly repulsionMode: RepulsionMode;
	readonly collisionPasses?: number;
	readonly collisionRemainingOverlapCount?: number;
	readonly collisionMaximumPenetration?: number;
}

export interface LayoutCompletedResult {
	readonly status: 'completed';
	readonly positions: Float32Array;
	readonly diagnostics: LayoutFinalDiagnostics;
	readonly territory?: LayoutDirectoryTerritory;
}

export interface LayoutCancelledResult {
	readonly status: 'cancelled';
	readonly diagnostics: LayoutFinalDiagnostics;
}

export type LayoutSolveResult =
	| LayoutCompletedResult
	| LayoutCancelledResult;

const POSITIVE_NUMBER_KEYS = [
	'springStrength',
	'repulsionStrength',
	'centroidStrength',
	'isotropyStrength',
	'stepSize',
	'maxAngularVelocity',
	'convergenceTolerance',
	'localRepulsionAngle',
	'repulsionCap',
	'targetSpacingScale',
	'minimumTargetAngle',
	'maximumTargetAngle',
] as const satisfies readonly (keyof SolverSettings)[];

export function resolveSolverSettings(
	settings: Partial<SolverSettings> | undefined,
): SolverSettings {
	const merged: SolverSettings = {
		...DEFAULT_SOLVER_SETTINGS,
		...settings,
	};
	for (const key of POSITIVE_NUMBER_KEYS) {
		if (!Number.isFinite(merged[key]) || merged[key] < 0) {
			throw new RangeError(`${key} must be finite and non-negative.`);
		}
	}
	if (merged.damping < 0 || merged.damping >= 1) {
		throw new RangeError('damping must be in [0, 1).');
	}
	if (merged.coolingRate <= 0 || merged.coolingRate > 1) {
		throw new RangeError('coolingRate must be in (0, 1].');
	}
	const integerKeys = [
		'maxIterations',
		'convergenceWindow',
		'exactRepulsionThreshold',
		'negativeSamplesPerNode',
		'progressIntervalIterations',
		'progressIntervalMs',
		'batchSize',
		'refreshWarmupIterations',
	] as const satisfies readonly (keyof SolverSettings)[];
	for (const key of integerKeys) {
		if (!Number.isSafeInteger(merged[key]) || merged[key] < 0) {
			throw new RangeError(`${key} must be a non-negative integer.`);
		}
	}
	if (
		merged.maxIterations === 0 ||
		merged.convergenceWindow === 0 ||
		merged.progressIntervalIterations === 0 ||
		merged.batchSize === 0
	) {
		throw new RangeError(
			'Iteration, convergence, progress, and batch counts must be positive.',
		);
	}
	if (merged.minimumTargetAngle > merged.maximumTargetAngle) {
		throw new RangeError(
			'minimumTargetAngle cannot exceed maximumTargetAngle.',
		);
	}
	return merged;
}
