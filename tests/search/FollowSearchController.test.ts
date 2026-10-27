import type { Workspace } from 'obsidian';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FollowSearchController, type FollowSearchState } from '../../src/search/FollowSearchController';
import { readSearchResults } from '../../src/search/SearchResultsAdapter';

vi.mock('obsidian', () => ({ View: class {} }));

function search(query = 'needle', paths = ['A.md', 'B.md']) {
	return {
		getViewType: () => 'search',
		searchComponent: { inputEl: { value: query } },
		matchingCase: false,
		searchQuery: { query, caseSensitive: false },
		dom: { working: false, resultDomLookup: new Map(paths.map((path) => [{ path }, {}])) },
		queue: { queue: { items: { length: 0 } } as { items: { length: number } } | null },
	};
}

function harness() {
	const first = { view: search() };
	const second = { view: search('other', ['C.md']) };
	let leaves: unknown[] = [first, second];
	let onActive: (leaf: unknown) => void = () => undefined;
	const created = {
		view: search(''),
		setViewState: vi.fn(async (): Promise<void> => { leaves = [created]; }),
	};
	const workspace = {
		activeLeaf: first,
		getActiveViewOfType: () => workspace.activeLeaf.view,
		on: vi.fn((_event: string, callback: typeof onActive) => { onActive = callback; return {}; }),
		offref: vi.fn(),
		getLeavesOfType: () => leaves,
		getLeftLeaf: vi.fn(() => created),
		revealLeaf: vi.fn(() => Promise.resolve()),
		setActiveLeaf: vi.fn((leaf: unknown) => onActive(leaf)),
	};
	const changes: FollowSearchState[] = [];
	const controller = new FollowSearchController(workspace as unknown as Workspace, (state) => changes.push(state));
	return { first, second, created, workspace, changes, controller,
		activate: (leaf: unknown) => onActive(leaf),
		close: () => { leaves = []; },
		last: () => changes[changes.length - 1],
	};
}

describe('read-only core Search adapter', () => {
	it('reads all files, independent of collapsed or virtualized result rows', () => {
		const view = search('needle', Array.from({ length: 75 }, (_, index) => `folder/${index}.md`));
		const state = readSearchResults(view);
		expect(state.kind).toBe('ready');
		if (state.kind === 'ready') expect(state.paths.size).toBe(75);
	});
	it('rejects stale, cancelled, queued, working and changed-case results', () => {
		const view = search();
		view.searchComponent.inputEl.value = 'new';
		expect(readSearchResults(view).kind).toBe('searching');
		view.searchComponent.inputEl.value = 'needle';
		view.matchingCase = true;
		expect(readSearchResults(view).kind).toBe('searching');
		view.matchingCase = false;
		view.dom.working = true;
		expect(readSearchResults(view).kind).toBe('searching');
		view.dom.working = false;
		view.queue.queue!.items.length = 1;
		expect(readSearchResults(view).kind).toBe('searching');
		view.queue.queue = null;
		expect(readSearchResults(view).kind).toBe('searching');
	});
	it('clears empty queries and fails closed on changed internals or bad paths', () => {
		expect(readSearchResults(search('')).kind).toBe('empty');
		expect(readSearchResults({}).kind).toBe('unavailable');
		const view = search();
		Reflect.deleteProperty(view.dom, 'working');
		expect(readSearchResults(view).kind).toBe('unavailable');
		expect(readSearchResults(search('needle', [''])).kind).toBe('unavailable');
		expect(readSearchResults({ get searchComponent() { throw new Error('changed'); } }).kind).toBe('unavailable');
	});
});

