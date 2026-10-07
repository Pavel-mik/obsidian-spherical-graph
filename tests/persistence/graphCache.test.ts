import { describe, expect, it, vi } from 'vitest';

import { GraphDataService } from '../../src/graph/GraphDataService';
import type { GraphDataSource } from '../../src/graph/graphTypes';
import {
	createPersistedGraphCache,
	restoreGraphData,
	restoreSavedGraph,
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

	it('rebuilds missing metadata without replacing saved topology or adding local notes', async () => {
		const saved = graphWithMetadata();
		const local = new GraphDataService({
			getMarkdownFiles: () => [
				{ path: 'Books/A.md', basename: 'Alpha', tags: ['#updated'] },
				{ path: 'new.md', basename: 'new' },
			],
			getResolvedLinks: () => ({ 'Books/A.md': { 'new.md': 1, 'assets/cover.png': 1 } }),
			getAttachmentFiles: () => [{ path: 'assets/cover.png', basename: 'cover' }],
			getUnresolvedLinks: () => ({ 'Books/A.md': { 'Missing.md': 1 }, 'new.md': { 'OnlyNew.md': 1 } }),
		}).buildGraph();
		const scan = vi.fn(async () => local);
		const restored = await restoreSavedGraph(saved.descriptor, saved.signature, undefined, scan);
		expect(scan).toHaveBeenCalledOnce();
		expect(restored.signature).toBe(saved.signature);
		expect(restored.descriptor).toBe(saved.descriptor);
		expect(restored.edges).toEqual(saved.edges);
		expect(restored.nodes.map((node) => node.id)).toEqual(saved.nodes.map((node) => node.id));
		expect(restored.nodes[0]?.tags).toEqual(['#updated']);
		expect(restored.auxiliaryNodes?.map((node) => node.id)).toEqual(['assets/cover.png', 'unresolved:Missing.md']);
	});

	it('uses complete matching cache without scanning, but rebuilds a mismatching cache', async () => {
		const saved = graphWithMetadata();
		const scan = vi.fn(async () => saved);
		const cache = createPersistedGraphCache(saved);
		expect(await restoreSavedGraph(saved.descriptor, saved.signature, cache, scan)).toEqual(saved);
		expect(scan).not.toHaveBeenCalled();
		expect(await restoreSavedGraph(saved.descriptor, saved.signature, { ...cache, graphSignature: 'stale' }, scan)).toEqual(saved);
		expect(scan).toHaveBeenCalledOnce();
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
