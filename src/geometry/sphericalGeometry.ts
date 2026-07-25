import {
	addVec3,
	clamp,
	crossVec3,
	dotVec3,
	lengthVec3,
	normalizeVec3,
	orthogonalUnitVec3,
	projectTangentVec3,
	scaleVec3,
	tryNormalizeVec3,
	type Vec3,
} from './vector3';

export const ANGULAR_EPSILON = 1e-10;

export function geodesicDistance(first: Vec3, second: Vec3): number {
	const left = normalizeVec3(first);
	const right = normalizeVec3(second);
	return Math.atan2(
		lengthVec3(crossVec3(left, right)),
		clamp(dotVec3(left, right), -1, 1),
	);
}

export function projectToTangent(position: Vec3, vector: Vec3): Vec3 {
	const unitPosition = normalizeVec3(position);
	return projectTangentVec3(unitPosition, vector);
}

export function tangentDirection(
	from: Vec3,
	to: Vec3,
	fallbackSalt = 0,
): Vec3 {
	const start = normalizeVec3(from);
	const end = normalizeVec3(to);
	const projected = projectTangentVec3(start, end);
	return (
		tryNormalizeVec3(projected, ANGULAR_EPSILON) ??
		orthogonalUnitVec3(start, fallbackSalt)
	);
}

export function exponentialMap(position: Vec3, tangentStep: Vec3): Vec3 {
	const start = normalizeVec3(position);
	const tangent = projectTangentVec3(start, tangentStep);
	const angle = lengthVec3(tangent);

	if (!Number.isFinite(angle)) {
		throw new RangeError('Exponential-map step must be finite.');
	}
	if (angle < 1e-8) {
		return normalizeVec3(addVec3(start, tangent));
	}

	const direction = scaleVec3(tangent, 1 / angle);
	return normalizeVec3(
		addVec3(
			scaleVec3(start, Math.cos(angle)),
			scaleVec3(direction, Math.sin(angle)),
		),
	);
}

export function reprojectTangentVelocity(
	position: Vec3,
	velocity: Vec3,
): Vec3 {
	return projectToTangent(position, velocity);
}

export function geodesicClamp(
	position: Vec3,
	anchor: Vec3,
	maximumAngle: number,
	fallbackSalt = 0,
): Vec3 {
	if (!Number.isFinite(maximumAngle) || maximumAngle < 0) {
		throw new RangeError('maximumAngle must be finite and non-negative.');
	}

	const unitPosition = normalizeVec3(position);
	const unitAnchor = normalizeVec3(anchor);
	const distance = geodesicDistance(unitAnchor, unitPosition);
	if (distance <= maximumAngle || distance <= ANGULAR_EPSILON) {
		return unitPosition;
	}
	if (maximumAngle === 0) {
		return unitAnchor;
	}

	const direction = tangentDirection(
		unitAnchor,
		unitPosition,
		fallbackSalt,
	);
	return exponentialMap(unitAnchor, scaleVec3(direction, maximumAngle));
}

export function sphericalWeightedMean(
	vectors: readonly Vec3[],
	weights?: readonly number[],
): Vec3 | null {
	if (weights !== undefined && weights.length !== vectors.length) {
		throw new RangeError('weights and vectors must have equal lengths.');
	}

	let x = 0;
	let y = 0;
	let z = 0;
	for (let index = 0; index < vectors.length; index += 1) {
		const vector = normalizeVec3(vectors[index] ?? [0, 0, 0]);
		const weight = weights?.[index] ?? 1;
		if (!Number.isFinite(weight) || weight < 0) {
			throw new RangeError('Spherical-mean weights must be non-negative.');
		}
		x += vector[0] * weight;
		y += vector[1] * weight;
		z += vector[2] * weight;
	}
	return tryNormalizeVec3([x, y, z], ANGULAR_EPSILON);
}

export interface SphericalCoverageMetrics {
	readonly mean: Vec3;
	readonly meanVectorNorm: number;
	readonly secondMoment: readonly [
		xx: number,
		xy: number,
		xz: number,
		yy: number,
		yz: number,
		zz: number,
	];
	readonly covarianceDiagonal: Vec3;
	readonly isotropyEnergy: number;
}

export function computeSphericalCoverage(
	positions: ArrayLike<number>,
): SphericalCoverageMetrics {
	if (positions.length % 3 !== 0) {
		throw new RangeError('Position buffer length must be divisible by three.');
	}
	const count = positions.length / 3;
	if (count === 0) {
		return {
			mean: [0, 0, 0],
			meanVectorNorm: 0,
			secondMoment: [0, 0, 0, 0, 0, 0],
			covarianceDiagonal: [0, 0, 0],
			isotropyEnergy: 0,
		};
	}

	let mx = 0;
	let my = 0;
	let mz = 0;
	let xx = 0;
	let xy = 0;
	let xz = 0;
	let yy = 0;
	let yz = 0;
	let zz = 0;
	for (let index = 0; index < positions.length; index += 3) {
		const x = positions[index] ?? Number.NaN;
		const y = positions[index + 1] ?? Number.NaN;
		const z = positions[index + 2] ?? Number.NaN;
		if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
			throw new RangeError('Position buffer contains a non-finite value.');
		}
		mx += x;
		my += y;
		mz += z;
		xx += x * x;
		xy += x * y;
		xz += x * z;
		yy += y * y;
		yz += y * z;
		zz += z * z;
	}

	const inverseCount = 1 / count;
	const mean: Vec3 = [
		mx * inverseCount,
		my * inverseCount,
		mz * inverseCount,
	];
	const moment = [
		xx * inverseCount,
		xy * inverseCount,
		xz * inverseCount,
		yy * inverseCount,
		yz * inverseCount,
		zz * inverseCount,
	] as const;
	const diagonal: Vec3 = [moment[0], moment[3], moment[5]];
	const isotropyEnergy =
		(moment[0] - 1 / 3) ** 2 +
		(moment[3] - 1 / 3) ** 2 +
		(moment[5] - 1 / 3) ** 2 +
		2 * (moment[1] ** 2 + moment[2] ** 2 + moment[4] ** 2);

	return {
		mean,
		meanVectorNorm: lengthVec3(mean),
		secondMoment: moment,
		covarianceDiagonal: diagonal,
		isotropyEnergy,
	};
}

export function longitudeLatitudeToUnitVector(
	longitudeRadians: number,
	latitudeRadians: number,
): Vec3 {
	const latitudeCosine = Math.cos(latitudeRadians);
	return normalizeVec3([
		latitudeCosine * Math.cos(longitudeRadians),
		Math.sin(latitudeRadians),
		latitudeCosine * Math.sin(longitudeRadians),
	]);
}
