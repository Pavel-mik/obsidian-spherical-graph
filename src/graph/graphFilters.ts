import {
	DEFAULT_GRAPH_FILTER_OPTIONS,
	GraphFilterOptions,
} from "./graphTypes";

function compareCodeUnits(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

export function normalizeVaultPath(path: string): string {
	const normalized = path
		.trim()
		.replaceAll("\\", "/")
		.replace(/^\/+/, "")
		.replace(/\/+/g, "/");
	return normalized === "." ? "" : normalized;
}

export function normalizeExcludedPrefix(prefix: string): string {
	return normalizeVaultPath(prefix).replace(/\/+$/, "");
}

export function normalizeGraphFilterOptions(
	input: Partial<GraphFilterOptions> | undefined,
): GraphFilterOptions {
	const prefixes = (input?.excludedFolderPrefixes ??
		DEFAULT_GRAPH_FILTER_OPTIONS.excludedFolderPrefixes)
		.map(normalizeExcludedPrefix)
		.filter((prefix) => prefix.length > 0);

	return Object.freeze({
		excludedFolderPrefixes: Object.freeze(
			[...new Set(prefixes)].sort(compareCodeUnits),
		),
		includeOrphans:
			typeof input?.includeOrphans === "boolean"
				? input.includeOrphans
				: DEFAULT_GRAPH_FILTER_OPTIONS.includeOrphans,
	});
}

export function isPathExcluded(
	path: string,
	excludedFolderPrefixes: readonly string[],
): boolean {
	const normalizedPath = normalizeVaultPath(path);
	return excludedFolderPrefixes.some(
		(prefix) =>
			normalizedPath === prefix ||
			normalizedPath.startsWith(`${prefix}/`),
	);
}

export function compareGraphIds(left: string, right: string): number {
	return compareCodeUnits(left, right);
}
