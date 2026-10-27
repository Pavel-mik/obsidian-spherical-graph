import { EMPTY_SEARCH_STATE, type FollowSearchState } from '../search/FollowSearchController';
import { SearchController, type SearchControllerCallbacks } from './SearchController';

export interface GraphSearchCallbacks extends SearchControllerCallbacks {
	onFollowSearchToggle?(enabled: boolean): void;
	onOpenObsidianSearch?(): void;
}

/** A single-row search surface with one explicit source at a time. */
export class GraphSearchControl {
	readonly element: HTMLElement;
	readonly search: SearchController;
	private readonly mode: HTMLSelectElement;
	private readonly results: HTMLElement;
	private readonly openSearch: HTMLButtonElement;
	private readonly query: HTMLElement;
	private readonly count: HTMLElement;
	private readonly clear: HTMLButtonElement;

	constructor(parent: HTMLElement, private readonly callbacks: GraphSearchCallbacks) {
		this.element = parent.createDiv({ cls: 'spherical-graph-search-control' });
		const source = this.element.createDiv({ cls: 'spherical-graph-search-source' });
		this.mode = source.createEl('select', { cls: 'spherical-graph-search-mode' });
		this.mode.setAttribute('aria-label', 'Search mode');
		this.mode.createEl('option', { value: 'notes', text: 'Find a note' });
		this.mode.createEl('option', { value: 'obsidian', text: 'Obsidian search' });
		this.mode.addEventListener('change', this.onModeChange);
		this.search = new SearchController(this.element, callbacks);
		this.results = this.element.createDiv({ cls: 'spherical-graph-follow-search' });
		this.results.hidden = true;
		this.openSearch = this.results.createEl('button', { cls: 'spherical-graph-search-query' });
		this.openSearch.type = 'button';
		this.openSearch.title = 'Open Obsidian search';
		this.query = this.openSearch.createSpan({ cls: 'spherical-graph-search-query-text' });
		const arrow = this.openSearch.createSpan({ text: '↗' });
		arrow.setAttribute('aria-hidden', 'true');
		this.openSearch.addEventListener('click', this.onOpenSearch);
		this.count = this.results.createSpan({ cls: 'spherical-graph-search-status' });
		this.count.setAttribute('role', 'status');
		this.clear = this.results.createEl('button', { text: '×', cls: 'spherical-graph-search-clear' });
		this.clear.type = 'button';
		this.clear.title = 'Clear search highlights';
		this.clear.setAttribute('aria-label', 'Clear search highlights');
		this.clear.addEventListener('click', this.onClear);
		this.update(EMPTY_SEARCH_STATE, 0);
	}

	focus(): void {
		this.mode.value = 'notes';
		this.applyMode();
	}

	update(state: FollowSearchState, visibleCount: number): void {
		const labels = {
			off: 'Show search results',
			waiting: 'Open search…',
			empty: 'Search vault…',
			searching: state.query || 'Searching…',
			ready: state.query,
			unavailable: 'Search unavailable',
		};
		this.query.textContent = labels[state.kind];
		this.openSearch.setAttribute('aria-label', `Open Obsidian search. ${labels[state.kind]}`);
		this.openSearch.title = state.kind === 'unavailable'
			? 'Search results are unavailable in this Obsidian version'
			: `Open Obsidian search${state.query ? `: ${state.query}` : ''}`;
		this.count.textContent = state.kind === 'ready' ? String(visibleCount)
			: state.kind === 'searching' ? '…' : '';
		this.count.title = state.kind === 'ready'
			? `${visibleCount} notes in graph / ${state.paths.size} files found` : '';
		this.count.setAttribute('aria-label', this.count.title || labels[state.kind]);
		this.clear.disabled = state.kind === 'off' || state.kind === 'empty';
	}

	dispose(): void {
		this.mode.removeEventListener('change', this.onModeChange);
		this.openSearch.removeEventListener('click', this.onOpenSearch);
		this.clear.removeEventListener('click', this.onClear);
		this.search.dispose();
		this.element.remove();
	}

	private applyMode(): void {
		const follow = this.mode.value === 'obsidian';
		this.search.dismiss();
		this.search.element.hidden = follow;
		this.results.hidden = !follow;
		this.element.dataset.mode = this.mode.value;
		this.callbacks.onFollowSearchToggle?.(follow);
		if (follow) this.callbacks.onOpenObsidianSearch?.();
		else this.search.focus();
	}

	private readonly onModeChange = (): void => { this.applyMode(); };
	private readonly onOpenSearch = (): void => {
		this.callbacks.onFollowSearchToggle?.(true);
		this.callbacks.onOpenObsidianSearch?.();
	};
	private readonly onClear = (): void => { this.callbacks.onFollowSearchToggle?.(false); };
}
