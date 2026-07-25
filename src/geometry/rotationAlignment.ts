import {
	dotVec3,
	normalizeVec3,
	readVec3,
	writeVec3,
	type Vec3,
} from './vector3';

export type Mat3 = readonly [
	m00: number,
	m01: number,
	m02: number,
	m10: number,
	m11: number,
	m12: number,
	m20: number,
	m21: number,
	m22: number,
];

export const IDENTITY_ROTATION: Mat3 = [
	1, 0, 0,
	0, 1, 0,
	0, 0, 1,
];

export function applyMat3(matrix: Mat3, vector: Vec3): Vec3 {
	return [
		matrix[0] * vector[0] +
			matrix[1] * vector[1] +
			matrix[2] * vector[2],
		matrix[3] * vector[0] +
			matrix[4] * vector[1] +
			matrix[5] * vector[2],
		matrix[6] * vector[0] +
			matrix[7] * vector[1] +
			matrix[8] * vector[2],
	];
}

export function determinantMat3(matrix: Mat3): number {
	return (
		matrix[0] * (matrix[4] * matrix[8] - matrix[5] * matrix[7]) -
		matrix[1] * (matrix[3] * matrix[8] - matrix[5] * matrix[6]) +
		matrix[2] * (matrix[3] * matrix[7] - matrix[4] * matrix[6])
	);
}

export function transposeMat3(matrix: Mat3): Mat3 {
	return [
		matrix[0],
		matrix[3],
		matrix[6],
		matrix[1],
		matrix[4],
		matrix[7],
		matrix[2],
		matrix[5],
		matrix[8],
	];
}

export function multiplyMat3(left: Mat3, right: Mat3): Mat3 {
	return [
		left[0] * right[0] + left[1] * right[3] + left[2] * right[6],
		left[0] * right[1] + left[1] * right[4] + left[2] * right[7],
		left[0] * right[2] + left[1] * right[5] + left[2] * right[8],
		left[3] * right[0] + left[4] * right[3] + left[5] * right[6],
		left[3] * right[1] + left[4] * right[4] + left[5] * right[7],
		left[3] * right[2] + left[4] * right[5] + left[5] * right[8],
		left[6] * right[0] + left[7] * right[3] + left[8] * right[6],
		left[6] * right[1] + left[7] * right[4] + left[8] * right[7],
		left[6] * right[2] + left[7] * right[5] + left[8] * right[8],
	];
}

function symmetricLargestEigenvector4(matrix: readonly number[]): Vec4 {
	if (matrix.length !== 16) {
		throw new RangeError('Expected a 4×4 matrix.');
	}
	const values = [...matrix];
	const vectors = [
		1, 0, 0, 0,
		0, 1, 0, 0,
		0, 0, 1, 0,
		0, 0, 0, 1,
	];

	for (let sweep = 0; sweep < 64; sweep += 1) {
		let p = 0;
		let q = 1;
		let maximum = 0;
		for (let row = 0; row < 4; row += 1) {
			for (let column = row + 1; column < 4; column += 1) {
				const candidate = Math.abs(
					values[row * 4 + column] ?? 0,
				);
				if (candidate > maximum) {
					maximum = candidate;
					p = row;
					q = column;
				}
			}
		}
		if (maximum < 1e-14) {
			break;
		}

		const pp = values[p * 4 + p] ?? 0;
		const qq = values[q * 4 + q] ?? 0;
		const pq = values[p * 4 + q] ?? 0;
		const angle = 0.5 * Math.atan2(2 * pq, qq - pp);
		const cosine = Math.cos(angle);
		const sine = Math.sin(angle);

		for (let index = 0; index < 4; index += 1) {
			if (index === p || index === q) {
				continue;
			}
			const ip = values[index * 4 + p] ?? 0;
			const iq = values[index * 4 + q] ?? 0;
			const nextIp = cosine * ip - sine * iq;
			const nextIq = sine * ip + cosine * iq;
			values[index * 4 + p] = nextIp;
			values[p * 4 + index] = nextIp;
			values[index * 4 + q] = nextIq;
			values[q * 4 + index] = nextIq;
		}
		values[p * 4 + p] =
			cosine * cosine * pp -
			2 * sine * cosine * pq +
			sine * sine * qq;
		values[q * 4 + q] =
			sine * sine * pp +
			2 * sine * cosine * pq +
			cosine * cosine * qq;
		values[p * 4 + q] = 0;
		values[q * 4 + p] = 0;

		for (let row = 0; row < 4; row += 1) {
			const rp = vectors[row * 4 + p] ?? 0;
			const rq = vectors[row * 4 + q] ?? 0;
			vectors[row * 4 + p] = cosine * rp - sine * rq;
			vectors[row * 4 + q] = sine * rp + cosine * rq;
		}
	}

	let largestIndex = 0;
	for (let index = 1; index < 4; index += 1) {
		if (
			(values[index * 4 + index] ?? Number.NEGATIVE_INFINITY) >
			(values[largestIndex * 4 + largestIndex] ??
				Number.NEGATIVE_INFINITY)
		) {
			largestIndex = index;
		}
	}
	const quaternion: Vec4 = [
		vectors[largestIndex] ?? 1,
		vectors[4 + largestIndex] ?? 0,
		vectors[8 + largestIndex] ?? 0,
		vectors[12 + largestIndex] ?? 0,
	];
	const norm = Math.hypot(...quaternion);
	if (norm < 1e-14) {
		return [1, 0, 0, 0];
	}
	const sign = quaternion[0] < 0 ? -1 : 1;
	return [
		(quaternion[0] * sign) / norm,
		(quaternion[1] * sign) / norm,
		(quaternion[2] * sign) / norm,
		(quaternion[3] * sign) / norm,
	];
}

