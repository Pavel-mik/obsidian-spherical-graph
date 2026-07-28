import { UI_STRINGS } from '../i18n';
import { RenderNode, RenderTag } from '../render/renderTypes';

export interface SearchControllerCallbacks {
	onSelect(node: RenderNode): void;
	onSelectTag(tag: RenderTag): void;
	onOpen(node: RenderNode, openInNewLeaf: boolean): void;
	onDismiss?(): void;
}

export type SearchResult =
	| { kind: 'node'; node: RenderNode }
	| { kind: 'tag'; tag: RenderTag };

interface ScoredResult {
	result: SearchResult;
	score: number;
	degree: number;
	sortKey: string;
}

export function findSearchResults(
	nodes: readonly RenderNode[],
	query: string,
	limit = 20,
): RenderNode[] {
	return findGraphSearchResults(nodes, [], query, limit)
		.filter(
			(result): result is Extract<SearchResult, { kind: 'node' }> =>
				result.kind === 'node',
		)
		.map((result) => result.node);
}

export function findGraphSearchResults(
	nodes: readonly RenderNode[],
	tags: readonly RenderTag[],
	query: string,
	limit = 20,
): SearchResult[] {
	const normalized = query.trim().toLocaleLowerCase();
	if (normalized.length === 0 || limit <= 0) {
		return [];
	}
	const nodeResults = nodes
		.map((node): ScoredResult | undefined => {
			const basename = node.basename.toLocaleLowerCase();
			const path = node.path.toLocaleLowerCase();
			const nameScore = fuzzyScore(normalized, basename);
			const pathScore = fuzzyScore(normalized, path);
			const score = Math.max(
				nameScore < 0 ? -1 : nameScore + 30,
				pathScore,
			);
			return score < 0
				? undefined
				: {
						result: { kind: 'node', node },
						score,
						degree: node.degree,
						sortKey: node.path,
					};
		})
		.filter((entry): entry is ScoredResult => entry !== undefined);
	const tagResults = tags
		.map((tag): ScoredResult | undefined => {
			const label = tag.label.toLocaleLowerCase();
			const name = label.startsWith('#') ? label.slice(1) : label;
			const labelScore = fuzzyScore(normalized, label);
			const nameScore = fuzzyScore(
				normalized.startsWith('#') ? normalized.slice(1) : normalized,
				name,
			);
			const hashIntentBoost = normalized.startsWith('#') ? 80 : 0;
			const score = Math.max(
				labelScore,
				nameScore < 0 ? -1 : nameScore + 20 + hashIntentBoost,
			);
			return score < 0
				? undefined
				: {
						result: { kind: 'tag', tag },
						score,
						degree: tag.nodeIndices.length,
						sortKey: tag.label,
					};
		})
		.filter((entry): entry is ScoredResult => entry !== undefined);

	return [...nodeResults, ...tagResults]
		.sort(
			(left, right) =>
				right.score - left.score ||
				right.degree - left.degree ||
				left.sortKey.localeCompare(right.sortKey),
		)
		.slice(0, limit)
		.map((entry) => entry.result);
}

export class SearchController {
	readonly element: HTMLElement;
	readonly input: HTMLInputElement;
	private readonly resultsElement: HTMLElement;
	private nodes: readonly RenderNode[] = [];
	private tags: readonly RenderTag[] = [];
	private results: readonly SearchResult[] = [];
	private activeIndex = -1;
	private selectedResultKey: string | undefined;
	private disposed = false;

