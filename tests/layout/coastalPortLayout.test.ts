import { describe, expect, it } from 'vitest';
import { geodesicDistance } from '../../src/geometry/sphericalGeometry';
import {
	normalizeVec3,
	readVec3,
	writeVec3,
	type Vec3,
} from '../../src/geometry/vector3';
import type {
	GraphData,
	GraphEdge,
	GraphNode,
} from '../../src/graph/graphTypes';
import {
	applyCoastalPortBias,
	coastalPortSelectionOptions,
	deriveCoastalPortLayout,
	type CoastalPortLayout,
} from '../../src/layout/coastalPortLayout';

function graph(
	paths: readonly string[],
	edgeInputs: readonly [source: number, target: number, weight: number][],
): GraphData {
	const weightedDegrees = new Float64Array(paths.length);
	const degrees = new Uint32Array(paths.length);
	const edges: GraphEdge[] = edgeInputs.map(([source, target, weight]) => {
		degrees[source] = (degrees[source] ?? 0) + 1;
		degrees[target] = (degrees[target] ?? 0) + 1;
		weightedDegrees[source] =
			(weightedDegrees[source] ?? 0) + weight;
		weightedDegrees[target] =
			(weightedDegrees[target] ?? 0) + weight;
		return {
			source,
			target,
			weight,
			forwardWeight: weight,
			backwardWeight: 0,
		};
	});
	const nodes: GraphNode[] = paths.map((path, index) => ({
		index,
		id: path,
		path,
		basename: path,
		degree: degrees[index] ?? 0,
		weightedDegree: weightedDegrees[index] ?? 0,
		exists: true,
	}));
	return {
		nodes,
		edges,
		signature: paths.join('|'),
		filterSignature: 'filters',
		descriptor: {
			nodeIds: [...paths],
			edges: edges.map((edge) => ({
				sourceId: paths[edge.source] ?? '',
				targetId: paths[edge.target] ?? '',
				weight: edge.weight,
				forwardWeight: edge.forwardWeight,
				backwardWeight: edge.backwardWeight,
			})),
			filterSignature: 'filters',
		},
	};
}

function packed(points: readonly Vec3[]): Float32Array {
	const result = new Float32Array(points.length * 3);
	for (let index = 0; index < points.length; index += 1) {
		writeVec3(result, index, normalizeVec3(points[index] ?? [1, 0, 0]));
	}
	return result;
}

function selected(layout: CoastalPortLayout): number[] {
	return [...layout.portScores]
		.map((score, index) => ({ score, index }))
		.filter(({ score }) => score > 0)
		.map(({ index }) => index);
}

