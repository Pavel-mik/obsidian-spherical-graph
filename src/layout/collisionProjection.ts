import { deriveSeed, deterministicPermutation } from '../geometry/deterministicHash';
import {
	geodesicClamp,
	geodesicDistance,
	exponentialMap,
	tangentDirection,
} from '../geometry/sphericalGeometry';
import {
	orthogonalUnitVec3,
	normalizeVec3,
	readVec3,
	scaleVec3,
	writeVec3,
	type Vec3,
} from '../geometry/vector3';
import { SphericalSpatialHash } from './spatialHash';

const DEFAULT_MAX_PASSES = 64;
const DEFAULT_TOLERANCE = 1e-5;
const DEFAULT_RELAXATION = 1;
const COINCIDENT_TOLERANCE = 1e-8;
const MINIMUM_HASH_CELL_SIZE = 1e-4;

export interface SphericalCollisionProjectionOptions {
	readonly positions: Float32Array;
	readonly angularRadii: Float32Array;
	readonly movableMask: Uint8Array;
	readonly deterministicSeed: number;
	readonly anchorPositions?: Float32Array;
	readonly maximumAngularDisplacements?: number | Float32Array;
	readonly maxPasses?: number;
	readonly tolerance?: number;
	readonly relaxation?: number;
}

export interface SphericalCollisionProjectionResult {
	readonly positions: Float32Array;
	readonly passes: number;
	readonly remainingOverlapCount: number;
	readonly maximumPenetration: number;
	readonly evaluatedPairCount: number;
	readonly converged: boolean;
}

interface ResolvedOptions {
	readonly positions: Float32Array;
	readonly angularRadii: Float32Array;
	readonly movableMask: Uint8Array;
	readonly deterministicSeed: number;
	readonly anchorPositions?: Float32Array;
	readonly maximumAngularDisplacements?: number | Float32Array;
	readonly maxPasses: number;
	readonly tolerance: number;
	readonly relaxation: number;
	readonly nodeCount: number;
	readonly maximumPairAngle: number;
}

interface PairResolution {
	readonly violatesTolerance: boolean;
	readonly moved: boolean;
}

interface OverlapMeasurement {
	readonly remainingOverlapCount: number;
	readonly maximumPenetration: number;
	readonly evaluatedPairCount: number;
}

function validateOptions(
	options: SphericalCollisionProjectionOptions,
): ResolvedOptions {
	if (options.positions.length % 3 !== 0) {
		throw new RangeError(
			'Position buffer length must be divisible by three.',
		);
	}
	const nodeCount = options.positions.length / 3;
	if (options.angularRadii.length !== nodeCount) {
		throw new RangeError('Angular radii must contain one value per node.');
	}
	if (options.movableMask.length !== nodeCount) {
		throw new RangeError('Movable mask must contain one value per node.');
	}
	if (!Number.isSafeInteger(options.deterministicSeed)) {
		throw new RangeError('Deterministic seed must be a safe integer.');
	}

	let largestRadius = 0;
	let secondLargestRadius = 0;
	for (let index = 0; index < nodeCount; index += 1) {
		const radius = options.angularRadii[index];
		const movable = options.movableMask[index];
		if (
			radius === undefined ||
			!Number.isFinite(radius) ||
			radius < 0 ||
			radius >= Math.PI / 2
		) {
			throw new RangeError(
				'Angular radii must be finite values in [0, pi / 2).',
			);
		}
		if (movable !== 0 && movable !== 1) {
			throw new RangeError('Movable mask values must be zero or one.');
		}
		if (radius >= largestRadius) {
			secondLargestRadius = largestRadius;
			largestRadius = radius;
		} else if (radius > secondLargestRadius) {
			secondLargestRadius = radius;
		}
	}

	const maxPasses = options.maxPasses ?? DEFAULT_MAX_PASSES;
	if (!Number.isSafeInteger(maxPasses) || maxPasses < 0) {
		throw new RangeError('maxPasses must be a non-negative integer.');
	}
	const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
	if (!Number.isFinite(tolerance) || tolerance < 0) {
		throw new RangeError('Tolerance must be finite and non-negative.');
	}
	const relaxation = options.relaxation ?? DEFAULT_RELAXATION;
	if (!Number.isFinite(relaxation) || relaxation <= 0 || relaxation > 1) {
		throw new RangeError('Relaxation must be in the interval (0, 1].');
	}

	const anchors = options.anchorPositions;
	const maximumDisplacements = options.maximumAngularDisplacements;
	if ((anchors === undefined) !== (maximumDisplacements === undefined)) {
		throw new RangeError(
			'Anchor positions and maximum displacements must be provided together.',
		);
	}
	if (anchors !== undefined && anchors.length !== options.positions.length) {
		throw new RangeError(
			'Anchor positions must match the position buffer length.',
		);
	}
	if (anchors !== undefined) {
		for (let index = 0; index < nodeCount; index += 1) {
			normalizeVec3(readVec3(anchors, index));
		}
	}
	if (maximumDisplacements instanceof Float32Array) {
		if (maximumDisplacements.length !== nodeCount) {
			throw new RangeError(
				'Maximum displacements must contain one value per node.',
			);
		}
		for (const displacement of maximumDisplacements) {
			validateMaximumDisplacement(displacement);
		}
	} else if (maximumDisplacements !== undefined) {
		validateMaximumDisplacement(maximumDisplacements);
	}

	return {
		...options,
		maxPasses,
		tolerance,
		relaxation,
		nodeCount,
		maximumPairAngle: largestRadius + secondLargestRadius,
	};
}