	constructor(
		parent: HTMLElement,
		private readonly callbacks: SearchControllerCallbacks,
	) {
		this.element = parent.createDiv();
		this.element.className = 'spherical-graph-search';

		this.input = this.element.createEl('input');
		this.input.type = 'search';
		this.input.className = 'spherical-graph-search-input';
		this.input.placeholder = UI_STRINGS.searchPlaceholder;
		this.input.setAttribute('aria-label', UI_STRINGS.searchPlaceholder);
		this.input.setAttribute('role', 'combobox');
		this.input.setAttribute('aria-autocomplete', 'list');
		this.input.setAttribute('aria-expanded', 'false');

		this.resultsElement = this.element.createDiv();
		this.resultsElement.id = `spherical-graph-search-results-${SearchController.nextId++}`;
		this.resultsElement.className = 'spherical-graph-search-results';
		this.resultsElement.setAttribute('role', 'listbox');
		this.resultsElement.hidden = true;
		this.input.setAttribute('aria-controls', this.resultsElement.id);

		this.element.append(this.input, this.resultsElement);
		parent.append(this.element);
		this.input.addEventListener('input', this.onInput);
		this.input.addEventListener('keydown', this.onKeyDown);
		this.input.addEventListener('keyup', this.onKeyUp);
	}

	setNodes(nodes: readonly RenderNode[]): void {
		this.nodes = nodes;
		this.refreshResults();
	}

	setTags(tags: readonly RenderTag[]): void {
		this.tags = tags;
		this.refreshResults();
	}

	focus(): void {
		this.input.focus();
		this.input.select();
	}

	clear(): void {
		this.input.value = '';
		this.results = [];
		this.activeIndex = -1;
		this.selectedResultKey = undefined;
		this.renderResults();
	}

	dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		this.input.removeEventListener('input', this.onInput);
		this.input.removeEventListener('keydown', this.onKeyDown);
		this.input.removeEventListener('keyup', this.onKeyUp);
		this.element.remove();
	}

	private readonly onInput = (): void => {
		this.selectedResultKey = undefined;
		this.refreshResults();
	};

	private readonly onKeyDown = (event: KeyboardEvent): void => {
		switch (event.key) {
			case 'ArrowDown':
				event.preventDefault();
				event.stopPropagation();
				this.moveActive(1);
				break;
			case 'ArrowUp':
				event.preventDefault();
				event.stopPropagation();
				this.moveActive(-1);
				break;
			case 'Enter':
				this.activateCurrent(event);
				break;
			case 'Escape':
				event.preventDefault();
				event.stopPropagation();
				this.clear();
				this.callbacks.onDismiss?.();
				break;
		}
	};

	private readonly onKeyUp = (event: KeyboardEvent): void => {
		if (
			event.key === 'ArrowDown' ||
			event.key === 'ArrowUp' ||
			event.key === 'Enter' ||
			event.key === 'Escape'
		) {
			event.preventDefault();
			event.stopPropagation();
		}
	};

	private activateCurrent(event: KeyboardEvent): void {
		const result = this.results[this.activeIndex];
		if (result === undefined) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		if (
			result.kind === 'node' &&
			(this.selectedResultKey === searchResultKey(result) ||
				event.ctrlKey ||
				event.metaKey)
		) {
			this.callbacks.onOpen(
				result.node,
				event.ctrlKey || event.metaKey,
			);
			return;
		}
		this.selectResult(result);
		this.renderResults();
	}

	private moveActive(delta: number): void {
		if (this.results.length === 0) {
			this.activeIndex = -1;
			return;
		}
		this.activeIndex =
			(this.activeIndex + delta + this.results.length) %
			this.results.length;
		this.renderResults();
	}

	private refreshResults(): void {
		this.results = findGraphSearchResults(
			this.nodes,
			this.tags,
			this.input.value,
		);
		this.activeIndex = this.results.length > 0 ? 0 : -1;
		this.renderResults();
	}

	private renderResults(): void {
		this.resultsElement.replaceChildren();
		const hasResults = this.results.length > 0;
		this.resultsElement.hidden = !hasResults;
		this.input.setAttribute('aria-expanded', String(hasResults));
		this.input.removeAttribute('aria-activedescendant');

		for (let index = 0; index < this.results.length; index += 1) {
			const result = this.results[index];
			if (result === undefined) {
				continue;
			}
			const option = this.resultsElement.createEl('button');
			option.type = 'button';
			option.id = `${this.resultsElement.id}-option-${index}`;
			option.className = 'spherical-graph-search-result';
			option.setAttribute('role', 'option');
			option.dataset.kind = result.kind;
			const selected =
				searchResultKey(result) === this.selectedResultKey;
			option.setAttribute('aria-selected', String(selected));
			option.dataset.active = String(index === this.activeIndex);

			const name = option.createSpan();
			name.className = 'spherical-graph-search-result-name';
			name.textContent =
				result.kind === 'node'
					? result.node.basename
					: result.tag.label;
			const path = option.createSpan();
			path.className = 'spherical-graph-search-result-path';
			path.textContent =
				result.kind === 'node'
					? result.node.path
					: `Tag · ${result.tag.nodeIndices.length} ${
							result.tag.nodeIndices.length === 1
								? 'note'
								: 'notes'
						}`;
			option.append(name, path);
			option.addEventListener('pointerenter', () => {
				this.activeIndex = index;
				this.updateActiveOption();
			});
			option.addEventListener('click', () => {
				this.activeIndex = index;
				this.selectResult(result);
				this.renderResults();
			});
			option.addEventListener('dblclick', (event) => {
				if (result.kind === 'node') {
					this.callbacks.onOpen(
						result.node,
						event.ctrlKey || event.metaKey,
					);
				} else {
					this.selectResult(result);
				}
			});
			this.resultsElement.append(option);
		}

		this.updateActiveOption();
	}

	private updateActiveOption(): void {
		for (
			let index = 0;
			index < this.resultsElement.children.length;
			index += 1
		) {
			const child = this.resultsElement.children.item(index);
			if (child !== null) {
				(child as HTMLElement).dataset.active = String(
					index === this.activeIndex,
				);
			}
		}
		const active = this.resultsElement.children.item(this.activeIndex);
		if (active !== null) {
			const activeElement = active as HTMLElement;
			this.input.setAttribute('aria-activedescendant', activeElement.id);
			activeElement.scrollIntoView({ block: 'nearest' });
		} else {
			this.input.removeAttribute('aria-activedescendant');
		}
	}

	private selectResult(result: SearchResult): void {
		this.selectedResultKey = searchResultKey(result);
		if (result.kind === 'node') {
			this.callbacks.onSelect(result.node);
		} else {
			this.callbacks.onSelectTag(result.tag);
		}
	}

	private static nextId = 1;
}