type Vec4 = readonly [w: number, x: number, y: number, z: number];

export function quaternionToRotation(quaternion: Vec4): Mat3 {
	const [w, x, y, z] = quaternion;
	const xx = x * x;
	const yy = y * y;
	const zz = z * z;
	const xy = x * y;
	const xz = x * z;
	const yz = y * z;
	const wx = w * x;
	const wy = w * y;
	const wz = w * z;
	return [
		1 - 2 * (yy + zz),
		2 * (xy - wz),
		2 * (xz + wy),
		2 * (xy + wz),
		1 - 2 * (xx + zz),
		2 * (yz - wx),
		2 * (xz - wy),
		2 * (yz + wx),
		1 - 2 * (xx + yy),
	];
}

/**
 * Finds the least-squares proper rotation mapping `source` onto `target`.
 * This is Horn's quaternion form of orthogonal Procrustes, so det(R) is +1.
 */
export function findBestProperRotation(
	source: readonly Vec3[],
	target: readonly Vec3[],
	weights?: readonly number[],
): Mat3 {
	if (source.length !== target.length) {
		throw new RangeError('source and target must have equal lengths.');
	}
	if (weights !== undefined && weights.length !== source.length) {
		throw new RangeError('weights and source must have equal lengths.');
	}
	if (source.length === 0) {
		return IDENTITY_ROTATION;
	}

	const covariance = new Float64Array(9);
	let totalWeight = 0;
	for (let index = 0; index < source.length; index += 1) {
		const from = normalizeVec3(source[index] ?? [0, 0, 0]);
		const to = normalizeVec3(target[index] ?? [0, 0, 0]);
		const weight = weights?.[index] ?? 1;
		if (!Number.isFinite(weight) || weight < 0) {
			throw new RangeError('Alignment weights must be non-negative.');
		}
		totalWeight += weight;
		for (let row = 0; row < 3; row += 1) {
			for (let column = 0; column < 3; column += 1) {
				covariance[row * 3 + column] =
					(covariance[row * 3 + column] ?? 0) +
					(to[row] ?? 0) * (from[column] ?? 0) * weight;
			}
		}
	}
	if (totalWeight <= 0) {
		return IDENTITY_ROTATION;
	}

	const b00 = covariance[0] ?? 0;
	const b01 = covariance[1] ?? 0;
	const b02 = covariance[2] ?? 0;
	const b10 = covariance[3] ?? 0;
	const b11 = covariance[4] ?? 0;
	const b12 = covariance[5] ?? 0;
	const b20 = covariance[6] ?? 0;
	const b21 = covariance[7] ?? 0;
	const b22 = covariance[8] ?? 0;
	const sigma = b00 + b11 + b22;
	const z0 = b21 - b12;
	const z1 = b02 - b20;
	const z2 = b10 - b01;
	const davenport = [
		sigma, z0, z1, z2,
		z0, 2 * b00 - sigma, b01 + b10, b02 + b20,
		z1, b10 + b01, 2 * b11 - sigma, b12 + b21,
		z2, b20 + b02, b21 + b12, 2 * b22 - sigma,
	];
	return quaternionToRotation(
		symmetricLargestEigenvector4(davenport),
	);
}

export function rotatePositionBuffer(
	positions: ArrayLike<number>,
	rotation: Mat3,
): Float32Array {
	if (positions.length % 3 !== 0) {
		throw new RangeError('Position buffer length must be divisible by three.');
	}
	const result = new Float32Array(positions.length);
	for (let index = 0; index < positions.length / 3; index += 1) {
		writeVec3(
			result,
			index,
			normalizeVec3(applyMat3(rotation, readVec3(positions, index))),
		);
	}
	return result;
}

export interface AlignmentResult {
	readonly rotation: Mat3;
	readonly positions: Float32Array;
	readonly meanDotBefore: number;
	readonly meanDotAfter: number;
}

export function alignPositionBuffers(
	sourcePositions: ArrayLike<number>,
	targetPositions: ArrayLike<number>,
	includedMask?: ArrayLike<number>,
): AlignmentResult {
	if (
		sourcePositions.length !== targetPositions.length ||
		sourcePositions.length % 3 !== 0
	) {
		throw new RangeError('Alignment buffers must have equal 3N lengths.');
	}
	const count = sourcePositions.length / 3;
	if (includedMask !== undefined && includedMask.length !== count) {
		throw new RangeError('Alignment mask must contain one value per node.');
	}

	const source: Vec3[] = [];
	const target: Vec3[] = [];
	let dotBefore = 0;
	for (let index = 0; index < count; index += 1) {
		if ((includedMask?.[index] ?? 1) === 0) {
			continue;
		}
		const from = normalizeVec3(readVec3(sourcePositions, index));
		const to = normalizeVec3(readVec3(targetPositions, index));
		source.push(from);
		target.push(to);
		dotBefore += dotVec3(from, to);
	}
	const rotation = findBestProperRotation(source, target);
	const positions = rotatePositionBuffer(sourcePositions, rotation);
	let dotAfter = 0;
	for (let index = 0; index < count; index += 1) {
		if ((includedMask?.[index] ?? 1) === 0) {
			continue;
		}
		dotAfter += dotVec3(
			readVec3(positions, index),
			normalizeVec3(readVec3(targetPositions, index)),
		);
	}
	const includedCount = source.length;
	return {
		rotation,
		positions,
		meanDotBefore: includedCount === 0 ? 1 : dotBefore / includedCount,
		meanDotAfter: includedCount === 0 ? 1 : dotAfter / includedCount,
	};
}
