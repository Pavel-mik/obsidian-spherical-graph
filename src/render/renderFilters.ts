import type { RenderNode } from './renderTypes';

export interface RenderFilterState {
	readonly showTags: boolean;
	readonly showAttachments: boolean;
	readonly existingFilesOnly: boolean;
	readonly showOrphans: boolean;
}

export const DEFAULT_RENDER_FILTERS: RenderFilterState = Object.freeze({
	showTags: true,
	showAttachments: false,
	existingFilesOnly: true,
	showOrphans: true,
});

export function renderNodeKind(
	node: RenderNode,
): NonNullable<RenderNode['kind']> {
	return node.kind ?? 'note';
}

export function isRenderNodeOrphan(node: RenderNode): boolean {
	return node.isOrphan ?? node.degree === 0;
}

export function isRenderNodeVisible(
	node: RenderNode,
	filters: RenderFilterState,
): boolean {
	if (!filters.showOrphans && isRenderNodeOrphan(node)) {
		return false;
	}
	switch (renderNodeKind(node)) {
		case 'attachment':
			return filters.showAttachments;
		case 'unresolved':
			return !filters.existingFilesOnly;
		case 'note':
			return true;
	}
}
