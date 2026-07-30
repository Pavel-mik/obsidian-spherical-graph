import { hashNumbers } from '../geometry/deterministicHash';
import {
	computeSphericalCoverage,
	geodesicClamp,
	geodesicDistance,
	sphericalWeightedMean,
	tangentDirection,
} from '../geometry/sphericalGeometry';
import {
	clamp,
	normalizeVec3,
	orthogonalUnitVec3,
	readVec3,
	writeVec3,
} from '../geometry/vector3';
import {
	alignRefreshResultToAnchors,
} from './anchoring';
import { applyCoastalPortBias } from './coastalPortLayout';
import { projectSphericalCollisions } from './collisionProjection';
import { computeSphericalForces } from './forces';
import {
	resolveSolverSettings,
	type LayoutFinalDiagnostics,
	type LayoutPhase,
	type LayoutProgress,
	type LayoutSolveResult,
	type LayoutSolverInput,
	type RepulsionMode,
	type SolverSettings,
} from './layoutTypes';

export interface SolverAsyncOptions {
	readonly onProgress?: (progress: LayoutProgress) => void;
	readonly yieldControl?: () => Promise<void>;
	readonly now?: () => number;
}

export interface SolverSyncOptions {
	readonly onProgress?: (progress: LayoutProgress) => void;
	readonly now?: () => number;
}

export interface SolverStepSummary {
	readonly iteration: number;
	readonly phase: LayoutPhase;
	readonly finished: boolean;
	readonly cancelled: boolean;
	readonly maxAngularDisplacement: number;
}

function defaultNow(): number {
	return Date.now();
}

function defaultYieldControl(): Promise<void> {
	return new Promise((resolve) => {
		const channel = new MessageChannel();
		channel.port1.onmessage = () => {
			channel.port1.close();
			channel.port2.close();
			resolve();
		};
		channel.port2.postMessage(undefined);
	});
}

const MAXIMUM_FLOAT32_ANGLE = Math.fround(Math.PI - 1e-6);

function countMask(mask: Uint8Array): number {
	let count = 0;
	for (const value of mask) {
		if (value === 1) {
			count += 1;
		}
	}
	return count;
}

function validateAndNormalizePositions(
	positions: Float32Array,
): Float32Array {
	if (positions.length % 3 !== 0) {
		throw new RangeError('Position buffer length must be divisible by three.');
	}
	const normalized = new Float32Array(positions.length);
	for (let index = 0; index < positions.length / 3; index += 1) {
		writeVec3(normalized, index, normalizeVec3(readVec3(positions, index)));
	}
	return normalized;
}

function copyMaskOrFill(
	mask: Uint8Array | undefined,
	nodeCount: number,
): Uint8Array {
	if (mask === undefined) {
		const result = new Uint8Array(nodeCount);
		result.fill(1);
		return result;
	}
	if (mask.length !== nodeCount) {
		throw new RangeError('Movable mask must have one value per node.');
	}
	const result = mask.slice();
	for (let index = 0; index < result.length; index += 1) {
		result[index] = result[index] === 0 ? 0 : 1;
	}
	return result;
}

function normalizeRefreshAnchors(
	anchorPositions: Float32Array,
	existingNodeMask: Uint8Array,
	workingPositions: Float32Array,
): Float32Array {
	const result = new Float32Array(anchorPositions.length);
	for (let index = 0; index < existingNodeMask.length; index += 1) {
		writeVec3(
			result,
			index,
			existingNodeMask[index] === 1
				? normalizeVec3(readVec3(anchorPositions, index))
				: readVec3(workingPositions, index),
		);
	}
	return result;
}

export class SphericalSolver {
	readonly operationId: string;
	readonly mode: LayoutSolverInput['mode'];
	readonly graphSignature: string;
	readonly effectiveSeed: number;
	readonly settings: SolverSettings;

