import {
	hashNumbers,
	hashToUnitFloat,
} from '../geometry/deterministicHash';
import {
	clamp,
	orthogonalUnitVec3,
	readVec3,
	type Vec3,
} from '../geometry/vector3';
import { SphericalSpatialHash } from './spatialHash';
import type {
	RepulsionMode,
	SolverSettings,
} from './layoutTypes';

export interface ForceEvaluationInput {
	readonly positions: Float32Array;
	readonly edgeEndpoints: Uint32Array;
	readonly edgeWeights: Float32Array;
	readonly edgeTargetAngles?: Float32Array;
	readonly folderIndexByNode?: Int32Array;
	readonly movableMask: Uint8Array;
	readonly settings: SolverSettings;
	readonly effectiveSeed: number;
	readonly iteration: number;
	readonly anchorPositions?: Float32Array;
	readonly anchorStrengths?: Float32Array;
}

export interface ForceEvaluation {
	readonly forces: Float64Array;
	readonly evaluatedRepulsionPairs: number;
	readonly repulsionMode: RepulsionMode;
	readonly springEnergy: number;
	readonly coverageEnergy: number;
}

function addDirectedTangentForce(
	forces: Float64Array,
	nodeIndex: number,
	fromX: number,
	fromY: number,
	fromZ: number,
	toX: number,
	toY: number,
	toZ: number,
	magnitude: number,
	fallbackSalt: number,
): void {
	const dot = clamp(fromX * toX + fromY * toY + fromZ * toZ, -1, 1);
	let tangentX = toX - dot * fromX;
	let tangentY = toY - dot * fromY;
	let tangentZ = toZ - dot * fromZ;
	const tangentLength = Math.hypot(tangentX, tangentY, tangentZ);
	if (tangentLength > 1e-11) {
		const inverseLength = 1 / tangentLength;
		tangentX *= inverseLength;
		tangentY *= inverseLength;
		tangentZ *= inverseLength;
	} else {
		const fallback = orthogonalUnitVec3(
			[fromX, fromY, fromZ],
			fallbackSalt,
		);
		tangentX = fallback[0];
		tangentY = fallback[1];
		tangentZ = fallback[2];
	}
	const offset = nodeIndex * 3;
	forces[offset] = (forces[offset] ?? 0) + tangentX * magnitude;
	forces[offset + 1] =
		(forces[offset + 1] ?? 0) + tangentY * magnitude;
	forces[offset + 2] =
		(forces[offset + 2] ?? 0) + tangentZ * magnitude;
}

function angularDistanceComponents(
	ax: number,
	ay: number,
	az: number,
	bx: number,
	by: number,
	bz: number,
): number {
	const crossX = ay * bz - az * by;
	const crossY = az * bx - ax * bz;
	const crossZ = ax * by - ay * bx;
	const crossLength = Math.hypot(crossX, crossY, crossZ);
	const dot = clamp(ax * bx + ay * by + az * bz, -1, 1);
	return Math.atan2(crossLength, dot);
}

function applyRepulsionPair(
	input: ForceEvaluationInput,
	forces: Float64Array,
	first: number,
	second: number,
	firstOnly: boolean,
	scale = 1,
): void {
	const firstOffset = first * 3;
	const secondOffset = second * 3;
	const ax = input.positions[firstOffset] ?? 0;
	const ay = input.positions[firstOffset + 1] ?? 0;
	const az = input.positions[firstOffset + 2] ?? 0;
	const bx = input.positions[secondOffset] ?? 0;
	const by = input.positions[secondOffset + 1] ?? 0;
	const bz = input.positions[secondOffset + 2] ?? 0;
	const dot = clamp(ax * bx + ay * by + az * bz, -1, 1);
	const crossX = ay * bz - az * by;
	const crossY = az * bx - ax * bz;
	const crossZ = ax * by - ay * bx;
	const sine = Math.hypot(crossX, crossY, crossZ);
	const denominator = Math.max(1e-8, 1 - dot);
	const cotangentHalfAngle = sine / denominator;
	const angle = Math.atan2(sine, dot);
	const nodeCount = input.positions.length / 3;
	const collisionAngle = clamp(
		0.58 * Math.sqrt((4 * Math.PI) / Math.max(1, nodeCount)),
		input.settings.minimumTargetAngle * 0.55,
		input.settings.localRepulsionAngle * 0.7,
	);
	const collisionOverlap = Math.max(
		0,
		(collisionAngle - angle) / Math.max(1e-8, collisionAngle),
	);
	const magnitude = Math.min(
		input.settings.repulsionCap,
		input.settings.repulsionStrength * cotangentHalfAngle * scale +
			input.settings.repulsionCap *
				0.72 *
				collisionOverlap *
				collisionOverlap,
	);
	const salt = hashNumbers(input.effectiveSeed, first, second, 0x5e9);
	if (input.movableMask[first] === 1) {
		addDirectedTangentForce(
			forces,
			first,
			ax,
			ay,
			az,
			bx,
			by,
			bz,
			-magnitude,
			salt,
		);
	}
	if (!firstOnly && input.movableMask[second] === 1) {
		addDirectedTangentForce(
			forces,
			second,
			bx,
			by,
			bz,
			ax,
			ay,
			az,
			-magnitude,
			salt ^ 4,
		);
	}
}

