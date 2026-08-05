import { describe, expect, it } from 'vitest';

import { GraphDataService } from '../../src/graph/GraphDataService';
import type { GraphDataSource } from '../../src/graph/graphTypes';
import {
	createPersistedGraphCache,
	restoreGraphData,
	validatePersistedGraphCache,
} from '../../src/persistence/graphCache';

function graphWithMetadata() {
	const source: GraphDataSource = {
		getMarkdownFiles: () => [
			{ path: 'Books/A.md', basename: 'Alpha', tags: ['#book'] },
			{ path: 'Books/B.md', basename: 'Beta', tags: ['#book', '#todo'] },
		],
		getAttachmentFiles: () => [
			{ path: 'assets/cover.png', basename: 'cover' },
		],
		getResolvedLinks: () => ({
			'Books/A.md': { 'Books/B.md': 1, 'assets/cover.png': 1 },
		}),
		getUnresolvedLinks: () => ({
			'Books/B.md': { 'Missing.md': 1 },
		}),
	};
	return new GraphDataService(source).buildGraph();
}

describe('persisted graph cache', () => {
	it('restores labels, tags, attachments, and unresolved nodes without a vault scan', () => {
		const original = graphWithMetadata();
		const cache = createPersistedGraphCache(original);
		const restored = restoreGraphData(
			original.descriptor,
			original.signature,
			cache,
		);

		expect(restored).toEqual(original);
		expect(restored.nodes[1]?.tags).toEqual(['#book', '#todo']);
		expect(restored.auxiliaryNodes?.map((node) => node.kind)).toEqual([
			'attachment',
			'unresolved',
		]);
	});

	it('falls back to descriptor-only notes for pre-cache saved maps', () => {
		const original = graphWithMetadata();
		const restored = restoreGraphData(
			original.descriptor,
			original.signature,
			undefined,
		);

		expect(restored.nodes.map((node) => node.basename)).toEqual(['A', 'B']);
		expect(restored.nodes.every((node) => node.tags?.length === 0)).toBe(true);
		expect(restored.auxiliaryNodes).toEqual([]);
	});

	it('rejects malformed cache data', () => {
		expect(
			validatePersistedGraphCache({
				version: 1,
				graphSignature: 'graph',
				nodes: [{ id: 'A.md', basename: 'A', tags: [7] }],
				auxiliaryNodes: [],
				auxiliaryEdges: [],
			}),
		).toBeUndefined();
	});
});
