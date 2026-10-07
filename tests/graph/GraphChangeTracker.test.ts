import { afterEach, describe, expect, it, vi } from "vitest";

import {
	GraphChangeObservation,
	GraphChangeScheduler,
	GraphChangeTracker,
} from "../../src/graph/GraphChangeTracker";
import { GraphDataService } from "../../src/graph/GraphDataService";
import {
	GraphDataSource,
	MarkdownGraphFile,
	ResolvedLinkIndex,
} from "../../src/graph/graphTypes";

class Source implements GraphDataSource {
	files: MarkdownGraphFile[] = [
		{ path: "a.md", basename: "a" },
	];
	links: ResolvedLinkIndex = {};

	getMarkdownFiles(): readonly MarkdownGraphFile[] {
		return this.files;
	}

	getResolvedLinks(): ResolvedLinkIndex {
		return this.links;
	}
}

class ManualScheduler implements GraphChangeScheduler {
	private now = 0;
	private nextId = 1;
	private readonly tasks = new Map<
		number,
		{ readonly due: number; readonly callback: () => void }
	>();

	set(callback: () => void, delayMs: number): unknown {
		const id = this.nextId;
		this.nextId += 1;
		this.tasks.set(id, { due: this.now + delayMs, callback });
		return id;
	}

	clear(handle: unknown): void {
		if (typeof handle === "number") {
			this.tasks.delete(handle);
		}
	}

	advance(milliseconds: number): void {
		this.now += milliseconds;
		const due = [...this.tasks.entries()]
			.filter(([, task]) => task.due <= this.now)
			.sort((left, right) => left[1].due - right[1].due);
		for (const [id, task] of due) {
			this.tasks.delete(id);
			task.callback();
		}
	}
}

afterEach(() => {
	vi.useRealTimers();
});