function accumulateSprings(
	input: ForceEvaluationInput,
	forces: Float64Array,
): number {
	const nodeCount = input.positions.length / 3;
	if (nodeCount <= 1) {
		return 0;
	}
	const baseTarget = clamp(
		input.settings.targetSpacingScale *
			Math.sqrt((4 * Math.PI) / nodeCount),
		input.settings.minimumTargetAngle,
		input.settings.maximumTargetAngle,
	);
	let energy = 0;
	for (
		let edgeIndex = 0;
		edgeIndex < input.edgeWeights.length;
		edgeIndex += 1
	) {
		const source = input.edgeEndpoints[edgeIndex * 2];
		const target = input.edgeEndpoints[edgeIndex * 2 + 1];
		if (
			source === undefined ||
			target === undefined ||
			source === target ||
			source >= nodeCount ||
			target >= nodeCount ||
			(input.movableMask[source] !== 1 &&
				input.movableMask[target] !== 1)
		) {
			continue;
		}
		const sourceOffset = source * 3;
		const targetOffset = target * 3;
		const ax = input.positions[sourceOffset] ?? 0;
		const ay = input.positions[sourceOffset + 1] ?? 0;
		const az = input.positions[sourceOffset + 2] ?? 0;
		const bx = input.positions[targetOffset] ?? 0;
		const by = input.positions[targetOffset + 1] ?? 0;
		const bz = input.positions[targetOffset + 2] ?? 0;
		const angle = angularDistanceComponents(ax, ay, az, bx, by, bz);
		const rawWeight = input.edgeWeights[edgeIndex] ?? 1;
		const weight =
			Number.isFinite(rawWeight) && rawWeight > 0 ? rawWeight : 1;
		const weightFactor = Math.sqrt(weight);
		const organicTargetScale =
			0.7 +
			hashToUnitFloat(
				input.effectiveSeed,
				Math.min(source, target),
				Math.max(source, target),
				0x0ed6,
			) *
				0.6;
		const explicitTarget =
			input.edgeTargetAngles?.[edgeIndex] ?? 0;
		const targetAngle =
			Number.isFinite(explicitTarget) && explicitTarget > 0
				? clamp(
						explicitTarget,
						input.settings.minimumTargetAngle * 0.5,
						input.settings.maximumTargetAngle,
					)
				: clamp(
						(baseTarget * organicTargetScale) /
							(1 + 0.12 * Math.log1p(weight)),
						input.settings.minimumTargetAngle * 0.72,
						input.settings.maximumTargetAngle,
					);
		const extension = angle - targetAngle;
		const magnitude =
			input.settings.springStrength * weightFactor * extension;
		const salt = hashNumbers(
			input.effectiveSeed,
			source,
			target,
			0x51a,
		);
		if (input.movableMask[source] === 1) {
			addDirectedTangentForce(
				forces,
				source,
				ax,
				ay,
				az,
				bx,
				by,
				bz,
				magnitude,
				salt,
			);
		}
		if (input.movableMask[target] === 1) {
			addDirectedTangentForce(
				forces,
				target,
				bx,
				by,
				bz,
				ax,
				ay,
				az,
				magnitude,
				salt ^ 4,
			);
		}
		energy +=
			0.5 *
			input.settings.springStrength *
			weightFactor *
			extension *
			extension;
	}
	return energy;
}

