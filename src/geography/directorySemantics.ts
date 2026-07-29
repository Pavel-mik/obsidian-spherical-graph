import type { GraphNode } from '../graph/graphTypes';

function normalizedPath(path: string): string {
	return path.replaceAll('\\', '/').replace(/^\/+/u, '');
}

/**
 * Returns the vault-root folder that owns a note. Root notes deliberately have
 * no owner and are rendered as islands (or as orphan markers over water).
 */
export function topLevelFolder(path: string): string | undefined {
	const normalized = normalizedPath(path);
	const separator = normalized.indexOf('/');
	return separator <= 0 ? undefined : normalized.slice(0, separator);
}

/**
 * Selection regions use the first two folder segments. Deeper descendants
 * remain part of that same understandable root/folder/subfolder cohort.
 */
export function directoryRegionKey(path: string): string | undefined {
	const normalized = normalizedPath(path);
	const parts = normalized.split('/').filter((part) => part.length > 0);
	if (parts.length < 2) {
		return undefined;
	}
	return parts.length >= 3
		? `${parts[0]}/${parts[1]}`
		: parts[0];
}

export function isContinentalNode(node: GraphNode): boolean {
	return node.degree > 0 && topLevelFolder(node.path) !== undefined;
}

export function isRootIslandNode(node: GraphNode): boolean {
	return node.degree > 0 && topLevelFolder(node.path) === undefined;
}