	private readonly positions: Float32Array;
	private readonly velocities: Float64Array;
	private readonly edgeEndpoints: Uint32Array;
	private readonly edgeWeights: Float32Array;
	private readonly edgeTargetAngles: Float32Array | undefined;
	private readonly folderIndexByNode: Int32Array | undefined;
	private readonly collisionAngularRadii: Float32Array | undefined;
	private readonly coastalPortScores: Float32Array | undefined;
	private readonly coastalPortDirections: Float32Array | undefined;
	private readonly baseMovableMask: Uint8Array;
	private readonly refresh: LayoutSolverInput['refresh'];
	private readonly cappedNodes: Uint8Array;
	private readonly startedAt: number;

	private iteration = 0;
	private phase: LayoutPhase = 'initial';
	private stableIterations = 0;
	private totalRepulsionPairs = 0;
	private maxAngularDisplacement = 0;
	private repulsionMode: RepulsionMode = 'exact';
	private converged = false;
	private finished = false;
	private cancelled = false;
	private finalResult: LayoutSolveResult | null = null;
	private collisionPasses = 0;
	private collisionRemainingOverlapCount = 0;
	private collisionMaximumPenetration = 0;

	constructor(input: LayoutSolverInput) {
		this.operationId = input.operationId;
		this.mode = input.mode;
		this.graphSignature = input.graphSignature;
		this.effectiveSeed = input.effectiveSeed >>> 0;
		this.settings = resolveSolverSettings(input.settings);
		this.positions = validateAndNormalizePositions(input.positions);
		const nodeCount = this.positions.length / 3;
		if (
			input.edgeEndpoints.length % 2 !== 0 ||
			input.edgeWeights.length * 2 !== input.edgeEndpoints.length
		) {
			throw new RangeError('Edge buffers have inconsistent lengths.');
		}
		for (const endpoint of input.edgeEndpoints) {
			if (endpoint >= nodeCount) {
				throw new RangeError('An edge endpoint is outside the node buffer.');
			}
		}
		this.edgeEndpoints = input.edgeEndpoints.slice();
		this.edgeWeights = input.edgeWeights.slice();
		if (
			input.edgeTargetAngles !== undefined &&
			input.edgeTargetAngles.length !== input.edgeWeights.length
		) {
			throw new RangeError(
				'Edge target angles must contain one value per edge.',
			);
		}
		this.edgeTargetAngles = input.edgeTargetAngles?.slice();
		if (
			input.folderIndexByNode !== undefined &&
			input.folderIndexByNode.length !== nodeCount
		) {
			throw new RangeError(
				'Folder ownership must contain one value per node.',
			);
		}
		this.folderIndexByNode = input.folderIndexByNode?.slice();
		if (
			input.collisionAngularRadii !== undefined &&
			input.collisionAngularRadii.length !== nodeCount
		) {
			throw new RangeError(
				'Collision radii must contain one value per node.',
			);
		}
		this.collisionAngularRadii =
			input.collisionAngularRadii?.slice();
		if (
			(input.coastalPortScores === undefined) !==
				(input.coastalPortDirections === undefined) ||
			(input.coastalPortScores !== undefined &&
				input.coastalPortScores.length !== nodeCount) ||
			(input.coastalPortDirections !== undefined &&
				input.coastalPortDirections.length !== nodeCount * 3)
		) {
			throw new RangeError(
				'Coastal port buffers must contain one score and direction per node.',
			);
		}
		this.coastalPortScores = input.coastalPortScores?.slice();
		this.coastalPortDirections =
			input.coastalPortDirections?.slice();
		this.velocities = new Float64Array(this.positions.length);
		this.cappedNodes = new Uint8Array(nodeCount);

		if (this.mode === 'refresh') {
			if (input.refresh === undefined) {
				throw new RangeError(
					'Refresh mode requires explicit refresh constraints.',
				);
			}
			this.validateRefreshConstraints(input.refresh, nodeCount);
			this.refresh = {
				existingNodeMask: input.refresh.existingNodeMask.slice(),
				newNodeMask: input.refresh.newNodeMask.slice(),
				relaxationMovableMask:
					input.refresh.relaxationMovableMask.slice(),
				anchorPositions: normalizeRefreshAnchors(
					input.refresh.anchorPositions,
					input.refresh.existingNodeMask,
					this.positions,
				),
				anchorStrengths: input.refresh.anchorStrengths.slice(),
				maxAnchorDistances:
					input.refresh.maxAnchorDistances.slice(),
				alignToAnchors: input.refresh.alignToAnchors,
			};
			this.baseMovableMask =
				this.refresh.relaxationMovableMask.slice();
		} else {
			// Initialize and renew intentionally ignore every anchor input.
			this.refresh = undefined;
			this.baseMovableMask = copyMaskOrFill(
				input.movableMask,
				nodeCount,
			);
		}
		this.startedAt = defaultNow();
	}