describe('Follow Search lifecycle', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.stubGlobal('window', { setInterval, clearInterval });
	});
	afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

	it('opens the followed pane without replacing its query or creating another pane', async () => {
		const h = harness();
		h.activate(h.second);
		await h.controller.openSearch();
		expect(h.workspace.revealLeaf).toHaveBeenCalledWith(h.second);
		expect(h.workspace.getLeftLeaf).not.toHaveBeenCalled();
		expect(h.second.view.searchComponent.inputEl.value).toBe('other');
		h.controller.dispose();
	});

	it('creates and reveals Search through Workspace when no Search pane exists', async () => {
		const h = harness();
		h.close();
		h.controller.setEnabled(true);
		await h.controller.openSearch();
		expect(h.created.setViewState).toHaveBeenCalledWith({ type: 'search', active: true });
		expect(h.workspace.revealLeaf).toHaveBeenCalledWith(h.created);
		expect(h.last()?.kind).toBe('empty');
		h.controller.dispose();
	});

	it('retries a deferred restored Search after the public reveal completes', async () => {
		const h = harness();
		Reflect.deleteProperty(h.first.view, 'searchComponent');
		h.workspace.revealLeaf.mockImplementationOnce(async () => { h.first.view = search(); });
		h.controller.setEnabled(true);
		expect(h.last()?.kind).toBe('unavailable');
		expect(vi.getTimerCount()).toBe(0);
		await h.controller.openSearch();
		vi.advanceTimersByTime(250);
		expect(h.last()?.kind).toBe('ready');
		expect(h.last()?.paths).toEqual(new Set(['A.md', 'B.md']));
		h.controller.dispose();
		expect(vi.getTimerCount()).toBe(0);
	});

	it('does not steal focus after the user switches back to note finding during an async reveal', async () => {
		const h = harness();
		let resolveReveal = (): void => undefined;
		h.workspace.revealLeaf.mockImplementationOnce(() => new Promise<void>((resolve) => { resolveReveal = resolve; }));
		const opening = h.controller.openSearch();
		h.controller.setEnabled(false);
		resolveReveal();
		await opening;
		expect(h.workspace.setActiveLeaf).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
		h.controller.dispose();
	});
	it('starts only on request, waits for stable completion and does not redraw unchanged results', () => {
		const h = harness();
		expect(vi.getTimerCount()).toBe(0);
		h.controller.setEnabled(true);
		expect(h.last()?.kind).toBe('searching');
		vi.advanceTimersByTime(250);
		expect(h.last()?.paths).toEqual(new Set(['A.md', 'B.md']));
		const count = h.changes.length;
		vi.advanceTimersByTime(2000);
		expect(h.changes).toHaveLength(count);
		h.controller.dispose();
		expect(vi.getTimerCount()).toBe(0);
		expect(h.workspace.offref).toHaveBeenCalledOnce();
	});
	it('keeps the selected pane when graph gets focus and switches only to another Search', () => {
		const h = harness();
		h.controller.setEnabled(true);
		vi.advanceTimersByTime(250);
		h.activate({ view: { getViewType: () => 'spherical-graph-view' } });
		vi.advanceTimersByTime(250);
		expect(h.last()?.query).toBe('needle');
		h.activate(h.second);
		expect(h.last()?.paths.size).toBe(0);
		vi.advanceTimersByTime(250);
		expect(h.last()?.paths).toEqual(new Set(['C.md']));
		h.controller.dispose();
	});
	it('clears stale results immediately, waits for a complete generation and handles zero matches', () => {
		const h = harness();
		h.controller.setEnabled(true);
		vi.advanceTimersByTime(250);
		h.first.view.searchComponent.inputEl.value = 'missing';
		vi.advanceTimersByTime(250);
		expect(h.last()?.paths.size).toBe(0);
		h.first.view.searchQuery.query = 'missing';
		h.first.view.dom.resultDomLookup.clear();
		vi.advanceTimersByTime(500);
		expect(h.last()).toMatchObject({ kind: 'ready', query: 'missing', paths: new Set() });
		h.first.view.searchComponent.inputEl.value = '';
		vi.advanceTimersByTime(250);
		expect(h.last()?.kind).toBe('empty');
		h.controller.dispose();
	});
	it('detects a completed incremental update even when the file count is unchanged', () => {
		const h = harness();
		h.controller.setEnabled(true);
		vi.advanceTimersByTime(250);
		h.first.view.dom.resultDomLookup = search('needle', ['A.md', 'C.md']).dom.resultDomLookup;
		vi.advanceTimersByTime(500);
		expect(h.last()?.paths).toEqual(new Set(['A.md', 'C.md']));
		h.controller.dispose();
	});
	it('clears and pauses on a closed pane; Clear stops polling without changing Search', () => {
		const h = harness();
		h.controller.setEnabled(true);
		vi.advanceTimersByTime(250);
		h.close();
		vi.advanceTimersByTime(250);
		expect(h.last()?.kind).toBe('waiting');
		expect(h.last()?.paths.size).toBe(0);
		h.controller.setEnabled(false);
		expect(h.last()?.kind).toBe('off');
		expect(vi.getTimerCount()).toBe(0);
		expect(h.first.view.searchComponent.inputEl.value).toBe('needle');
		h.controller.dispose();
	});
	it('stops polling an incompatible Search pane and can retry after a new activation', () => {
		const h = harness();
		Reflect.deleteProperty(h.first.view.dom, 'working');
		h.controller.setEnabled(true);
		expect(h.last()?.kind).toBe('unavailable');
		expect(vi.getTimerCount()).toBe(0);
		h.activate(h.second);
		h.workspace.activeLeaf = h.second;
		h.controller.setEnabled(true);
		vi.advanceTimersByTime(250);
		expect(h.last()?.kind).toBe('ready');
		h.controller.dispose();
	});
});
