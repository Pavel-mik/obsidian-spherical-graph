export type SearchRead =
	| { kind: 'empty'; query: string }
	| { kind: 'searching'; query: string }
	| { kind: 'unavailable'; query: string }
	| {
			kind: 'ready';
			query: string;
			paths: ReadonlySet<string>;
			generation: object;
	  };

function record(value: unknown): Record<string, unknown> | undefined {
	return typeof value === 'object' && value !== null
		? (value as Record<string, unknown>)
		: undefined;
}

/** The sole boundary to core Search internals. Never calls or patches Search. */
export function readSearchResults(view: unknown): SearchRead {
	try {
		const source = record(view);
		const input = record(record(source?.searchComponent)?.inputEl);
		const query = input?.value;
		if (typeof query !== 'string') return { kind: 'unavailable', query: '' };
		if (query.trim() === '') return { kind: 'empty', query };
		const dom = record(source?.dom);
		const lookup = dom?.resultDomLookup;
		const compiled = record(source?.searchQuery);
		const controller = record(source?.queue);
		if (
			!dom || !(lookup instanceof Map) || typeof dom.working !== 'boolean' ||
			!controller || !('queue' in controller) || typeof source?.matchingCase !== 'boolean'
		) {
			return { kind: 'unavailable', query };
		}
		const queue = record(controller.queue);
		// A cancelled/debounced/invalid query must never reuse the previous results.
		if (
			!queue || !compiled || compiled.query !== query ||
			compiled.caseSensitive !== source.matchingCase
		) {
			return { kind: 'searching', query };
		}
		const pending = record(queue.items)?.length;
		if (typeof pending !== 'number' || !Number.isFinite(pending) || pending < 0) {
			return { kind: 'unavailable', query };
		}
		if (dom.working || pending > 0) return { kind: 'searching', query };
		const paths = new Set<string>();
		for (const file of lookup.keys()) {
			const path = record(file)?.path;
			if (typeof path !== 'string' || path.length === 0) return { kind: 'unavailable', query };
			paths.add(path);
		}
		return { kind: 'ready', query, paths, generation: queue };
	} catch {
		return { kind: 'unavailable', query: '' };
	}
}

export function equalPaths(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
	if (a.size !== b.size) return false;
	for (const path of a) {
		if (!b.has(path)) return false;
	}
	return true;
}