function validateMaximumDisplacement(displacement: number): void {
	if (
		!Number.isFinite(displacement) ||
		displacement < 0 ||
		displacement > Math.PI
	) {
		throw new RangeError(
			'Maximum angular displacements must be finite values in [0, pi].',
		);
	}
}

function maximumDisplacementAt(
	options: ResolvedOptions,
	index: number,
): number | undefined {
	const maximum = options.maximumAngularDisplacements;
	return maximum instanceof Float32Array ? maximum[index] : maximum;
}

function constrainToAnchor(
	position: Vec3,
	index: number,
	options: ResolvedOptions,
): Vec3 {
	if (options.anchorPositions === undefined) {
		return position;
	}
	const maximum = maximumDisplacementAt(options, index);
	if (maximum === undefined) {
		return position;
	}
	return geodesicClamp(
		position,
		readVec3(options.anchorPositions, index),
		maximum,
		deriveSeed(options.deterministicSeed, 'collision-anchor', index),
	);
}

function preparePositions(options: ResolvedOptions): Float32Array {
	const result = new Float32Array(options.positions.length);
	for (let index = 0; index < options.nodeCount; index += 1) {
		let position = normalizeVec3(readVec3(options.positions, index));
		if (options.movableMask[index] === 1) {
			position = constrainToAnchor(position, index, options);
		}
		writeVec3(result, index, position);
	}
	return result;
}

function collectNearbyPairs(
	positions: Float32Array,
	maximumPairAngle: number,
): number[] {
	if (maximumPairAngle <= 0 || positions.length < 6) {
		return [];
	}
	const chord = 2 * Math.sin(maximumPairAngle / 2);
	const spatialHash = new SphericalSpatialHash(
		Math.max(MINIMUM_HASH_CELL_SIZE, chord),
	);
	const pairs: number[] = [];
	spatialHash.forEachPairWithinAngle(
		positions,
		maximumPairAngle,
		undefined,
		(first, second) => {
			pairs.push(first, second);
		},
	);
	return pairs;
}

function separationDirections(
	first: Vec3,
	second: Vec3,
	distance: number,
	salt: number,
): readonly [towardSecond: Vec3, towardFirst: Vec3] {
	if (distance <= COINCIDENT_TOLERANCE) {
		const tangent = orthogonalUnitVec3(first, salt);
		return [tangent, scaleVec3(tangent, -1)];
	}
	return [
		tangentDirection(first, second, salt),
		tangentDirection(second, first, salt),
	];
}