	private validateRefreshConstraints(
		refresh: NonNullable<LayoutSolverInput['refresh']>,
		nodeCount: number,
	): void {
		for (const mask of [
			refresh.existingNodeMask,
			refresh.newNodeMask,
			refresh.relaxationMovableMask,
			refresh.anchorStrengths,
			refresh.maxAnchorDistances,
		]) {
			if (mask.length !== nodeCount) {
				throw new RangeError(
					'Refresh constraints must contain one value per node.',
				);
			}
		}
		if (refresh.anchorPositions.length !== nodeCount * 3) {
			throw new RangeError(
				'Refresh anchor positions must have length 3N.',
			);
		}
		for (let index = 0; index < nodeCount; index += 1) {
			const strength = refresh.anchorStrengths[index] ?? 0;
			const maximumDistance =
				refresh.maxAnchorDistances[index] ?? 0;
			if (
				!Number.isFinite(strength) ||
				strength < 0 ||
				!Number.isFinite(maximumDistance) ||
				maximumDistance < 0
			) {
				throw new RangeError(
					'Anchor strengths and distances must be finite and non-negative.',
				);
			}
		}
	}

	cancel(): void {
		if (!this.finished) {
			this.cancelled = true;
		}
	}

	get isFinished(): boolean {
		return this.finished;
	}

	get isCancelled(): boolean {
		return this.cancelled;
	}

	get currentIteration(): number {
		return this.iteration;
	}

	get currentPhase(): LayoutPhase {
		return this.phase;
	}

	getPositionsSnapshot(): Float32Array {
		return this.positions.slice();
	}

	private warmupIterationCount(): number {
		if (this.refresh === undefined || countMask(this.refresh.newNodeMask) === 0) {
			return 0;
		}
		return Math.min(
			this.settings.refreshWarmupIterations,
			this.settings.maxIterations,
		);
	}

	private determinePhase(): LayoutPhase {
		if (this.mode !== 'refresh') {
			return 'initial';
		}
		return this.iteration < this.warmupIterationCount()
			? 'new-node-warmup'
			: 'anchored-relaxation';
	}

	private currentMovableMask(): Uint8Array {
		if (this.refresh === undefined) {
			return this.baseMovableMask;
		}
		return this.phase === 'new-node-warmup'
			? this.refresh.newNodeMask
			: this.refresh.relaxationMovableMask;
	}