function searchResultKey(result: SearchResult): string {
	return result.kind === 'node'
		? `node:${result.node.id}`
		: `tag:${result.tag.id}`;
}

function fuzzyScore(query: string, candidate: string): number {
	if (query === candidate) {
		return 1_000;
	}
	if (candidate.startsWith(query)) {
		return 800 - (candidate.length - query.length);
	}
	const substringIndex = candidate.indexOf(query);
	if (substringIndex >= 0) {
		return 600 - substringIndex * 2 - (candidate.length - query.length) * 0.1;
	}

	let queryIndex = 0;
	let firstMatch = -1;
	let previousMatch = -2;
	let consecutive = 0;
	let gaps = 0;
	for (
		let candidateIndex = 0;
		candidateIndex < candidate.length && queryIndex < query.length;
		candidateIndex += 1
	) {
		if (candidate[candidateIndex] !== query[queryIndex]) {
			continue;
		}
		if (firstMatch < 0) {
			firstMatch = candidateIndex;
		}
		if (candidateIndex === previousMatch + 1) {
			consecutive += 1;
		} else if (previousMatch >= 0) {
			gaps += candidateIndex - previousMatch - 1;
		}
		previousMatch = candidateIndex;
		queryIndex += 1;
	}
	return queryIndex === query.length
		? 300 + consecutive * 10 - gaps * 3 - firstMatch
		: -1;
}
