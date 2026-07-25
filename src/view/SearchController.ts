import { UI_STRINGS } from '../i18n';
import { RenderNode } from '../render/renderTypes';

export interface SearchControllerCallbacks {
	onSelect(node: RenderNode): void;
	onOpen(node: RenderNode, openInNewLeaf: boolean): void;
	onDismiss?(): void;
}

interface ScoredNode {
	node: RenderNode;
	score: number;
}

export function findSearchResults(
	nodes: readonly RenderNode[],
	query: string,
	limit = 20,
): RenderNode[] {
	const normalized = query.trim().toLocaleLowerCase();
	if (normalized.length === 0 || limit <= 0) {
		return [];
	}
	return nodes
		.map((node): ScoredNode | undefined => {
			const basename = node.basename.toLocaleLowerCase();
			const path = node.path.toLocaleLowerCase();
			const nameScore = fuzzyScore(normalized, basename);
			const pathScore = fuzzyScore(normalized, path);
			const score = Math.max(
				nameScore < 0 ? -1 : nameScore + 30,
				pathScore,
			);
			return score < 0 ? undefined : { node, score };
		})
		.filter((entry): entry is ScoredNode => entry !== undefined)
		.sort(
			(left, right) =>
				right.score - left.score ||
				right.node.degree - left.node.degree ||
				left.node.path.localeCompare(right.node.path),
		)
		.slice(0, limit)
		.map((entry) => entry.node);
}

export class SearchController {
	readonly element: HTMLElement;
	readonly input: HTMLInputElement;
	private readonly resultsElement: HTMLElement;
	private nodes: readonly RenderNode[] = [];
	private results: readonly RenderNode[] = [];
	private activeIndex = -1;
	private selectedResultId: string | undefined;
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

	focus(): void {
		this.input.focus();
		this.input.select();
	}

	clear(): void {
		this.input.value = '';
		this.results = [];
		this.activeIndex = -1;
		this.selectedResultId = undefined;
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
		this.selectedResultId = undefined;
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
		const node = this.results[this.activeIndex];
		if (node === undefined) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		if (
			this.selectedResultId === node.id ||
			event.ctrlKey ||
			event.metaKey
		) {
			this.callbacks.onOpen(node, event.ctrlKey || event.metaKey);
			return;
		}
		this.selectedResultId = node.id;
		this.callbacks.onSelect(node);
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
		this.results = findSearchResults(this.nodes, this.input.value);
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
			const node = this.results[index];
			if (node === undefined) {
				continue;
			}
			const option = this.resultsElement.createEl('button');
			option.type = 'button';
			option.id = `${this.resultsElement.id}-option-${index}`;
			option.className = 'spherical-graph-search-result';
			option.setAttribute('role', 'option');
			const selected = node.id === this.selectedResultId;
			option.setAttribute('aria-selected', String(selected));
			option.dataset.active = String(index === this.activeIndex);

			const name = option.createSpan();
			name.className = 'spherical-graph-search-result-name';
			name.textContent = node.basename;
			const path = option.createSpan();
			path.className = 'spherical-graph-search-result-path';
			path.textContent = node.path;
			option.append(name, path);
			option.addEventListener('pointerenter', () => {
				this.activeIndex = index;
				this.updateActiveOption();
			});
			option.addEventListener('click', () => {
				this.activeIndex = index;
				this.selectedResultId = node.id;
				this.callbacks.onSelect(node);
				this.renderResults();
			});
			option.addEventListener('dblclick', (event) => {
				this.callbacks.onOpen(
					node,
					event.ctrlKey || event.metaKey,
				);
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

	private static nextId = 1;
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
