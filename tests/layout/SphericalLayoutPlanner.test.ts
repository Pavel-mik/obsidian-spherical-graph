import { describe, expect, it } from 'vitest';
import { diffGraphDescriptors } from '../../src/graph/graphDiff';
import type {
	GraphData,
	GraphDescriptor,
	GraphEdge,
} from '../../src/graph/graphTypes';
import type { PersistedLayoutSnapshot } from '../../src/persistence/layoutState';
import { DEFAULT_SPHERICAL_GRAPH_SETTINGS } from '../../src/settings/settings';
import { SphericalLayoutPlanner } from '../../src/layout/SphericalLayoutPlanner';
import { geodesicDistance } from '../../src/geometry/sphericalGeometry';
import { readVec3 } from '../../src/geometry/vector3';
import { initializeDirectoryLayout } from '../../src/layout/directoryInitialization';

function graph(paths: readonly string[], edges: readonly GraphEdge[]): GraphData {
	const degrees = new Uint32Array(paths.length);
	for (const edge of edges) {
		degrees[edge.source] = (degrees[edge.source] ?? 0) + 1;
		degrees[edge.target] = (degrees[edge.target] ?? 0) + 1;
	}
	const descriptor: GraphDescriptor = {
		nodeIds: [...paths],
		edges: edges.map((edge) => {
			const sourceId = paths[edge.source] ?? '';
			const targetId = paths[edge.target] ?? '';
			return sourceId < targetId
				? {
						sourceId,
						targetId,
						weight: edge.weight,
						forwardWeight: edge.forwardWeight,
						backwardWeight: edge.backwardWeight,
					}
				: {
						sourceId: targetId,
						targetId: sourceId,
						weight: edge.weight,
						forwardWeight: edge.backwardWeight,
						backwardWeight: edge.forwardWeight,
					};
		}),
		filterSignature: 'filter',
	};
	return {
		nodes: paths.map((path, index) => ({
			index,
			id: path,
			path,
			basename: path,
			degree: degrees[index] ?? 0,
			weightedDegree: degrees[index] ?? 0,
			exists: true,
		})),
		edges,
		signature: `signature:${paths.join(',')}:${edges.length}`,
		filterSignature: 'filter',
		descriptor,
	};
}

function snapshot(
	previous: GraphData,
	positionsByPath: PersistedLayoutSnapshot['positionsByPath'],
): PersistedLayoutSnapshot {
	return {
		snapshotId: 'snapshot',
		schemaVersion: 2,
		algorithmVersion: 1,
		graphSignature: previous.signature,
		modeThatCreatedIt: 'initialize',
		effectiveSeed: 1,
		renewGeneration: 0,
		completedAt: 1,
		positionsByPath,
		graphDescriptor: previous.descriptor,
	};
}

const LINK: GraphEdge = {
	source: 0,
	target: 1,
	weight: 1,
	forwardWeight: 1,
	backwardWeight: 0,
};

