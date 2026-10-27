import { renderNodeKind } from './renderFilters';
import type { RenderNode } from './renderTypes';

export const SEARCH_HIGHLIGHT_COLOR = '#963652';

export function isSearchMatch(node: RenderNode, paths: ReadonlySet<string>): boolean {
	return renderNodeKind(node) === 'note' && paths.has(node.path);
}
