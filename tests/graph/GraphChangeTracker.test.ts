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
});
