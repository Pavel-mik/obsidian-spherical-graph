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
import { readVec3 } from '../../src/geometry/vector3';

function graph(paths: readonly string[], edges: readonly GraphEdge[]): GraphData {
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
			degree: 0,
			weightedDegree: 0,
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
		const current = graph(['a', 'b', 'c'], [LINK]);
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
		expect(first.edgeEndpoints).toEqual(new Uint32Array([0, 1]));
		expect(first.refresh).toBeUndefined();
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