function accumulateExactRepulsion(
	input: ForceEvaluationInput,
	forces: Float64Array,
): number {
	const nodeCount = input.positions.length / 3;
	let pairCount = 0;
	for (let first = 0; first < nodeCount; first += 1) {
		for (let second = first + 1; second < nodeCount; second += 1) {
			if (
				input.movableMask[first] !== 1 &&
				input.movableMask[second] !== 1
			) {
				continue;
			}
			applyRepulsionPair(input, forces, first, second, false);
			pairCount += 1;
		}
	}
	return pairCount;
}

function accumulateSampledRepulsion(
	input: ForceEvaluationInput,
	forces: Float64Array,
): number {
	const nodeCount = input.positions.length / 3;
	if (nodeCount <= 1) {
		return 0;
	}
	let pairCount = 0;
	const localHash = new SphericalSpatialHash(
		Math.max(
			1e-4,
			2 * Math.sin(input.settings.localRepulsionAngle / 2),
		),
	);
	pairCount += localHash.forEachPairWithinAngle(
		input.positions,
		input.settings.localRepulsionAngle,
		input.movableMask,
		(first, second) => {
			applyRepulsionPair(input, forces, first, second, false);
		},
	);

	const sampleCount = input.settings.negativeSamplesPerNode;
	if (sampleCount === 0) {
		return pairCount;
	}
	for (let first = 0; first < nodeCount; first += 1) {
		if (input.movableMask[first] !== 1) {
			continue;
		}
		for (let sample = 0; sample < sampleCount; sample += 1) {
			let second =
				hashNumbers(
					input.effectiveSeed,
					input.iteration,
					first,
					sample,
					0x9e6,
				) %
				(nodeCount - 1);
			if (second >= first) {
				second += 1;
			}
			applyRepulsionPair(input, forces, first, second, true);
			pairCount += 1;
		}
	}
	return pairCount;
}

