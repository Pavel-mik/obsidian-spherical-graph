import { describe, expect, it } from 'vitest';
import {
	directoryRegionKey,
	isContinentalNode,
	isRootIslandNode,
	topLevelFolder,
} from '../../src/geography/directorySemantics';
import type { GraphNode } from '../../src/graph/graphTypes';

function node(path: string, degree: number): GraphNode {
	return {
		index: 0,
		id: path,
		path,
		basename: path,
		degree,
		weightedDegree: degree,
		exists: true,
	};
}

describe('directory geography semantics', () => {
	it('derives top-level continent ownership and two-level selection regions', () => {
		expect(topLevelFolder('Books/Fiction/Novel.md')).toBe('Books');
		expect(directoryRegionKey('Books/Fiction/Novel.md')).toBe(
			'Books/Fiction',
		);
		expect(directoryRegionKey('Books/Index.md')).toBe('Books');
		expect(topLevelFolder('Index.md')).toBeUndefined();
		expect(directoryRegionKey('Index.md')).toBeUndefined();
	});

	it('keeps linked folder notes continental and linked root notes as islands', () => {
		expect(isContinentalNode(node('Books/a.md', 1))).toBe(true);
		expect(isContinentalNode(node('Books/a.md', 0))).toBe(false);
		expect(isRootIslandNode(node('Index.md', 1))).toBe(true);
		expect(isRootIslandNode(node('Index.md', 0))).toBe(false);
	});
});