describe('coastal port layout adapter', () => {
	it('exposes the same relative selection policy to layout and coastline rendering', () => {
		expect(coastalPortSelectionOptions(64)).toEqual({
			capacity: 2,
			minimumAngularSeparation: 0.42,
			minimumScore: 0.35,
		});
	});

	it('selects ports by relative folder evidence instead of absolute edge mass', () => {
		const data = graph(
			[
				'A/high.md',
				'A/low.md',
				'A/inland.md',
				'B/target.md',
				'C/relative.md',
				'C/inland.md',
				'D/target.md',
			],
			[
				[0, 3, 20],
				[1, 3, 1],
				[0, 2, 20],
				[1, 2, 5],
				[4, 6, 0.1],
				[4, 5, 0.2],
			],
		);
		const positions = packed([
			[1, 0, 0],
			[1, 0.08, 0],
			[1, -0.08, 0],
			[0, 1, 0],
			[-1, 0, 0],
			[-1, 0, 0.08],
			[0, -1, 0],
		]);
		const result = deriveCoastalPortLayout(
			data,
			positions,
			Int32Array.from([0, 0, 0, 1, 2, 2, 3]),
		);

		expect(result.portScores[0]).toBeGreaterThan(0);
		expect(result.portScores[1]).toBe(0);
		expect(result.portScores[4]).toBeGreaterThan(0);
		expect(result.portScores[4]).toBeGreaterThan(
			result.portScores[1] ?? Number.POSITIVE_INFINITY,
		);
	});

	it('does not select an omnidirectional inter-folder hub', () => {
		const data = graph(
			['A/hub.md', 'B/north.md', 'C/south.md'],
			[
				[0, 1, 1],
				[0, 2, 1],
			],
		);
		const result = deriveCoastalPortLayout(
			data,
			packed([
				[1, 0, 0],
				[0, 1, 0],
				[0, -1, 0],
			]),
			Int32Array.from([0, 1, 2]),
		);

		expect(result.portScores[0]).toBe(0);
		expect(readVec3(result.portDirections, 0)).toEqual([0, 0, 0]);
	});

	it('never nominates root notes or orphans as ports', () => {
		const data = graph(
			['A/city.md', 'root.md', 'orphan.md'],
			[[0, 1, 4]],
		);
		const result = deriveCoastalPortLayout(
			data,
			packed([
				[1, 0, 0],
				[0, 1, 0],
				[0, 0, 1],
			]),
			Int32Array.from([0, -1, -1]),
		);

		expect(selected(result)).toEqual([]);
	});

	it('is deterministic and returns unit tangent directions', () => {
		const data = graph(
			['A/a.md', 'A/b.md', 'B/c.md'],
			[
				[0, 2, 3],
				[0, 1, 2],
			],
		);
		const positions = packed([
			[1, 0, 0],
			[1, 0, 0.1],
			[0, 1, 0],
		]);
		const owners = Int32Array.from([0, 0, 1]);
		const first = deriveCoastalPortLayout(data, positions, owners);
		const second = deriveCoastalPortLayout(data, positions, owners);

		expect(first.portScores).toEqual(second.portScores);
		expect(first.portDirections).toEqual(second.portDirections);
		for (const nodeIndex of selected(first)) {
			const direction = readVec3(first.portDirections, nodeIndex);
			expect(Math.hypot(...direction)).toBeCloseTo(1, 6);
			expect(
				direction[0] * (positions[nodeIndex * 3] ?? 0) +
					direction[1] * (positions[nodeIndex * 3 + 1] ?? 0) +
					direction[2] * (positions[nodeIndex * 3 + 2] ?? 0),
			).toBeCloseTo(0, 6);
		}
	});
});

describe('coastal port bias', () => {
	it('moves a port toward directional support without exceeding the bound', () => {
		const positions = packed([
			[1, 0, 0],
			[Math.cos(0.1), Math.sin(0.1), 0],
			[Math.cos(0.5), Math.sin(0.5), 0],
		]);
		const ports: CoastalPortLayout = {
			portScores: Float32Array.from([1, 0, 0]),
			portDirections: packed([
				[0, 1, 0],
				[1, 0, 0],
				[1, 0, 0],
			]),
		};
		const result = applyCoastalPortBias(
			positions,
			Int32Array.from([0, 0, 0]),
			ports,
			{ supportQuantile: 1, maximumAngularShift: 0.12 },
		);
		const shift = geodesicDistance(
			readVec3(positions, 0),
			readVec3(result, 0),
		);

		expect(shift).toBeGreaterThan(0.119);
		expect(shift).toBeLessThanOrEqual(0.120001);
		expect(readVec3(result, 1)).toEqual(readVec3(positions, 1));
		expect(readVec3(result, 2)).toEqual(readVec3(positions, 2));
		for (let index = 0; index < 3; index += 1) {
			expect(Math.hypot(...readVec3(result, index))).toBeCloseTo(1, 6);
		}
	});

	it('is deterministic and leaves zero-score nodes in place', () => {
		const positions = packed([
			[1, 0, 0],
			[0, 1, 0],
		]);
		const ports: CoastalPortLayout = {
			portScores: new Float32Array(2),
			portDirections: new Float32Array(6),
		};

		expect(
			applyCoastalPortBias(
				positions,
				Int32Array.from([0, 0]),
				ports,
			),
		).toEqual(
			applyCoastalPortBias(
				positions,
				Int32Array.from([0, 0]),
				ports,
			),
		);
	});
});
