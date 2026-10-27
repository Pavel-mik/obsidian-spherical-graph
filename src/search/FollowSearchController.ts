import { View, type EventRef, type Workspace, type WorkspaceLeaf } from 'obsidian';
import { equalPaths, readSearchResults, type SearchRead } from './SearchResultsAdapter';

export interface FollowSearchState {
	readonly kind: 'off' | 'waiting' | 'empty' | 'searching' | 'ready' | 'unavailable';
	readonly query: string;
	readonly paths: ReadonlySet<string>;
}

export const EMPTY_SEARCH_STATE: FollowSearchState = {
	kind: 'off', query: '', paths: new Set(),
};

/** One subscription per open graph; polling exists only while explicitly enabled. */
export class FollowSearchController {
	private source: WorkspaceLeaf | undefined;
	private timer: number | undefined;
	private readonly activeLeafRef: EventRef;
	private candidate: Extract<SearchRead, { kind: 'ready' }> | undefined;
	private state = EMPTY_SEARCH_STATE;
	private disposed = false;
	private enabled = false;
	private openRequest = 0;

	constructor(
		private readonly workspace: Workspace,
		private readonly onChange: (state: FollowSearchState) => void,
		private readonly timerWindow: Pick<Window, 'setInterval' | 'clearInterval'> = window,
	) {
		this.activeLeafRef = workspace.on('active-leaf-change', (leaf) => {
			if (leaf?.view.getViewType() !== 'search' || leaf === this.source) return;
			this.source = leaf;
			this.candidate = undefined;
			if (this.timer !== undefined) this.poll();
		});
	}

	setEnabled(enabled: boolean): void {
		this.enabled = enabled;
		this.openRequest += 1;
		this.stopTimer();
		this.candidate = undefined;
		if (this.disposed) return;
		if (!enabled) {
			this.publish(EMPTY_SEARCH_STATE);
			return;
		}
		const leaves = this.workspace.getLeavesOfType('search');
		const activeView = this.workspace.getActiveViewOfType(View);
		const active = leaves.find((leaf) => leaf.view === activeView);
		this.source = active ??
			(this.source && leaves.includes(this.source) ? this.source : leaves[0]);
		this.timer = this.timerWindow.setInterval(() => this.poll(), 250);
		this.poll();
	}

	dispose(): void {
		this.disposed = true;
		this.enabled = false;
		this.openRequest += 1;
		this.stopTimer();
		this.workspace.offref(this.activeLeafRef);
		this.source = undefined;
		this.candidate = undefined;
	}

	/** Opening the pane uses public Workspace APIs; the search engine stays untouched. */
	async openSearch(): Promise<void> {
		if (this.disposed) return;
		const request = ++this.openRequest;
		const leaves = this.workspace.getLeavesOfType('search');
		const existing = this.source && leaves.includes(this.source) ? this.source : leaves[0];
		const leaf = existing ?? this.workspace.getLeftLeaf(false);
		if (!leaf) return;
		if (!existing) await leaf.setViewState({ type: 'search', active: true });
		if (this.disposed || request !== this.openRequest) return;
		await this.workspace.revealLeaf(leaf);
		if (this.disposed || request !== this.openRequest) return;
		this.workspace.setActiveLeaf(leaf, { focus: true });
		this.source = leaf;
		this.candidate = undefined;
		// Restored leaves may be deferred until revealLeaf finishes. Retry once
		// after that public lifecycle boundary, even if the early read stopped.
		if (this.enabled && this.timer === undefined) {
			this.timer = this.timerWindow.setInterval(() => this.poll(), 250);
		}
		if (this.timer !== undefined) this.poll();
	}

	private poll(): void {
		if (!this.source || !this.workspace.getLeavesOfType('search').includes(this.source)) {
			this.candidate = undefined;
			this.publish({ kind: 'waiting', query: '', paths: new Set() });
			return;
		}
		const result = readSearchResults(this.source.view);
		if (result.kind !== 'ready') {
			this.candidate = undefined;
			if (result.kind === 'unavailable') this.stopTimer();
			this.publish({ kind: result.kind, query: result.query, paths: new Set() });
			return;
		}
		const previous = this.candidate;
		this.candidate = result;
		if (
			!previous || previous.generation !== result.generation ||
			previous.query !== result.query || !equalPaths(previous.paths, result.paths)
		) {
			this.publish({ kind: 'searching', query: result.query, paths: new Set() });
			return;
		}
		this.publish({ kind: 'ready', query: result.query, paths: result.paths });
	}

	private publish(state: FollowSearchState): void {
		if (
			this.state.kind === state.kind && this.state.query === state.query &&
			equalPaths(this.state.paths, state.paths)
		) return;
		this.state = state;
		this.onChange(state);
	}

	private stopTimer(): void {
		if (this.timer !== undefined) this.timerWindow.clearInterval(this.timer);
		this.timer = undefined;
	}
}
