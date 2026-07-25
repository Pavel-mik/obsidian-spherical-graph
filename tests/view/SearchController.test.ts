import { describe, expect, it } from 'vitest';
import { RenderNode } from '../../src/render/renderTypes';
import { findSearchResults } from '../../src/view/SearchController';

const nodes: RenderNode[] = [
	{
		index: 0,
		id: 'daily',
		path: 'Journal/Daily note.md',
		basename: 'Daily note',
		degree: 2,
		weightedDegree: 2,
	},
	{
		index: 1,
		id: 'design',
		path: 'Projects/Spherical graph design.md',
		basename: 'Spherical graph design',
		degree: 7,
		weightedDegree: 9,
	},
	{
		index: 2,
		id: 'sphere',
		path: 'Math/Sphere.md',
		basename: 'Sphere',
		degree: 1,
		weightedDegree: 1,
	},
];

describe('findSearchResults', () => {
	it('ranks basename matches before path-only and subsequence matches', () => {
		const results = findSearchResults(nodes, 'sphere');

		expect(results[0]?.id).toBe('sphere');
		expect(results.map((node) => node.id)).toContain('design');
		expect(findSearchResults(nodes, 'proj')[0]?.id).toBe('design');
		expect(findSearchResults(nodes, 'sgd')[0]?.id).toBe('design');
	});

	it('is empty for blank queries and obeys the result limit', () => {
		expect(findSearchResults(nodes, '  ')).toEqual([]);
		expect(findSearchResults(nodes, 'a', 1)).toHaveLength(1);
	});
});