function accumulateCoverageRegularizers(
	input: ForceEvaluationInput,
	forces: Float64Array,
): number {
	const nodeCount = input.positions.length / 3;
	if (nodeCount === 0) {
		return 0;
	}
	/*
	 * Directory continents are the macro bodies that should cover the globe.
	 * Treating every note as an independent coverage sample pulls one large
	 * folder into a sphere-spanning disc and recreates the concentric rings we
	 * are trying to remove. Folder centroids therefore vote once each, while
	 * root notes remain individual islands.
	 */
	const ownerByNode = new Int32Array(nodeCount);
	const ownerMembers = new Map<number, number[]>();
	for (let index = 0; index < nodeCount; index += 1) {
		const folder = input.folderIndexByNode?.[index] ?? -1;
		const owner = folder >= 0 ? folder : -(index + 1);
		ownerByNode[index] = owner;
		const members = ownerMembers.get(owner);
		if (members === undefined) {
			ownerMembers.set(owner, [index]);
		} else {
			members.push(index);
		}
	}
	const groupCenters = new Map<number, Vec3>();
	for (const [owner, members] of ownerMembers) {
		let sumX = 0;
		let sumY = 0;
		let sumZ = 0;
		for (const index of members) {
			const offset = index * 3;
			sumX += input.positions[offset] ?? 0;
			sumY += input.positions[offset + 1] ?? 0;
			sumZ += input.positions[offset + 2] ?? 0;
		}
		const norm = Math.hypot(sumX, sumY, sumZ);
		groupCenters.set(
			owner,
			norm > 1e-10
				? [sumX / norm, sumY / norm, sumZ / norm]
				: readVec3(input.positions, members[0] ?? 0),
		);
	}
	const centers = [...groupCenters.values()];
	const sampleCount = centers.length;
	if (sampleCount <= 1) {
		return 0;
	}
	let meanX = 0;
	let meanY = 0;
	let meanZ = 0;
	let c00 = 0;
	let c01 = 0;
	let c02 = 0;
	let c11 = 0;
	let c12 = 0;
	let c22 = 0;
	for (const [x, y, z] of centers) {
		meanX += x;
		meanY += y;
		meanZ += z;
		c00 += x * x;
		c01 += x * y;
		c02 += x * z;
		c11 += y * y;
		c12 += y * z;
		c22 += z * z;
	}
	const inverseCount = 1 / sampleCount;
	meanX *= inverseCount;
	meanY *= inverseCount;
	meanZ *= inverseCount;
	c00 = c00 * inverseCount - 1 / 3;
	c01 *= inverseCount;
	c02 *= inverseCount;
	c11 = c11 * inverseCount - 1 / 3;
	c12 *= inverseCount;
	c22 = c22 * inverseCount - 1 / 3;

	for (let index = 0; index < nodeCount; index += 1) {
		if (input.movableMask[index] !== 1) {
			continue;
		}
		const offset = index * 3;
		const x = input.positions[offset] ?? 0;
		const y = input.positions[offset + 1] ?? 0;
		const z = input.positions[offset + 2] ?? 0;
		const center =
			groupCenters.get(ownerByNode[index] ?? -(index + 1)) ??
			([x, y, z] as Vec3);
		const centerX = center[0];
		const centerY = center[1];
		const centerZ = center[2];

		const meanRadial =
			centerX * meanX + centerY * meanY + centerZ * meanZ;
		const meanForceX = -input.settings.centroidStrength *
			(meanX - meanRadial * centerX);
		const meanForceY = -input.settings.centroidStrength *
			(meanY - meanRadial * centerY);
		const meanForceZ = -input.settings.centroidStrength *
			(meanZ - meanRadial * centerZ);

		const gradientX =
			c00 * centerX + c01 * centerY + c02 * centerZ;
		const gradientY =
			c01 * centerX + c11 * centerY + c12 * centerZ;
		const gradientZ =
			c02 * centerX + c12 * centerY + c22 * centerZ;
		const gradientRadial =
			centerX * gradientX +
			centerY * gradientY +
			centerZ * gradientZ;
		const isotropyScale = 4 * input.settings.isotropyStrength;
		const centerForceX =
			meanForceX -
			isotropyScale *
				(gradientX - gradientRadial * centerX);
		const centerForceY =
			meanForceY -
			isotropyScale *
				(gradientY - gradientRadial * centerY);
		const centerForceZ =
			meanForceZ -
			isotropyScale *
				(gradientZ - gradientRadial * centerZ);
		/*
		 * Convert the desired center tangent into one angular-velocity field
		 * for the whole folder. omega × u is a rigid infinitesimal rotation,
		 * so macro coverage does not radially inflate or shear the continent.
		 */
		const omegaX =
			centerY * centerForceZ - centerZ * centerForceY;
		const omegaY =
			centerZ * centerForceX - centerX * centerForceZ;
		const omegaZ =
			centerX * centerForceY - centerY * centerForceX;
		forces[offset] =
			(forces[offset] ?? 0) + omegaY * z - omegaZ * y;
		forces[offset + 1] =
			(forces[offset + 1] ?? 0) + omegaZ * x - omegaX * z;
		forces[offset + 2] =
			(forces[offset + 2] ?? 0) + omegaX * y - omegaY * x;
	}

	const meanEnergy = meanX * meanX + meanY * meanY + meanZ * meanZ;
	const isotropyEnergy =
		c00 * c00 +
		c11 * c11 +
		c22 * c22 +
		2 * (c01 * c01 + c02 * c02 + c12 * c12);
	return (
		input.settings.centroidStrength * meanEnergy +
		input.settings.isotropyStrength * isotropyEnergy
	);
}

function accumulateAnchors(
	input: ForceEvaluationInput,
	forces: Float64Array,
): void {
	if (
		input.anchorPositions === undefined ||
		input.anchorStrengths === undefined
	) {
		return;
	}
	const nodeCount = input.positions.length / 3;
	for (let index = 0; index < nodeCount; index += 1) {
		const strength = input.anchorStrengths[index] ?? 0;
		if (input.movableMask[index] !== 1 || strength <= 0) {
			continue;
		}
		const offset = index * 3;
		const ax = input.positions[offset] ?? 0;
		const ay = input.positions[offset + 1] ?? 0;
		const az = input.positions[offset + 2] ?? 0;
		const bx = input.anchorPositions[offset] ?? 0;
		const by = input.anchorPositions[offset + 1] ?? 0;
		const bz = input.anchorPositions[offset + 2] ?? 0;
		const distance = angularDistanceComponents(
			ax,
			ay,
			az,
			bx,
			by,
			bz,
		);
		addDirectedTangentForce(
			forces,
			index,
			ax,
			ay,
			az,
			bx,
			by,
			bz,
			2 * strength * distance,
			hashNumbers(input.effectiveSeed, index, 0xa11),
		);
	}
}