describe("GraphChangeTracker", () => {
	it("debounces vault events into a dirty diff and never owns a solver", async () => {
		const source = new Source();
		const graphService = new GraphDataService(source);
		const committed = graphService.buildGraph();
		const scheduler = new ManualScheduler();
		const observations: GraphChangeObservation[] = [];
		const onDiff = vi.fn((observation: GraphChangeObservation) => {
			observations.push(observation);
		});
		const solverStart = vi.fn();
		const tracker = new GraphChangeTracker({
			graphService,
			getFilters: () => ({ includeOrphans: true }),
			getCommittedDescriptor: () => committed.descriptor,
			getCommittedSignature: () => committed.signature,
			onDiff,
			debounceMs: 100,
			scheduler,
		});
		source.files.push({ path: "b.md", basename: "b" });

		tracker.markVaultChanged("create");
		tracker.markVaultChanged("metadata");
		expect(onDiff).not.toHaveBeenCalled();
		scheduler.advance(99);
		expect(onDiff).not.toHaveBeenCalled();
		scheduler.advance(1);

		await vi.waitFor(() => {
			expect(onDiff).toHaveBeenCalledTimes(1);
		});
		expect(observations[0]?.diff.addedNodeIds).toEqual(["b.md"]);
		expect(solverStart).not.toHaveBeenCalled();
		tracker.dispose();
	});

	it("does not rebuild or change the signature for active-file events", () => {
		const source = new Source();
		const service = new GraphDataService(source);
		const buildSpy = vi.spyOn(service, "buildGraph");
		const onActiveFileChange = vi.fn();
		const tracker = new GraphChangeTracker({
			graphService: service,
			getFilters: () => ({}),
			getCommittedDescriptor: () => undefined,
			onDiff: vi.fn(),
			onActiveFileChange,
			debounceMs: 50,
			scheduler: new ManualScheduler(),
		});

		tracker.markActiveFileChanged("a.md");
		expect(onActiveFileChange).toHaveBeenCalledWith("a.md");
		expect(buildSpy).not.toHaveBeenCalled();
		expect(tracker.hasQueuedGraphChange).toBe(false);
		tracker.dispose();
	});

	it("passes reliable vault rename hints to diffing", async () => {
		const source = new Source();
		const service = new GraphDataService(source);
		const committed = service.buildGraph();
		source.files = [{ path: "renamed.md", basename: "renamed" }];
		const onDiff = vi.fn();
		const scheduler = new ManualScheduler();
		const tracker = new GraphChangeTracker({
			graphService: service,
			getFilters: () => ({}),
			getCommittedDescriptor: () => committed.descriptor,
			onDiff,
			debounceMs: 10_000,
			scheduler,
		});

		tracker.markRenamed("a.md", "renamed.md");
		const observation = await tracker.flush();
		expect(observation?.diff.renamedNodes).toEqual([
			{ oldPath: "a.md", newPath: "renamed.md" },
		]);
		expect(observation?.diff.requiresLayout).toBe(false);
		tracker.dispose();
	});

	it("publishes metadata-only tag changes without creating a layout diff", async () => {
		const source = new Source();
		const service = new GraphDataService(source);
		const committed = service.buildGraph();
		source.files = [
			{ path: "a.md", basename: "a", tags: ["#orbit"] },
		];
		const onDiff = vi.fn();
		const onObservation = vi.fn();
		const tracker = new GraphChangeTracker({
			graphService: service,
			getFilters: () => ({}),
			getCommittedDescriptor: () => committed.descriptor,
			getCommittedSignature: () => committed.signature,
			onDiff,
			onObservation,
			debounceMs: 10_000,
			scheduler: new ManualScheduler(),
		});

		tracker.markVaultChanged("metadata");
		const observation = await tracker.flush();

		expect(observation?.diff.isEmpty).toBe(true);
		expect(observation?.graph.nodes[0]?.tags).toEqual(["#orbit"]);
		expect(onDiff).not.toHaveBeenCalled();
		expect(onObservation).toHaveBeenCalledOnce();
		tracker.dispose();
	});

	it("retains and composes renames across dirty scans and explicit Refresh", async () => {
		const source = new Source();
		const service = new GraphDataService(source);
		const committed = service.buildGraph();
		const tracker = new GraphChangeTracker({
			graphService: service,
			getFilters: () => ({}),
			getCommittedDescriptor: () => committed.descriptor,
			onDiff: vi.fn(),
			debounceMs: 100,
			scheduler: new ManualScheduler(),
		});
		source.files = [{ path: 'b.md', basename: 'b' }, { path: 'new.md', basename: 'new' }];
		tracker.markRenamed('a.md', 'b.md');
		const first = await tracker.flush();
		expect(first?.diff.requiresLayout).toBe(true);
		tracker.markVaultChanged('filter');
		expect((await tracker.flush())?.diff.renamedNodes).toEqual([{ oldPath: 'a.md', newPath: 'b.md' }]);
		source.files[0] = { path: 'c.md', basename: 'c' };
		tracker.markRenamed('b.md', 'c.md');
		const chained = await tracker.flush();
		expect(chained?.diff.renamedNodes).toEqual([{ oldPath: 'a.md', newPath: 'c.md' }]);
		expect(chained?.diff.addedNodeIds).toEqual(['new.md']);
		expect(chained?.diff.removedNodeIds).toEqual([]);
		tracker.dispose();
	});

	it("keeps descendant identities after a folder rename without matching sibling prefixes", async () => {
		const source = new Source();
		source.files = ['Old/a.md', 'Old/Nested/b.md', 'Older/c.md'].map((path) => ({ path, basename: path }));
		const service = new GraphDataService(source);
		const committed = service.buildGraph();
		const tracker = new GraphChangeTracker({
			graphService: service,
			getFilters: () => ({}),
			getCommittedDescriptor: () => committed.descriptor,
			onDiff: vi.fn(),
			debounceMs: 100,
			scheduler: new ManualScheduler(),
		});
		source.files = ['New/a.md', 'New/Nested/b.md', 'Older/c.md'].map((path) => ({ path, basename: path }));
		tracker.markRenamed('Old', 'New', 'folder');
		const observation = await tracker.flush();
		expect(observation?.diff.renamedNodes).toEqual([
			{ oldPath: 'Old/Nested/b.md', newPath: 'New/Nested/b.md' },
			{ oldPath: 'Old/a.md', newPath: 'New/a.md' },
		]);
		expect(observation?.diff.requiresLayout).toBe(false);
		tracker.dispose();
	});

	it("does not publish an in-flight rebuild after disposal", async () => {
		const source = new Source();
		const service = new GraphDataService(source);
		const committed = service.buildGraph();
		source.files.push({ path: "b.md", basename: "b" });
		const rebuilt = service.buildGraph();
		let resolveBuild: ((graph: typeof rebuilt) => void) | undefined;
		const buildGraph = vi.fn(
			() =>
				new Promise<typeof rebuilt>((resolve) => {
					resolveBuild = resolve;
				}),
		);
		const onDiff = vi.fn();
		const onObservation = vi.fn();
		const tracker = new GraphChangeTracker({
			graphService: service,
			buildGraph,
			getFilters: () => ({}),
			getCommittedDescriptor: () => committed.descriptor,
			getCommittedSignature: () => committed.signature,
			onDiff,
			onObservation,
			debounceMs: 10_000,
			scheduler: new ManualScheduler(),
		});

		tracker.markVaultChanged("create");
		const flushing = tracker.flush();
		await vi.waitFor(() => expect(buildGraph).toHaveBeenCalledOnce());
		tracker.dispose();
		resolveBuild?.(rebuilt);
		await flushing;

		expect(onDiff).not.toHaveBeenCalled();
		expect(onObservation).not.toHaveBeenCalled();
	});
});
