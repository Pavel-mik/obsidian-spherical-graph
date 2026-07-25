export type Vec3 = readonly [x: number, y: number, z: number];

export const VECTOR_EPSILON = 1e-12;

export function vec3(x: number, y: number, z: number): Vec3 {
	return [x, y, z];
}

export function isFiniteVec3(value: unknown): value is Vec3 {
	return (
		Array.isArray(value) &&
		value.length === 3 &&
		value.every(
			(component) =>
				typeof component === 'number' && Number.isFinite(component),
		)
	);
}

export function addVec3(left: Vec3, right: Vec3): Vec3 {
	return [
		left[0] + right[0],
		left[1] + right[1],
		left[2] + right[2],
	];
}

export function subtractVec3(left: Vec3, right: Vec3): Vec3 {
	return [
		left[0] - right[0],
		left[1] - right[1],
		left[2] - right[2],
	];
}

export function scaleVec3(vector: Vec3, scalar: number): Vec3 {
	return [
		vector[0] * scalar,
		vector[1] * scalar,
		vector[2] * scalar,
	];
}

export function dotVec3(left: Vec3, right: Vec3): number {
	return (
		left[0] * right[0] +
		left[1] * right[1] +
		left[2] * right[2]
	);
}

export function crossVec3(left: Vec3, right: Vec3): Vec3 {
	return [
		left[1] * right[2] - left[2] * right[1],
		left[2] * right[0] - left[0] * right[2],
		left[0] * right[1] - left[1] * right[0],
	];
}

export function projectTangentVec3(position: Vec3, vector: Vec3): Vec3 {
	const radialMagnitude = dotVec3(position, vector);
	return subtractVec3(vector, scaleVec3(position, radialMagnitude));
}

export function lengthSquaredVec3(vector: Vec3): number {
	return dotVec3(vector, vector);
}

export function lengthVec3(vector: Vec3): number {
	return Math.sqrt(lengthSquaredVec3(vector));
}

export function tryNormalizeVec3(
	vector: Vec3,
	epsilon = VECTOR_EPSILON,
): Vec3 | null {
	if (!isFiniteVec3(vector)) {
		return null;
	}

	const magnitudeSquared = lengthSquaredVec3(vector);
	if (
		!Number.isFinite(magnitudeSquared) ||
		magnitudeSquared <= epsilon * epsilon
	) {
		return null;
	}

	const inverseMagnitude = 1 / Math.sqrt(magnitudeSquared);
	return scaleVec3(vector, inverseMagnitude);
}

export function normalizeVec3(
	vector: Vec3,
	epsilon = VECTOR_EPSILON,
): Vec3 {
	const normalized = tryNormalizeVec3(vector, epsilon);
	if (normalized === null) {
		throw new RangeError('Cannot normalize a zero or non-finite vector.');
	}
	return normalized;
}

export function distanceSquaredVec3(left: Vec3, right: Vec3): number {
	const x = left[0] - right[0];
	const y = left[1] - right[1];
	const z = left[2] - right[2];
	return x * x + y * y + z * z;
}

export function clamp(value: number, minimum: number, maximum: number): number {
	return Math.min(maximum, Math.max(minimum, value));
}

export function readVec3(
	values: ArrayLike<number>,
	vectorIndex: number,
): Vec3 {
	const offset = vectorIndex * 3;
	const x = values[offset];
	const y = values[offset + 1];
	const z = values[offset + 2];
	if (x === undefined || y === undefined || z === undefined) {
		throw new RangeError(`Vector index ${vectorIndex} is outside the buffer.`);
	}
	return [x, y, z];
}

export function writeVec3(
	values: Float32Array | Float64Array,
	vectorIndex: number,
	vector: Vec3,
): void {
	const offset = vectorIndex * 3;
	if (offset < 0 || offset + 2 >= values.length) {
		throw new RangeError(`Vector index ${vectorIndex} is outside the buffer.`);
	}
	values[offset] = vector[0];
	values[offset + 1] = vector[1];
	values[offset + 2] = vector[2];
}

/**
 * Produces a deterministic unit tangent. The salt chooses an axis and sign;
 * no global state or random source is consulted.
 */
export function orthogonalUnitVec3(vector: Vec3, salt = 0): Vec3 {
	const unit = normalizeVec3(vector);
	const axes: readonly [Vec3, Vec3, Vec3] = [
		[1, 0, 0],
		[0, 1, 0],
		[0, 0, 1],
	];
	const start = Math.abs(salt | 0) % axes.length;
	let selected = axes[start] ?? axes[0];

	if (Math.abs(dotVec3(unit, selected)) > 0.85) {
		selected = axes[(start + 1) % axes.length] ?? axes[1];
	}
	if (Math.abs(dotVec3(unit, selected)) > 0.85) {
		selected = axes[(start + 2) % axes.length] ?? axes[2];
	}

	let tangent = normalizeVec3(crossVec3(unit, selected));
	if ((salt & 4) !== 0) {
		tangent = scaleVec3(tangent, -1);
	}
	return tangent;
}

export function approximatelyEqualVec3(
	left: Vec3,
	right: Vec3,
	tolerance = 1e-9,
): boolean {
	return distanceSquaredVec3(left, right) <= tolerance * tolerance;
}