	private integrate(
		forces: Float64Array,
		movableMask: Uint8Array,
	): number {
		const cooling =
			this.settings.stepSize *
			this.settings.coolingRate ** this.iteration;
		let maximumStep = 0;
		const nodeCount = this.positions.length / 3;
		for (let index = 0; index < nodeCount; index += 1) {
			if (movableMask[index] !== 1) {
				continue;
			}
			const offset = index * 3;
			const x = this.positions[offset] ?? 0;
			const y = this.positions[offset + 1] ?? 0;
			const z = this.positions[offset + 2] ?? 0;
			let velocityX =
				this.settings.damping * (this.velocities[offset] ?? 0) +
				cooling * (forces[offset] ?? 0);
			let velocityY =
				this.settings.damping *
					(this.velocities[offset + 1] ?? 0) +
				cooling * (forces[offset + 1] ?? 0);
			let velocityZ =
				this.settings.damping *
					(this.velocities[offset + 2] ?? 0) +
				cooling * (forces[offset + 2] ?? 0);

			const radial =
				x * velocityX + y * velocityY + z * velocityZ;
			velocityX -= radial * x;
			velocityY -= radial * y;
			velocityZ -= radial * z;
			let angularStep = Math.hypot(
				velocityX,
				velocityY,
				velocityZ,
			);
			if (angularStep > this.settings.maxAngularVelocity) {
				const scale =
					this.settings.maxAngularVelocity / angularStep;
				velocityX *= scale;
				velocityY *= scale;
				velocityZ *= scale;
				angularStep = this.settings.maxAngularVelocity;
			}

			let nextX = x;
			let nextY = y;
			let nextZ = z;
			if (angularStep > 1e-12) {
				const sineScale = Math.sin(angularStep) / angularStep;
				const cosine = Math.cos(angularStep);
				nextX = cosine * x + sineScale * velocityX;
				nextY = cosine * y + sineScale * velocityY;
				nextZ = cosine * z + sineScale * velocityZ;
			} else {
				nextX += velocityX;
				nextY += velocityY;
				nextZ += velocityZ;
			}
			const inverseNorm =
				1 / Math.max(1e-15, Math.hypot(nextX, nextY, nextZ));
			nextX *= inverseNorm;
			nextY *= inverseNorm;
			nextZ *= inverseNorm;

			if (
				this.refresh !== undefined &&
				this.phase === 'anchored-relaxation' &&
				this.refresh.existingNodeMask[index] === 1
			) {
				const anchorX =
					this.refresh.anchorPositions[offset] ?? 0;
				const anchorY =
					this.refresh.anchorPositions[offset + 1] ?? 0;
				const anchorZ =
					this.refresh.anchorPositions[offset + 2] ?? 0;
				const dot = clamp(
					anchorX * nextX +
						anchorY * nextY +
						anchorZ * nextZ,
					-1,
					1,
				);
				const crossX = anchorY * nextZ - anchorZ * nextY;
				const crossY = anchorZ * nextX - anchorX * nextZ;
				const crossZ = anchorX * nextY - anchorY * nextX;
				const distance = Math.atan2(
					Math.hypot(crossX, crossY, crossZ),
					dot,
				);
				const maximumDistance =
					this.refresh.maxAnchorDistances[index] ?? 0;
				if (distance > maximumDistance + 1e-12) {
					let tangentX = nextX - dot * anchorX;
					let tangentY = nextY - dot * anchorY;
					let tangentZ = nextZ - dot * anchorZ;
					const tangentNorm = Math.hypot(
						tangentX,
						tangentY,
						tangentZ,
					);
					if (tangentNorm > 1e-12) {
						tangentX /= tangentNorm;
						tangentY /= tangentNorm;
						tangentZ /= tangentNorm;
					} else {
						const fallback = orthogonalUnitVec3(
							[anchorX, anchorY, anchorZ],
							hashNumbers(this.effectiveSeed, index, 0xca9),
						);
						tangentX = fallback[0];
						tangentY = fallback[1];
						tangentZ = fallback[2];
					}
					const cosine = Math.cos(maximumDistance);
					const sine = Math.sin(maximumDistance);
					nextX = cosine * anchorX + sine * tangentX;
					nextY = cosine * anchorY + sine * tangentY;
					nextZ = cosine * anchorZ + sine * tangentZ;
					this.cappedNodes[index] = 1;
				}
			}
			this.positions[offset] = nextX;
			this.positions[offset + 1] = nextY;
			this.positions[offset + 2] = nextZ;
			const velocityRadial =
				nextX * velocityX +
				nextY * velocityY +
				nextZ * velocityZ;
			this.velocities[offset] =
				velocityX - velocityRadial * nextX;
			this.velocities[offset + 1] =
				velocityY - velocityRadial * nextY;
			this.velocities[offset + 2] =
				velocityZ - velocityRadial * nextZ;
			maximumStep = Math.max(maximumStep, angularStep);
		}
		return maximumStep;
	}

