import { describe, expect, it } from 'vitest';
import {
	createContinentLayoutPlan,
	createPersistedContinentalGeography,
	initializeContinentalLayout,
} from '../../src/geography/continentalLayout';
import { geodesicDistance } from '../../src/geometry/sphericalGeometry';
import { readVec3 } from '../../src/geometry/vector3';
import type {
	GraphData,
	GraphEdge,
	GraphNode,
} from '../../src/graph/graphTypes';

function fixtureGraph(): GraphData {
	const nodes: GraphNode[] = Array.from({ length: 26 }, (_, index) => {
		const group = index < 10 ? 'Research' : index < 20 ? 'Books' : 'Loose';
		return {
			index,
			id: `${group}/note-${index}.md`,
			path: `${group}/note-${index}.md`,
			basename: `note-${index}`,
			degree: 0,
			weightedDegree: 0,
			exists: true,
		};
	});
	const edges: GraphEdge[] = [];
	for (const start of [0, 10]) {
		for (let left = start; left < start + 10; left += 1) {
			for (let right = left + 1; right < start + 10; right += 1) {
				edges.push({
					source: left,
					target: right,
					weight: 1,
					forwardWeight: 1,
					backwardWeight: 0,
				});
			}
		}
	}
	edges.push({
		source: 0,
		target: 10,
		weight: 1,
		forwardWeight: 1,
		backwardWeight: 0,
	});
	return {
		nodes,
		edges,
		signature: 'continental-fixture',
		filterSignature: 'filters',
		descriptor: {
			nodeIds: nodes.map((node) => node.id),
			edges: edges.map((edge) => ({
				sourceId: nodes[edge.source]?.id ?? '',
				targetId: nodes[edge.target]?.id ?? '',
				weight: edge.weight,
				forwardWeight: edge.forwardWeight,
				backwardWeight: edge.backwardWeight,
			})),
			filterSignature: 'filters',
		},
	};
}

describe('continent-aware spherical initialization', () => {
	it('places continent members inside separated intrinsic caps', () => {
		const graph = fixtureGraph();
		const plan = createContinentLayoutPlan(graph, 42);
		const positions = initializeContinentalLayout(graph, plan, 42);

		expect(plan.continents).toHaveLength(2);
		for (let index = 0; index < graph.nodes.length; index += 1) {
			expect(Math.hypot(...readVec3(positions, index))).toBeCloseTo(1, 6);
			const continentIndex = plan.assignmentByNode[index] ?? -1;
			if (continentIndex < 0) {
				continue;
			}
			const continent = plan.continents[continentIndex];
			expect(continent).toBeDefined();
			expect(
				geodesicDistance(
					readVec3(positions, index),
					continent?.center ?? [1, 0, 0],
				),
			).toBeLessThan(continent?.capRadius ?? 0);
		}
		const separation = geodesicDistance(
			plan.continents[0]?.center ?? [1, 0, 0],
			plan.continents[1]?.center ?? [-1, 0, 0],
		);
		expect(separation).toBeGreaterThan(
			(plan.continents[0]?.capRadius ?? 0) +
				(plan.continents[1]?.capRadius ?? 0) +
				0.2,
		);
	});

	it('persists real folder-derived names and leaves loose notes as islands', () => {
		const graph = fixtureGraph();
		const plan = createContinentLayoutPlan(graph, 17);
		const positions = initializeContinentalLayout(graph, plan, 17);
		const geography = createPersistedContinentalGeography(
			graph,
			positions,
			17,
		);

		expect(geography.continents.map((continent) => continent.label).sort()).toEqual([
			'Books',
			'Research',
		]);
		expect(geography.islandNodeIds).toHaveLength(6);
		expect(geography.continents.every((continent) => continent.capRadius < 0.8)).toBe(true);
	});

	it('reuses matched continent identity, color, and center on refresh', () => {
		const graph = fixtureGraph();
		const firstPlan = createContinentLayoutPlan(graph, 23);
		const positions = initializeContinentalLayout(graph, firstPlan, 23);
		const previous = createPersistedContinentalGeography(
			graph,
			positions,
			23,
		);
		const nextPlan = createContinentLayoutPlan(graph, 23, previous);

		expect(nextPlan.continents.map((continent) => continent.id)).toEqual(
			previous.continents.map((continent) => continent.id),
		);
		expect(nextPlan.continents.map((continent) => continent.colorIndex)).toEqual(
			previous.continents.map((continent) => continent.colorIndex),
		);
		expect(nextPlan.continents.map((continent) => continent.center)).toEqual(
			previous.continents.map((continent) => continent.center),
		);
	});
});
