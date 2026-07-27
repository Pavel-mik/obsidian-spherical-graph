import { describe, expect, it } from 'vitest';
import {
	DEFAULT_RENDER_FILTERS,
	isRenderNodeVisible,
} from '../../src/render/renderFilters';
import type { RenderNode } from '../../src/render/renderTypes';

function node(
	kind: RenderNode['kind'],
	isOrphan = false,
): RenderNode {
	return {
		index: 0,
		id: kind ?? 'note',
		path: `${kind ?? 'note'}.md`,
		basename: kind ?? 'note',
		degree: isOrphan ? 0 : 1,
		weightedDegree: isOrphan ? 0 : 1,
		kind,
		isOrphan,
	};
}

describe('render filters', () => {
	it('matches the classic graph defaults without changing positions', () => {
		expect(isRenderNodeVisible(node('note'), DEFAULT_RENDER_FILTERS))
			.toBe(true);
		expect(
			isRenderNodeVisible(
				node('attachment'),
				DEFAULT_RENDER_FILTERS,
			),
		).toBe(false);
		expect(
			isRenderNodeVisible(
				node('unresolved'),
				DEFAULT_RENDER_FILTERS,
			),
		).toBe(false);
	});

	it('filters orphan nodes independently of their kind', () => {
		const filters = {
			...DEFAULT_RENDER_FILTERS,
			showAttachments: true,
			existingFilesOnly: false,
			showOrphans: false,
		};
		expect(isRenderNodeVisible(node('note', true), filters)).toBe(false);
		expect(
			isRenderNodeVisible(node('attachment', true), filters),
		).toBe(false);
		expect(
			isRenderNodeVisible(node('unresolved', false), filters),
		).toBe(true);
	});
});
