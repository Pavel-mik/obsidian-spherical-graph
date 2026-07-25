import { GraphDataService } from "./GraphDataService";
import {
	diffGraphDescriptors,
	GraphDiff,
	GraphRenameHint,
} from "./graphDiff";
import {
	GraphData,
	GraphDescriptor,
	GraphFilterOptions,
} from "./graphTypes";

export type GraphChangeReason =
	| "create"
	| "delete"
	| "rename"
	| "metadata"
	| "resolved-links"
	| "filter";

export interface GraphChangeObservation {
	readonly graph: GraphData;
	readonly diff: GraphDiff;
	readonly reasons: readonly GraphChangeReason[];
}

export interface GraphChangeScheduler {
	set(callback: () => void, delayMs: number): unknown;
	clear(handle: unknown): void;
}

export interface GraphChangeTrackerOptions {
	readonly graphService: GraphDataService;
	readonly getFilters: () => Partial<GraphFilterOptions>;
	readonly getCommittedDescriptor: () => GraphDescriptor | undefined;
	readonly getCommittedSignature?: () => string | undefined;
	readonly onDiff: (
		observation: GraphChangeObservation,
	) => void | Promise<void>;
	/**
	 * Receives metadata-only rebuilds whose layout descriptor is unchanged.
	 * This supports derived renderer data such as tags without marking the
	 * committed spherical layout dirty.
	 */
	readonly onObservation?: (
		observation: GraphChangeObservation,
	) => void | Promise<void>;
	readonly onActiveFileChange?: (path: string | undefined) => void;
	readonly debounceMs: number;
	readonly scheduler?: GraphChangeScheduler;
	readonly onError?: (error: unknown) => void;
}

const DEFAULT_SCHEDULER: GraphChangeScheduler = {
	set: (callback, delayMs) => window.setTimeout(callback, delayMs),
	clear: (handle) => {
		window.clearTimeout(handle as number);
	},
};

/**
 * Debounces public vault/metadata events into graph model rebuilds. This class
 * intentionally has no solver/worker dependency: an event can only publish a
 * diff to the lifecycle owner.
 */
export class GraphChangeTracker {
	private readonly options: GraphChangeTrackerOptions;
	private readonly scheduler: GraphChangeScheduler;
	private readonly reasons = new Set<GraphChangeReason>();
	private readonly renameHints: GraphRenameHint[] = [];
	private timer: unknown;
	private disposed = false;
	private flushChain: Promise<GraphChangeObservation | undefined> =
		Promise.resolve(undefined);

	constructor(options: GraphChangeTrackerOptions) {
		this.options = options;
		this.scheduler = options.scheduler ?? DEFAULT_SCHEDULER;
	}

	get hasQueuedGraphChange(): boolean {
		return this.reasons.size > 0;
	}

	markVaultChanged(reason: Exclude<GraphChangeReason, "rename">): void {
		if (this.disposed) {
			return;
		}
		this.reasons.add(reason);
		this.schedule();
	}

	markRenamed(oldPath: string, newPath: string): void {
		if (this.disposed) {
			return;
		}
		this.renameHints.push({
			oldPath,
			newPath,
			reliability: "reliable",
			source: "vault-event",
		});
		this.reasons.add("rename");
		this.schedule();
	}

	markActiveFileChanged(path: string | undefined): void {
		if (this.disposed) {
			return;
		}
		this.options.onActiveFileChange?.(path);
	}

	async flush(): Promise<GraphChangeObservation | undefined> {
		if (this.disposed || this.reasons.size === 0) {
			return undefined;
		}
		this.clearTimer();
		const reasons = [...this.reasons];
		const hints = [...this.renameHints];
		this.reasons.clear();
		this.renameHints.length = 0;

		const run = async (): Promise<GraphChangeObservation> => {
			const previous = this.options.getCommittedDescriptor();
			const graph = this.options.graphService.buildGraph(
				this.options.getFilters(),
			);
			const diff = diffGraphDescriptors(
				previous,
				graph.descriptor,
				graph.signature,
				hints,
				this.options.getCommittedSignature?.(),
			);
			const observation = Object.freeze({
				graph,
				diff,
				reasons: Object.freeze(reasons),
			});
			if (!diff.isEmpty) {
				await this.options.onDiff(observation);
			} else {
				await this.options.onObservation?.(observation);
			}
			return observation;
		};
		this.flushChain = this.flushChain.then(run, run);
		return this.flushChain;
	}

	dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		this.clearTimer();
		this.reasons.clear();
		this.renameHints.length = 0;
	}

	private schedule(): void {
		this.clearTimer();
		this.timer = this.scheduler.set(() => {
			this.timer = undefined;
			void this.flush().catch((error: unknown) => {
				this.options.onError?.(error);
			});
		}, Math.max(0, this.options.debounceMs));
	}

	private clearTimer(): void {
		if (this.timer !== undefined) {
			this.scheduler.clear(this.timer);
			this.timer = undefined;
		}
	}
}