describe('SphericalLayoutPlanner integration', () => {
	it('builds deterministic complete-layout payloads from graph indexes', () => {
		const current = graph(
			['Books/a.md', 'Books/b.md', 'Research/c.md'],
			[
				LINK,
				{
					source: 1,
					target: 2,
					weight: 1,
					forwardWeight: 1,
					backwardWeight: 0,
				},
			],
		);
		const planner = new SphericalLayoutPlanner(
			() => DEFAULT_SPHERICAL_GRAPH_SETTINGS,
		);
		const first = planner.createPayload({
			operationId: 'renew-1',
			mode: 'renew',
			graph: current,
			effectiveSeed: 7,
		});
		const repeated = planner.createPayload({
			operationId: 'renew-1',
			mode: 'renew',
			graph: current,
			effectiveSeed: 7,
		});
		const nextGeneration = planner.createPayload({
			operationId: 'renew-2',
			mode: 'renew',
			graph: current,
			effectiveSeed: 8,
		});
		expect(first.positions).toEqual(repeated.positions);
		expect(first.positions).not.toEqual(nextGeneration.positions);
		expect(first.positions).toEqual(
			initializeDirectoryLayout(current, 7).positions,
		);
		expect(first.edgeEndpoints).toEqual(new Uint32Array([0, 1, 1, 2]));
		expect(first.edgeWeights).toEqual(new Float32Array([1, 0.14]));
		expect(first.folderIndexByNode).toEqual(
			new Int32Array([0, 0, 1]),
		);
		expect(first.regionIndexByNode).toBeInstanceOf(Int32Array);
		expect(first.collisionAngularRadii).toHaveLength(3);
		expect(first.refresh).toBeUndefined();
		expect('geography' in first).toBe(false);

		const initialized = planner.createPayload({
			operationId: 'initialize-1',
			mode: 'initialize',
			graph: current,
			effectiveSeed: 7,
		});
		expect(initialized.positions).toEqual(
			initializeDirectoryLayout(current, 7).positions,
		);
		expect('geography' in initialized).toBe(false);
	});

	it('uses folders and regions as initialization hints while root notes stay ocean islands', () => {
		const current = graph(
			[
				'Books/a.md',
				'Books/b.md',
				'Research/c.md',
				'Projects/d.md',
				'Projects/e.md',
				'Projects/f.md',
				'root.md',
			],
			[
				{ ...LINK, source: 0, target: 1 },
				{ ...LINK, source: 1, target: 6 },
				{ ...LINK, source: 2, target: 6 },
				{ ...LINK, source: 3, target: 4 },
				{ ...LINK, source: 4, target: 5 },
			],
		);
		const initialized = initializeDirectoryLayout(current, 17);
		expect(initialized.folderIndexByNode).toEqual(
			new Int32Array([0, 0, 2, 1, 1, 1, -1]),
		);
		expect(initialized.regionIndexByNode[6]).toBe(-1);
		expect(
			geodesicDistance(
				readVec3(initialized.positions, 0),
				readVec3(initialized.positions, 3),
			),
		).toBeGreaterThan(0.2);
	});

	it('splits a large folder into deterministic irregular topology regions', () => {
		const nodeCount = 81;
		const paths = Array.from(
			{ length: nodeCount },
			(_, index) =>
				`Books/${index % 4 === 0 ? 'History/' : index % 4 === 1 ? 'Science/' : ''}Note-${index}.md`,
		);
		const edges = Array.from(
			{ length: nodeCount - 1 },
			(_, index) => ({
				...LINK,
				source: index,
				target: index + 1,
			}),
		);
		const initialized = initializeDirectoryLayout(
			graph(paths, edges),
			29,
		);
		const regions = new Set<number>();
		const distances: number[] = [];
		for (let index = 0; index < nodeCount; index += 1) {
			regions.add(initialized.regionIndexByNode[index] ?? -1);
			if (index > 0) {
				distances.push(
					geodesicDistance(
						readVec3(initialized.positions, 0),
						readVec3(initialized.positions, index),
					),
				);
			}
		}

		expect(regions.size).toBeGreaterThanOrEqual(3);
		expect(
			new Set(distances.map((distance) => distance.toFixed(3))).size,
		).toBeGreaterThan(12);
		expect(
			initializeDirectoryLayout(graph(paths, edges), 29).positions,
		).toEqual(initialized.positions);
	});

	it('keeps orphan notes fixed on a seeded, non-uniform ocean distribution', () => {
		const nodeCount = 36;
		const current = graph(
			Array.from(
				{ length: nodeCount },
				(_, index) => `Orphan-${index}.md`,
			),
			[],
		);
		const planner = new SphericalLayoutPlanner(
			() => DEFAULT_SPHERICAL_GRAPH_SETTINGS,
		);
		const first = planner.createPayload({
			operationId: 'orphan-layout',
			mode: 'renew',
			graph: current,
			effectiveSeed: 73,
		});
		const repeated = planner.createPayload({
			operationId: 'orphan-layout-repeat',
			mode: 'renew',
			graph: current,
			effectiveSeed: 73,
		});
		expect(first.positions).toEqual(repeated.positions);
		expect(first.movableMask).toEqual(new Uint8Array(nodeCount));

		const sortedY = Array.from(
			{ length: nodeCount },
			(_, index) => first.positions[index * 3 + 1] ?? 0,
		).sort((left, right) => left - right);
		const gaps = sortedY
			.slice(1)
			.map((value, index) => value - (sortedY[index] ?? value));
		const meanGap =
			gaps.reduce((sum, value) => sum + value, 0) /
			Math.max(1, gaps.length);
		const gapDeviation = Math.sqrt(
			gaps.reduce(
				(sum, value) => sum + (value - meanGap) ** 2,
				0,
			) / Math.max(1, gaps.length),
		);
		expect(gapDeviation / meanGap).toBeGreaterThan(0.28);

		let minimumPairDistance = Math.PI;
		for (let left = 0; left < nodeCount; left += 1) {
			for (let right = left + 1; right < nodeCount; right += 1) {
				minimumPairDistance = Math.min(
					minimumPairDistance,
					geodesicDistance(
						readVec3(first.positions, left),
						readVec3(first.positions, right),
					),
				);
			}
		}
		expect(minimumPairDistance).toBeGreaterThan(0.08);
	});

	it('starts old nodes at committed positions and new nodes near neighbors', () => {
		const previous = graph(['a', 'b'], [LINK]);
		const current = graph(
			['a', 'b', 'c'],
			[
				LINK,
				{
					source: 1,
					target: 2,
					weight: 1,
					forwardWeight: 1,
					backwardWeight: 0,
				},
			],
		);
		const diff = diffGraphDescriptors(
			previous.descriptor,
			current.descriptor,
			current.signature,
			[],
			previous.signature,
		);
		const saved = snapshot(previous, {
			a: [1, 0, 0],
			b: [0, 1, 0],
		});
		const planner = new SphericalLayoutPlanner(
			() => DEFAULT_SPHERICAL_GRAPH_SETTINGS,
		);
		const payload = planner.createPayload({
			operationId: 'refresh',
			mode: 'refresh',
			graph: current,
			committedSnapshot: saved,
			diff,
			effectiveSeed: 19,
		});
		expect(readVec3(payload.positions, 0)).toEqual([1, 0, 0]);
		expect(readVec3(payload.positions, 1)).toEqual([0, 1, 0]);
		expect(payload.refresh?.newNodeMask).toEqual(
			new Uint8Array([0, 0, 1]),
		);
		expect(payload.refresh?.anchorPositions).not.toBe(
			payload.positions,
		);
		const refreshPlan = planner.lastRefreshPlan;
		expect(refreshPlan).not.toBeNull();
		expect(payload.refresh?.anchorStrengths).not.toBe(
			refreshPlan?.anchorStrengths,
		);
		expect(payload.refresh?.maxAnchorDistances).not.toBe(
			refreshPlan?.maxAnchorDistances,
		);
		expect(payload.refresh?.anchorStrengths).toEqual(
			refreshPlan?.anchorStrengths,
		);
		expect(payload.refresh?.maxAnchorDistances).toEqual(
			refreshPlan?.maxAnchorDistances,
		);
		expect('geography' in payload).toBe(false);
	});

	it('keeps a newly added orphan on its seeded ocean point during Refresh', () => {
		const previous = graph(['Books/a.md', 'Books/b.md'], [LINK]);
		const current = graph(
			['Books/a.md', 'Books/b.md', 'new-orphan.md'],
			[LINK],
		);
		const diff = diffGraphDescriptors(
			previous.descriptor,
			current.descriptor,
			current.signature,
			[],
			previous.signature,
		);
		const planner = new SphericalLayoutPlanner(
			() => DEFAULT_SPHERICAL_GRAPH_SETTINGS,
		);
		const effectiveSeed = 41;
		const payload = planner.createPayload({
			operationId: 'refresh-orphan',
			mode: 'refresh',
			graph: current,
			effectiveSeed,
			committedSnapshot: snapshot(previous, {
				'Books/a.md': [1, 0, 0],
				'Books/b.md': [0, 1, 0],
			}),
			diff,
		});
		const expected = initializeDirectoryLayout(
			current,
			effectiveSeed,
		).positions;

		expect(payload.refresh?.newNodeMask[2]).toBe(0);
		expect(payload.refresh?.relaxationMovableMask[2]).toBe(0);
		expect(readVec3(payload.positions, 2)).toEqual(
			readVec3(expected, 2),
		);
	});

	it('carries a reliable renamed node position through a topology refresh', () => {
		const previous = graph(['b', 'old'], [LINK]);
		const current = graph(
			['b', 'new', 'third'],
			[
				LINK,
				{
					source: 1,
					target: 2,
					weight: 1,
					forwardWeight: 1,
					backwardWeight: 0,
				},
			],
		);
		const diff = diffGraphDescriptors(
			previous.descriptor,
			current.descriptor,
			current.signature,
			[
				{
					oldPath: 'old',
					newPath: 'new',
					reliability: 'reliable',
				},
			],
			previous.signature,
		);
		expect(diff.requiresLayout).toBe(true);
		const saved = snapshot(previous, {
			b: [0, 1, 0],
			old: [1, 0, 0],
		});
		const planner = new SphericalLayoutPlanner(
			() => DEFAULT_SPHERICAL_GRAPH_SETTINGS,
		);
		const payload = planner.createPayload({
			operationId: 'rename-refresh',
			mode: 'refresh',
			graph: current,
			committedSnapshot: saved,
			diff,
			effectiveSeed: 20,
		});
		expect(readVec3(payload.positions, 1)).toEqual([1, 0, 0]);
		expect(payload.refresh?.existingNodeMask[1]).toBe(1);
	});
});
