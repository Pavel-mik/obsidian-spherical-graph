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
		expect(first.territory?.assignedNodeMask).toEqual(
			new Uint8Array([1, 1, 1]),
		);
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

	it('keeps directory territories separated by ocean and root notes outside them', () => {
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
		const territory = initialized.territory;
		const representatives = [0, 2, 3];
		for (let left = 0; left < representatives.length; left += 1) {
			for (let right = left + 1; right < representatives.length; right += 1) {
				const leftNode = representatives[left];
				const rightNode = representatives[right];
				if (leftNode === undefined || rightNode === undefined) {
					continue;
				}
				expect(
					geodesicDistance(
						readVec3(territory.centers, leftNode),
						readVec3(territory.centers, rightNode),
					),
				).toBeGreaterThanOrEqual(
					(territory.maximumDistances[leftNode] ?? 0) +
						(territory.maximumDistances[rightNode] ?? 0) +
						0.075,
				);
			}
		}

		const rootPosition = readVec3(initialized.positions, 6);
		for (const representative of representatives) {
			expect(
				geodesicDistance(
					rootPosition,
					readVec3(territory.centers, representative),
				),
			).toBeGreaterThan(
				(territory.maximumDistances[representative] ?? 0) + 0.075,
			);
		}
		expect(territory.assignedNodeMask[6]).toBe(0);
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
		expect('geography' in payload).toBe(false);
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
