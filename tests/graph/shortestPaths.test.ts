import { describe, expect, it } from 'vitest';
import {
	canonicalEdgeKey,
	findAllShortestPathUnion,
} from '../../src/graph/shortestPaths';

describe('findAllShortestPathUnion', () => {
	it('returns the union of every equally short path', () => {
		const result = findAllShortestPathUnion(
			6,
			[
				{ source: 0, target: 1 },
				{ source: 1, target: 3 },
				{ source: 0, target: 2 },
				{ source: 2, target: 3 },
				{ source: 0, target: 4 },
				{ source: 4, target: 5 },
				{ source: 5, target: 3 },
			],
			0,
			3,
		);

		expect(result?.distance).toBe(2);
		expect(result?.nodeIndices).toEqual([0, 1, 2, 3]);
		expect(
			result?.edges.map((edge) =>
				canonicalEdgeKey(edge.source, edge.target),
			),
		).toEqual(['0:1', '0:2', '1:3', '2:3']);
	});

	it('returns undefined for disconnected endpoints', () => {
		expect(
			findAllShortestPathUnion(
				4,
				[
					{ source: 0, target: 1 },
					{ source: 2, target: 3 },
				],
				0,
				3,
			),
		).toBeUndefined();
	});

	it('handles a zero-hop route without adding edges', () => {
		expect(findAllShortestPathUnion(1, [], 0, 0)).toEqual({
			distance: 0,
			nodeIndices: [0],
			edges: [],
		});
	});
});