function resolvePair(
	positions: Float32Array,
	firstIndex: number,
	secondIndex: number,
	pass: number,
	options: ResolvedOptions,
): PairResolution {
	const first = readVec3(positions, firstIndex);
	const second = readVec3(positions, secondIndex);
	const distance = geodesicDistance(first, second);
	const requiredDistance =
		(options.angularRadii[firstIndex] ?? 0) +
		(options.angularRadii[secondIndex] ?? 0);
	const penetration = requiredDistance - distance;
	if (penetration <= options.tolerance) {
		return { violatesTolerance: false, moved: false };
	}

	const firstMovable = options.movableMask[firstIndex] === 1;
	const secondMovable = options.movableMask[secondIndex] === 1;
	if (!firstMovable && !secondMovable) {
		return { violatesTolerance: true, moved: false };
	}

	const salt = deriveSeed(
		options.deterministicSeed,
		'collision-pair',
		pass,
		firstIndex,
		secondIndex,
	);
	const [towardSecond, towardFirst] = separationDirections(
		first,
		second,
		distance,
		salt,
	);
	const movableCount = Number(firstMovable) + Number(secondMovable);
	const correction = (penetration * options.relaxation) / movableCount;
	let movedAnyNode = false;

	if (firstMovable) {
		const moved = exponentialMap(
			first,
			scaleVec3(towardSecond, -correction),
		);
		const constrained = constrainToAnchor(moved, firstIndex, options);
		movedAnyNode ||= geodesicDistance(first, constrained) > 1e-10;
		writeVec3(
			positions,
			firstIndex,
			constrained,
		);
	}
	if (secondMovable) {
		const moved = exponentialMap(
			second,
			scaleVec3(towardFirst, -correction),
		);
		const constrained = constrainToAnchor(moved, secondIndex, options);
		movedAnyNode ||= geodesicDistance(second, constrained) > 1e-10;
		writeVec3(
			positions,
			secondIndex,
			constrained,
		);
	}
	return { violatesTolerance: true, moved: movedAnyNode };
}

function measureOverlaps(
	positions: Float32Array,
	options: ResolvedOptions,
): OverlapMeasurement {
	const pairs = collectNearbyPairs(positions, options.maximumPairAngle);
	let remainingOverlapCount = 0;
	let maximumPenetration = 0;
	for (let offset = 0; offset < pairs.length; offset += 2) {
		const firstIndex = pairs[offset];
		const secondIndex = pairs[offset + 1];
		if (firstIndex === undefined || secondIndex === undefined) {
			continue;
		}
		const penetration =
			(options.angularRadii[firstIndex] ?? 0) +
			(options.angularRadii[secondIndex] ?? 0) -
			geodesicDistance(
				readVec3(positions, firstIndex),
				readVec3(positions, secondIndex),
			);
		maximumPenetration = Math.max(maximumPenetration, penetration);
		if (penetration > options.tolerance) {
			remainingOverlapCount += 1;
		}
	}
	return {
		remainingOverlapCount,
		maximumPenetration,
		evaluatedPairCount: pairs.length / 2,
	};
}

export function projectSphericalCollisions(
	input: SphericalCollisionProjectionOptions,
): SphericalCollisionProjectionResult {
	const options = validateOptions(input);
	const positions = preparePositions(options);
	let passes = 0;
	let evaluatedPairCount = 0;

	for (let pass = 0; pass < options.maxPasses; pass += 1) {
		const pairs = collectNearbyPairs(
			positions,
			options.maximumPairAngle,
		);
		evaluatedPairCount += pairs.length / 2;
		const order = deterministicPermutation(
			pairs.length / 2,
			deriveSeed(options.deterministicSeed, 'collision-pass', pass),
		);
		let violatesTolerance = false;
		let moved = false;
		for (const pairIndex of order) {
			const offset = pairIndex * 2;
			const firstIndex = pairs[offset];
			const secondIndex = pairs[offset + 1];
			if (firstIndex === undefined || secondIndex === undefined) {
				continue;
			}
			const resolution = resolvePair(
				positions,
				firstIndex,
				secondIndex,
				pass,
				options,
			);
			violatesTolerance ||= resolution.violatesTolerance;
			moved ||= resolution.moved;
		}
		if (!violatesTolerance) {
			break;
		}
		passes += 1;
		if (!moved) {
			break;
		}
	}

	const measurement = measureOverlaps(positions, options);
	evaluatedPairCount += measurement.evaluatedPairCount;
	return {
		positions,
		passes,
		remainingOverlapCount: measurement.remainingOverlapCount,
		maximumPenetration: measurement.maximumPenetration,
		evaluatedPairCount,
		converged: measurement.remainingOverlapCount === 0,
	};
}
