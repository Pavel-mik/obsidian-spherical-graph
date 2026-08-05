import workerSource from 'virtual:spherical-graph-data-worker';

import type { GraphData, GraphFilterOptions } from './graphTypes';
import type { GraphBuildSourceSnapshot } from './GraphDataService';
import type {
	GraphBuildWorkerRequest,
	GraphBuildWorkerResponse,
} from './graph-worker-entry';

interface ActiveBuild {
	readonly requestId: string;
	readonly worker: Worker;
	readonly objectUrl: string;
	reject(error: Error): void;
}

/** Runs graph indexing outside Obsidian's UI thread. */
export class GraphDataWorkerClient {
	private active: ActiveBuild | undefined;
	private sequence = 0;

	build(
		source: GraphBuildSourceSnapshot,
		filters: Partial<GraphFilterOptions>,
	): Promise<GraphData> {
		if (this.active !== undefined) {
			return Promise.reject(new Error('A vault graph build is already active.'));
		}
		const requestId = `graph-${Date.now()}-${++this.sequence}`;
		const blob = new Blob([workerSource], { type: 'text/javascript' });
		const objectUrl = URL.createObjectURL(blob);
		let worker: Worker;
		try {
			worker = new Worker(objectUrl);
		} catch (error) {
			URL.revokeObjectURL(objectUrl);
			return Promise.reject(
				error instanceof Error ? error : new Error('Could not start the vault graph worker.'),
			);
		}
		return new Promise<GraphData>((resolve, reject) => {
			const active: ActiveBuild = {
				requestId,
				worker,
				objectUrl,
				reject: (error) => reject(error),
			};
			this.active = active;
			const close = (): void => {
				if (this.active !== active) {
					return;
				}
				this.active = undefined;
				worker.terminate();
				URL.revokeObjectURL(objectUrl);
			};
			worker.onmessage = (event: MessageEvent<unknown>) => {
				const response = event.data as Partial<GraphBuildWorkerResponse>;
				if (response.requestId !== requestId) {
					return;
				}
				close();
				if (response.type === 'completed' && response.graph !== undefined) {
					resolve(response.graph);
				} else {
					reject(
						new Error(
							response.type === 'error' &&
								typeof response.message === 'string'
								? response.message
								: 'The vault graph worker returned invalid data.',
						),
					);
				}
			};
			worker.onerror = (event) => {
				close();
				reject(
					new Error(event.message || 'The vault graph worker crashed.'),
				);
			};
			const request: GraphBuildWorkerRequest = {
				type: 'build',
				requestId,
				source,
				filters,
			};
			try {
				worker.postMessage(request);
			} catch (error) {
				close();
				reject(
					error instanceof Error ? error : new Error('Could not send data to the vault graph worker.'),
				);
			}
		});
	}

	dispose(): void {
		const active = this.active;
		if (active === undefined) {
			return;
		}
		this.active = undefined;
		active.worker.terminate();
		URL.revokeObjectURL(active.objectUrl);
		active.reject(new Error('The vault graph build was cancelled.'));
	}
}