	step(iterationCount = 1): SolverStepSummary {
		if (!Number.isSafeInteger(iterationCount) || iterationCount <= 0) {
			throw new RangeError('iterationCount must be a positive integer.');
		}
		for (
			let localIteration = 0;
			localIteration < iterationCount &&
			!this.finished &&
			!this.cancelled;
			localIteration += 1
		) {
			if (this.iteration >= this.settings.maxIterations) {
				this.finished = true;
				break;
			}
			const nextPhase = this.determinePhase();
			if (nextPhase !== this.phase) {
				this.phase = nextPhase;
				this.velocities.fill(0);
				this.stableIterations = 0;
			} else {
				this.phase = nextPhase;
			}
			const movableMask = this.currentMovableMask();
			const forceEvaluation = computeSphericalForces({
				positions: this.positions,
				edgeEndpoints: this.edgeEndpoints,
				edgeWeights: this.edgeWeights,
				edgeTargetAngles: this.edgeTargetAngles,
				folderIndexByNode: this.folderIndexByNode,
				movableMask,
				settings: this.settings,
				effectiveSeed: this.effectiveSeed,
				iteration: this.iteration,
				anchorPositions:
					this.phase === 'anchored-relaxation'
						? this.refresh?.anchorPositions
						: undefined,
				anchorStrengths:
					this.phase === 'anchored-relaxation'
						? this.refresh?.anchorStrengths
						: undefined,
			});
			this.repulsionMode = forceEvaluation.repulsionMode;
			this.totalRepulsionPairs +=
				forceEvaluation.evaluatedRepulsionPairs;
			this.maxAngularDisplacement = this.integrate(
				forceEvaluation.forces,
				movableMask,
			);
			this.iteration += 1;

			const convergenceEligible =
				this.mode !== 'refresh' ||
				this.phase === 'anchored-relaxation';
			if (
				convergenceEligible &&
				this.maxAngularDisplacement <
					this.settings.convergenceTolerance
			) {
				this.stableIterations += 1;
			} else {
				this.stableIterations = 0;
			}
			if (
				this.stableIterations >= this.settings.convergenceWindow
			) {
				this.converged = true;
				this.finished = true;
			}
			if (this.iteration >= this.settings.maxIterations) {
				this.finished = true;
			}
		}

		return {
			iteration: this.iteration,
			phase: this.phase,
			finished: this.finished,
			cancelled: this.cancelled,
			maxAngularDisplacement: this.maxAngularDisplacement,
		};
	}

	private maximumNormError(): number {
		let maximum = 0;
		for (let index = 0; index < this.positions.length; index += 3) {
			const x = this.positions[index] ?? 0;
			const y = this.positions[index + 1] ?? 0;
			const z = this.positions[index + 2] ?? 0;
			maximum = Math.max(
				maximum,
				Math.abs(Math.hypot(x, y, z) - 1),
			);
		}
		return maximum;
	}

	private maximumExistingDisplacement(): number {
		if (this.refresh === undefined) {
			return 0;
		}
		let maximum = 0;
		for (
			let index = 0;
			index < this.refresh.existingNodeMask.length;
			index += 1
		) {
			if (this.refresh.existingNodeMask[index] !== 1) {
				continue;
			}
			maximum = Math.max(
				maximum,
				geodesicDistance(
					readVec3(this.positions, index),
					readVec3(this.refresh.anchorPositions, index),
				),
			);
		}
		return maximum;
	}

	private applyCollisionProjection(): void {
		if (this.collisionAngularRadii === undefined) {
			return;
		}
		const movableMask =
			this.refresh?.relaxationMovableMask ??
			this.baseMovableMask;
		let maximumAngularDisplacements: Float32Array | undefined;
		if (this.refresh !== undefined) {
			maximumAngularDisplacements =
				this.refresh.maxAnchorDistances.slice();
			for (
				let index = 0;
				index < maximumAngularDisplacements.length;
				index += 1
			) {
				if (this.refresh.existingNodeMask[index] !== 1) {
					maximumAngularDisplacements[index] =
						MAXIMUM_FLOAT32_ANGLE;
				}
			}
		}
		const collision = projectSphericalCollisions({
			positions: this.positions,
			angularRadii: this.collisionAngularRadii,
			movableMask,
			deterministicSeed: hashNumbers(
				this.effectiveSeed,
				0xc011,
			),
			anchorPositions: this.refresh?.anchorPositions,
			maximumAngularDisplacements,
			maxPasses: 48,
			tolerance: 2e-5,
			relaxation: 0.92,
		});
		this.positions.set(collision.positions);
		this.collisionPasses = collision.passes;
		this.collisionRemainingOverlapCount =
			collision.remainingOverlapCount;
		this.collisionMaximumPenetration =
			collision.maximumPenetration;
	}

