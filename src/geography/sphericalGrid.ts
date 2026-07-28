import {
	dotVec3,
	normalizeVec3,
	readVec3,
	type Vec3,
} from '../geometry/vector3';

export type SphericalTriangle = readonly [
	first: number,
	second: number,
	third: number,
];

export interface IntrinsicSphericalGrid {
	readonly subdivision: number;
	readonly vertices: readonly Vec3[];
	readonly triangles: readonly SphericalTriangle[];
	readonly neighbors: readonly (readonly number[])[];
}

const ICOSAHEDRON_EDGE_ANGLE = 1.107_148_717_794_090_4;

function baseIcosahedron(): {
	readonly vertices: Vec3[];
	readonly triangles: SphericalTriangle[];
} {
	const golden = (1 + Math.sqrt(5)) / 2;
	const rawVertices: Vec3[] = [
		[-1, golden, 0],
		[1, golden, 0],
		[-1, -golden, 0],
		[1, -golden, 0],
		[0, -1, golden],
		[0, 1, golden],
		[0, -1, -golden],
		[0, 1, -golden],
		[golden, 0, -1],
		[golden, 0, 1],
		[-golden, 0, -1],
		[-golden, 0, 1],
	];
	const vertices = rawVertices.map((vertex) => normalizeVec3(vertex));
	const triangles: SphericalTriangle[] = [
		[0, 11, 5],
		[0, 5, 1],
		[0, 1, 7],
		[0, 7, 10],
		[0, 10, 11],
		[1, 5, 9],
		[5, 11, 4],
		[11, 10, 2],
		[10, 7, 6],
		[7, 1, 8],
		[3, 9, 4],
		[3, 4, 2],
		[3, 2, 6],
		[3, 6, 8],
		[3, 8, 9],
		[4, 9, 5],
		[2, 4, 11],
		[6, 2, 10],
		[8, 6, 7],
		[9, 8, 1],
	];
	return { vertices, triangles };
}

function midpointIndex(
	first: number,
	second: number,
	vertices: Vec3[],
	cache: Map<string, number>,
): number {
	const lower = Math.min(first, second);
	const upper = Math.max(first, second);
	const key = `${lower}:${upper}`;
	const cached = cache.get(key);
	if (cached !== undefined) {
		return cached;
	}
	const left = vertices[first];
	const right = vertices[second];
	if (left === undefined || right === undefined) {
		throw new RangeError('Spherical grid triangle references an invalid vertex.');
	}
	const midpoint = normalizeVec3([
		left[0] + right[0],
		left[1] + right[1],
		left[2] + right[2],
	]);
	const index = vertices.length;
	vertices.push(midpoint);
	cache.set(key, index);
	return index;
}

export function createIntrinsicSphericalGrid(
	subdivision: number,
): IntrinsicSphericalGrid {
	if (
		!Number.isSafeInteger(subdivision) ||
		subdivision < 0 ||
		subdivision > 6
	) {
		throw new RangeError('Spherical grid subdivision must be an integer from 0 to 6.');
	}
	const base = baseIcosahedron();
	const vertices = [...base.vertices];
	let triangles = [...base.triangles];
	for (let level = 0; level < subdivision; level += 1) {
		const midpointCache = new Map<string, number>();
		const refined: SphericalTriangle[] = [];
		for (const [first, second, third] of triangles) {
			const firstSecond = midpointIndex(
				first,
				second,
				vertices,
				midpointCache,
			);
			const secondThird = midpointIndex(
				second,
				third,
				vertices,
				midpointCache,
			);
			const thirdFirst = midpointIndex(
				third,
				first,
				vertices,
				midpointCache,
			);
			refined.push(
				[first, firstSecond, thirdFirst],
				[second, secondThird, firstSecond],
				[third, thirdFirst, secondThird],
				[firstSecond, secondThird, thirdFirst],
			);
		}
		triangles = refined;
	}
	const neighborSets = Array.from(
		{ length: vertices.length },
		() => new Set<number>(),
	);
	for (const [first, second, third] of triangles) {
		neighborSets[first]?.add(second);
		neighborSets[first]?.add(third);
		neighborSets[second]?.add(first);
		neighborSets[second]?.add(third);
		neighborSets[third]?.add(first);
		neighborSets[third]?.add(second);
	}
	return {
		subdivision,
		vertices: Object.freeze(vertices),
		triangles: Object.freeze(triangles),
		neighbors: Object.freeze(
			neighborSets.map((neighbors) =>
				Object.freeze([...neighbors].sort((left, right) => left - right)),
			),
		),
	};
}

export function gridSubdivisionForSpacing(spacing: number): number {
	if (!Number.isFinite(spacing) || spacing <= 0) {
		return 3;
	}
	const targetEdge = Math.max(0.045, spacing * 0.55);
	for (let subdivision = 2; subdivision <= 5; subdivision += 1) {
		if (
			ICOSAHEDRON_EDGE_ANGLE / 2 ** subdivision <=
			targetEdge
		) {
			return subdivision;
		}
	}
	return 5;
}

export function mapPositionsToGrid(
	grid: IntrinsicSphericalGrid,
	positions: ArrayLike<number>,
): Int32Array {
	if (positions.length % 3 !== 0) {
		throw new RangeError('Position buffer length must be divisible by three.');
	}
	const result = new Int32Array(positions.length / 3);
	for (let nodeIndex = 0; nodeIndex < result.length; nodeIndex += 1) {
		const point = normalizeVec3(readVec3(positions, nodeIndex));
		let bestIndex = 0;
		let bestDot = Number.NEGATIVE_INFINITY;
		for (
			let vertexIndex = 0;
			vertexIndex < grid.vertices.length;
			vertexIndex += 1
		) {
			const vertex = grid.vertices[vertexIndex];
			if (vertex === undefined) {
				continue;
			}
			const similarity = dotVec3(point, vertex);
			if (
				similarity > bestDot + 1e-12 ||
				(Math.abs(similarity - bestDot) <= 1e-12 &&
					vertexIndex < bestIndex)
			) {
				bestDot = similarity;
				bestIndex = vertexIndex;
			}
		}
		result[nodeIndex] = bestIndex;
	}
	return result;
}