function projectAllForcesToTangents(
	positions: Float32Array,
	forces: Float64Array,
	movableMask: Uint8Array,
): void {
	for (let index = 0; index < movableMask.length; index += 1) {
		const offset = index * 3;
		if (movableMask[index] !== 1) {
			forces[offset] = 0;
			forces[offset + 1] = 0;
			forces[offset + 2] = 0;
			continue;
		}
		const x = positions[offset] ?? 0;
		const y = positions[offset + 1] ?? 0;
		const z = positions[offset + 2] ?? 0;
		const forceX = forces[offset] ?? 0;
		const forceY = forces[offset + 1] ?? 0;
		const forceZ = forces[offset + 2] ?? 0;
		const radial = x * forceX + y * forceY + z * forceZ;
		forces[offset] = forceX - radial * x;
		forces[offset + 1] = forceY - radial * y;
		forces[offset + 2] = forceZ - radial * z;
	}
}

export function computeSphericalForces(
	input: ForceEvaluationInput,
): ForceEvaluation {
	const nodeCount = input.positions.length / 3;
	if (
		input.positions.length % 3 !== 0 ||
		input.movableMask.length !== nodeCount ||
		input.edgeEndpoints.length !== input.edgeWeights.length * 2 ||
		(input.edgeTargetAngles !== undefined &&
			input.edgeTargetAngles.length !== input.edgeWeights.length) ||
		(input.folderIndexByNode !== undefined &&
			input.folderIndexByNode.length !== nodeCount)
	) {
		throw new RangeError('Force-evaluation buffers have inconsistent lengths.');
	}
	const forces = new Float64Array(input.positions.length);
	const springEnergy = accumulateSprings(input, forces);
	const repulsionMode: RepulsionMode =
		nodeCount <= input.settings.exactRepulsionThreshold
			? 'exact'
			: 'sampled';
	const evaluatedRepulsionPairs =
		repulsionMode === 'exact'
			? accumulateExactRepulsion(input, forces)
			: accumulateSampledRepulsion(input, forces);
	const coverageEnergy = accumulateCoverageRegularizers(input, forces);
	accumulateAnchors(input, forces);
	projectAllForcesToTangents(
		input.positions,
		forces,
		input.movableMask,
	);
	return {
		forces,
		evaluatedRepulsionPairs,
		repulsionMode,
		springEnergy,
		coverageEnergy,
	};
}

export interface LayoutEnergyInput {
	readonly positions: Float32Array;
	readonly edgeEndpoints: Uint32Array;
	readonly edgeWeights: Float32Array;
	readonly settings: SolverSettings;
}

/** Rotation-invariant diagnostic energy used by tests and benchmarks. */
export function computeLayoutEnergy(input: LayoutEnergyInput): number {
	const nodeCount = input.positions.length / 3;
	const mask = new Uint8Array(nodeCount);
	mask.fill(1);
	const evaluation = computeSphericalForces({
		...input,
		movableMask: mask,
		effectiveSeed: 0,
		iteration: 0,
	});
	let repulsionEnergy = 0;
	for (let first = 0; first < nodeCount; first += 1) {
		const a = readVec3(input.positions, first);
		for (let second = first + 1; second < nodeCount; second += 1) {
			const b = readVec3(input.positions, second);
			const dot = clamp(
				a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
				-1,
				1,
			);
			repulsionEnergy -=
				input.settings.repulsionStrength *
				Math.log(Math.max(1e-8, (1 - dot) / 2));
		}
	}
	return (
		evaluation.springEnergy +
		evaluation.coverageEnergy +
		repulsionEnergy
	);
}

export function maximumForceTangencyError(
	positions: Float32Array,
	forces: Float64Array,
): number {
	if (positions.length !== forces.length) {
		throw new RangeError('Position and force buffers must be equal lengths.');
	}
	let maximum = 0;
	for (let index = 0; index < positions.length / 3; index += 1) {
		const position: Vec3 = readVec3(positions, index);
		const force: Vec3 = readVec3(forces, index);
		maximum = Math.max(
			maximum,
			Math.abs(
				position[0] * force[0] +
					position[1] * force[1] +
					position[2] * force[2],
			),
		);
	}
	return maximum;
}