	private applyCoastalPorts(): void {
		if (
			this.folderIndexByNode === undefined ||
			this.coastalPortScores === undefined ||
			this.coastalPortDirections === undefined
		) {
			return;
		}
		const currentDirections = this.coastalPortDirections.slice();
		const externalTargets = new Map<
			number,
			{ positions: ReturnType<typeof readVec3>[]; weights: number[] }
		>();
		const addExternalTarget = (
			portIndex: number,
			targetIndex: number,
			weight: number,
		): void => {
			if ((this.coastalPortScores?.[portIndex] ?? 0) <= 0) {
				return;
			}
			let targets = externalTargets.get(portIndex);
			if (targets === undefined) {
				targets = { positions: [], weights: [] };
				externalTargets.set(portIndex, targets);
			}
			targets.positions.push(readVec3(this.positions, targetIndex));
			targets.weights.push(Math.max(1e-6, weight));
		};
		for (
			let edgeIndex = 0;
			edgeIndex < this.edgeWeights.length;
			edgeIndex += 1
		) {
			if ((this.edgeTargetAngles?.[edgeIndex] ?? 0) > 0) {
				continue;
			}
			const source = this.edgeEndpoints[edgeIndex * 2];
			const target = this.edgeEndpoints[edgeIndex * 2 + 1];
			if (source === undefined || target === undefined) {
				continue;
			}
			const sourceOwner = this.folderIndexByNode[source] ?? -1;
			const targetOwner = this.folderIndexByNode[target] ?? -1;
			if (
				sourceOwner < 0 ||
				targetOwner < 0 ||
				sourceOwner === targetOwner
			) {
				continue;
			}
			const weight = this.edgeWeights[edgeIndex] ?? 1;
			addExternalTarget(source, target, weight);
			addExternalTarget(target, source, weight);
		}
		for (const [portIndex, targets] of externalTargets) {
			const destination = sphericalWeightedMean(
				targets.positions,
				targets.weights,
			);
			if (destination === null) {
				continue;
			}
			writeVec3(
				currentDirections,
				portIndex,
				tangentDirection(
					readVec3(this.positions, portIndex),
					destination,
					hashNumbers(
						this.effectiveSeed,
						portIndex,
						0xc0a57,
					),
				),
			);
		}
		const biased = applyCoastalPortBias(
			this.positions,
			this.folderIndexByNode,
			{
				portScores: this.coastalPortScores,
				portDirections: currentDirections,
			},
		);
		const movableMask =
			this.refresh?.relaxationMovableMask ??
			this.baseMovableMask;
		for (let index = 0; index < movableMask.length; index += 1) {
			if (movableMask[index] !== 1) {
				continue;
			}
			let position = readVec3(biased, index);
			if (
				this.refresh !== undefined &&
				this.refresh.existingNodeMask[index] === 1
			) {
				position = geodesicClamp(
					position,
					readVec3(this.refresh.anchorPositions, index),
					this.refresh.maxAnchorDistances[index] ?? 0,
					hashNumbers(
						this.effectiveSeed,
						index,
						0xc04a57,
					),
				);
			}
			writeVec3(this.positions, index, position);
		}
	}

	private diagnostics(
		now: number,
		finalizing: boolean,
	): LayoutFinalDiagnostics {
		const coverage = computeSphericalCoverage(this.positions);
		const movableMask = this.currentMovableMask();
		let anchoredNodeCount = 0;
		if (this.refresh !== undefined) {
			for (let index = 0; index < movableMask.length; index += 1) {
				if (
					movableMask[index] === 1 &&
					(this.refresh.anchorStrengths[index] ?? 0) > 0
				) {
					anchoredNodeCount += 1;
				}
			}
		}
		return {
			operationId: this.operationId,
			mode: this.mode,
			phase: finalizing ? 'finalizing' : this.phase,
			iteration: this.iteration,
			maxAngularDisplacement: this.maxAngularDisplacement,
			meanVectorNorm: coverage.meanVectorNorm,
			covarianceDiagonal: coverage.covarianceDiagonal,
			evaluatedRepulsionPairs: this.totalRepulsionPairs,
			movableNodeCount: countMask(movableMask),
			anchoredNodeCount,
			hardFixedNodeCount:
				movableMask.length - countMask(movableMask),
			cappedNodeCount: countMask(this.cappedNodes),
			maxExistingNodeDisplacement:
				this.maximumExistingDisplacement(),
			elapsedMs: Math.max(0, now - this.startedAt),
			converged: this.converged,
			maximumNormError: this.maximumNormError(),
			repulsionMode: this.repulsionMode,
			collisionPasses: this.collisionPasses,
			collisionRemainingOverlapCount:
				this.collisionRemainingOverlapCount,
			collisionMaximumPenetration:
				this.collisionMaximumPenetration,
		};
	}

	private finalize(now: number): LayoutSolveResult {
		if (this.finalResult !== null) {
			return this.finalResult;
		}
		if (this.cancelled) {
			this.finished = true;
			this.finalResult = {
				status: 'cancelled',
				diagnostics: this.diagnostics(now, true),
			};
			return this.finalResult;
		}

		if (
			this.refresh !== undefined &&
			this.refresh.alignToAnchors === true
		) {
			const hardFixedCount =
				this.refresh.relaxationMovableMask.length -
				countMask(this.refresh.relaxationMovableMask);
			if (hardFixedCount === 0) {
				const alignment = alignRefreshResultToAnchors(
					this.positions,
					this.refresh.anchorPositions,
					this.refresh.existingNodeMask,
					this.refresh.maxAnchorDistances,
				);
				if (alignment.applied) {
					this.positions.set(alignment.positions);
				}
			}
		}
		this.applyCoastalPorts();
		this.applyCollisionProjection();

		const maximumNormError = this.maximumNormError();
		if (!Number.isFinite(maximumNormError) || maximumNormError > 1e-5) {
			throw new RangeError(
				`Solver produced invalid unit vectors (max error ${maximumNormError}).`,
			);
		}
		this.finished = true;
		this.finalResult = {
			status: 'completed',
			positions: this.positions.slice(),
			diagnostics: this.diagnostics(now, true),
		};
		return this.finalResult;
	}

	solveSync(options: SolverSyncOptions = {}): LayoutSolveResult {
		const now = options.now ?? defaultNow;
		while (!this.finished && !this.cancelled) {
			this.step(1);
			if (
				this.iteration % this.settings.progressIntervalIterations ===
				0
			) {
				options.onProgress?.(this.diagnostics(now(), false));
			}
		}
		return this.finalize(now());
	}

	async solveAsync(
		options: SolverAsyncOptions = {},
	): Promise<LayoutSolveResult> {
		const now = options.now ?? defaultNow;
		const yieldControl = options.yieldControl ?? defaultYieldControl;
		let lastProgressAt = Number.NEGATIVE_INFINITY;
		while (!this.finished && !this.cancelled) {
			this.step(this.settings.batchSize);
			const currentTime = now();
			if (
				this.iteration % this.settings.progressIntervalIterations ===
					0 &&
				currentTime - lastProgressAt >=
					this.settings.progressIntervalMs
			) {
				options.onProgress?.(
					this.diagnostics(currentTime, false),
				);
				lastProgressAt = currentTime;
			}
			if (!this.finished && !this.cancelled) {
				await yieldControl();
			}
		}
		return this.finalize(now());
	}
}

export function solveSphericalLayout(
	input: LayoutSolverInput,
	options: SolverSyncOptions = {},
): LayoutSolveResult {
	return new SphericalSolver(input).solveSync(options);
}
